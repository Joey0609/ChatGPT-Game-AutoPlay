(function (root) {
  'use strict';

  const DIRS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 }
  ];

  const DEFAULTS = {
    alphaThreshold: 12,
    backgroundTolerance: 24,
    blueRedDiff: 28,
    blueValue: 110,
    eyeLuma: 150,
    eyeBlue: 175,
    minSnakeArea: 24,
    dotMaxArea: 140,
    dotMaxBox: 18,
    maxResidual: 0.34,
    maxDecorations: 6,
    // A snake never covers the whole board. When almost every cell holds a bright blob the canvas
    // is not a snake board at all but the page's background animation (a full dot lattice painted
    // in the same blue), and reading it would hand the planner a board that does not exist.
    maxBlobShare: 0.5
  };

  // A body step may never land on a blob that is this much darker than the current segment:
  // the food is painted in the head colour, so a darkening step would swallow the food.
  const TAPER_SLACK = 6;
  // The snake is drawn with a taper that never grows again on the way to the tail, while a food
  // blob next to the body is a hole in that taper. A step that grows the blob by more than this
  // ratio is therefore not a body step. The ratio only absorbs pixel jitter.
  const AREA_GROWTH = 1.02;
  // Upper bound on the backtracking search for the longest chain, so a pathological board can
  // never stall the game loop.
  const CHAIN_BUDGET = 20000;

  const wrap = (value, size) => ((value % size) + size) % size;
  const cellKey = (x, y) => `${x},${y}`;
  const sum = (color) => color[0] + color[1] + color[2];

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function circularMedian(values) {
    if (!values.length) return 0;
    const reference = values[0];
    const shifted = values.map((value) => {
      let delta = value - reference;
      if (delta > 0.5) delta -= 1;
      if (delta < -0.5) delta += 1;
      return delta;
    });
    const result = reference + median(shifted);
    return result - Math.floor(result);
  }

  // Anything within `radius` of snake ink (the dark eye pixels, anti-aliased rims) must not be
  // mistaken for a background dot, otherwise those stray pixels wreck the pitch estimate.
  function dilate(mask, width, height, radius) {
    const out = new Uint8Array(mask.length);
    const offsets = [];
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
      }
    }
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask[index]) continue;
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        out[ny * width + nx] = 1;
      }
    }
    return out;
  }

  function collectBlobs(mask, width, height, options) {
    const { data, eyeMask, colorMask, minArea, maxArea, maxBox } = options;
    const visited = new Uint8Array(mask.length);
    const stack = [];
    const blobs = [];
    for (let seed = 0; seed < mask.length; seed += 1) {
      if (!mask[seed] || visited[seed]) continue;
      visited[seed] = 1;
      stack.length = 0;
      stack.push(seed);
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let colorCount = 0;
      let eyes = 0;
      let minX = width;
      let maxX = -1;
      let minY = height;
      let maxY = -1;
      let overflow = false;
      while (stack.length) {
        const index = stack.pop();
        const x = index % width;
        const y = (index - x) / width;
        const p = index * 4;
        area += 1;
        sumX += x;
        sumY += y;
        if (!colorMask || colorMask[index]) {
          sumR += data[p];
          sumG += data[p + 1];
          sumB += data[p + 2];
          colorCount += 1;
        }
        if (eyeMask && eyeMask[index]) eyes += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (area > maxArea || maxX - minX + 1 > maxBox || maxY - minY + 1 > maxBox) {
          overflow = true;
          break;
        }
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const next = ny * width + nx;
            if (mask[next] && !visited[next]) {
              visited[next] = 1;
              stack.push(next);
            }
          }
        }
      }
      if (overflow || area < minArea) continue;
      blobs.push({
        area,
        x: sumX / area,
        y: sumY / area,
        color: colorCount
          ? [Math.round(sumR / colorCount), Math.round(sumG / colorCount), Math.round(sumB / colorCount)]
          : [0, 0, 0],
        box: [minX, minY, maxX, maxY],
        eyes
      });
    }
    return blobs;
  }

  function clusterCenters(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const clusters = [];
    for (const value of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && value - last.max <= 3) {
        last.max = value;
        last.sum += value;
        last.count += 1;
      } else {
        clusters.push({ min: value, max: value, sum: value, count: 1 });
      }
    }
    return clusters.map((cluster) => cluster.sum / cluster.count);
  }

  function measurePitch(values, size) {
    const centers = clusterCenters(values);
    if (centers.length < 3) return null;
    const diffs = [];
    for (let i = 1; i < centers.length; i += 1) diffs.push(centers[i] - centers[i - 1]);
    const smallest = Math.min(...diffs);
    if (!(smallest > 4)) return null;
    const pitch = median(diffs.filter((diff) => diff <= smallest * 1.5));
    const span = centers[centers.length - 1] - centers[0];
    return {
      pitch,
      columns: Math.round(size / pitch),
      lattice: centers.length,
      spanColumns: Math.round(span / pitch) + 1,
      phase: circularMedian(centers.map((center) => (center / pitch) % 1))
    };
  }

  function pickPitch(dotPitch, bluePitch, dotCount) {
    if (!dotPitch) return bluePitch;
    if (!bluePitch || dotCount < 4) return dotPitch;
    const close = Math.abs(dotPitch.pitch - bluePitch.pitch) < bluePitch.pitch * 0.12;
    return close ? dotPitch : bluePitch;
  }

  function neighborsOf(cells, adjacency, allowed, index) {
    return adjacency[index].map((cell) => cells.indexOf(cell)).filter((j) => allowed.has(j));
  }

  function colorSum(cell) {
    return cell.color[0] + cell.color[1] + cell.color[2];
  }

  // The links of every cell, as indexes into `cells`, so the search never has to scan the array.
  function linksOf(cells, adjacency) {
    return adjacency.map((list) => list
      .map((cell) => cells.indexOf(cell))
      .filter((index) => index >= 0));
  }

  function stepAllowed(cells, allowed, used, current, next, maxGrowth) {
    if (!allowed.has(next) || used.has(next)) return false;
    if (colorSum(cells[next]) < colorSum(cells[current]) - TAPER_SLACK) return false;
    if (maxGrowth && cells[next].area > cells[current].area * maxGrowth) return false;
    return true;
  }

  // One forward-only pass: always step onto the lightest admissible neighbour. The snake taper
  // (head darkest/largest, tail lightest) decides the direction; the food, painted in the head
  // colour, is never darker than the current segment, so a plain taper step prefers the body.
  function followTaper(cells, links, allowed, headIndex, maxGrowth) {
    const ordered = [headIndex];
    const used = new Set([headIndex]);
    let current = headIndex;
    while (true) {
      const sum = colorSum(cells[current]);
      const candidates = links[current]
        .filter((j) => stepAllowed(cells, allowed, used, current, j, maxGrowth) && colorSum(cells[j]) >= sum - TAPER_SLACK);
      if (!candidates.length) break;
      const next = candidates.reduce((best, j) => (colorSum(cells[j]) > colorSum(cells[best]) ? j : best), candidates[0]);
      ordered.push(next);
      used.add(next);
      current = next;
    }
    return ordered;
  }

  // A self-touching body (the head lying next to its own fourth segment, a folded tail) gives the
  // taper ties it cannot break, and the greedy pass then walks off along the wrong branch and
  // leaves body cells behind. So when the greedy pass does not cover the body, walk the same
  // admissible graph depth-first and keep the longest chain found. The greedy result is the floor
  // and the budget caps the work, so this can only ever improve the reading.
  function searchLongest(cells, links, allowed, headIndex, floor, maxGrowth) {
    let best = floor;
    let budget = CHAIN_BUDGET;
    const used = new Set([headIndex]);
    const path = [headIndex];
    const visit = (current) => {
      if (path.length > best.length) best = path.slice();
      if (best.length >= allowed.size) return true;
      if (budget <= 0 || path.length + (allowed.size - used.size) <= best.length) return false;
      const options = links[current]
        .filter((j) => stepAllowed(cells, allowed, used, current, j, maxGrowth))
        .sort((a, b) => colorSum(cells[b]) - colorSum(cells[a]));
      for (const next of options) {
        budget -= 1;
        used.add(next);
        path.push(next);
        const done = visit(next);
        path.pop();
        used.delete(next);
        if (done) return true;
        if (budget <= 0) break;
      }
      return false;
    };
    visit(headIndex);
    return best;
  }

  // The tail is the lightest, smallest blob, so it is the safest anchor: walking the body from
  // there cannot go the wrong way around a tie near the head (the snake usually wraps into a
  // dense run of identically drawn segments, which is exactly where the head-anchored walk has
  // to guess). Only a dead end is considered, so a food blob next to the body cannot be picked.
  function pickTail(cells, links, allowed, headIndex) {
    const candidates = [...allowed].filter((index) => index !== headIndex);
    if (!candidates.length) return undefined;
    const deadEnds = candidates.filter((index) => links[index].filter((j) => allowed.has(j)).length <= 1);
    const pool = deadEnds.length ? deadEnds : candidates;
    return pool.reduce((best, index) => (cells[index].area < cells[best].area ? index : best), pool[0]);
  }

  // The same taper read from the tail towards the head: the blob may never shrink or get lighter
  // on the way, and among equally valid steps the darkest one continues the body.
  function followTaperBack(cells, links, allowed, startIndex, headIndex) {
    const ordered = [startIndex];
    const used = new Set([startIndex]);
    let current = startIndex;
    while (current !== headIndex) {
      const candidates = links[current].filter((j) => allowed.has(j) && !used.has(j)
        && colorSum(cells[j]) <= colorSum(cells[current]) + TAPER_SLACK
        && cells[j].area >= cells[current].area / AREA_GROWTH);
      if (!candidates.length) break;
      const next = candidates.reduce((best, j) => (colorSum(cells[j]) > colorSum(cells[best]) ? j : best), candidates[0]);
      ordered.push(next);
      used.add(next);
      current = next;
    }
    return ordered;
  }

  function bestChain(cells, links, allowed, headIndex, maxGrowth, seed) {
    let floor = followTaper(cells, links, allowed, headIndex, maxGrowth);
    if (seed && seed.length > floor.length) floor = seed;
    if (floor.length >= allowed.size) return floor;
    return searchLongest(cells, links, allowed, headIndex, floor, maxGrowth);
  }

  // Walks the body from the head. The snake is drawn with a taper: the head is the darkest,
  // largest segment and the body gets lighter towards the tail, while the food is painted in
  // the head colour and may sit right next to the head. So the body always continues onto the
  // lightest free neighbour, and the walk stops when only darker neighbours (food) are left.
  // Two readings are tried: the strict one also refuses any step that grows the blob again
  // (which is what keeps the chain from being threaded through a food blob), and the loose one
  // only follows the colour. The strict reading wins unless it gives up cells.
  function orderFrom(cells, adjacency, allowed, headIndex) {
    const links = linksOf(cells, adjacency);
    // A body chain read from the tail, if it really ends at the head, is a complete reading and
    // seeds both searches (which also makes their pruning bite immediately).
    const tailIndex = pickTail(cells, links, allowed, headIndex);
    const back = tailIndex === undefined ? [] : followTaperBack(cells, links, allowed, tailIndex, headIndex);
    const seed = back.length > 1 && back[back.length - 1] === headIndex ? back.slice().reverse() : null;
    const loose = bestChain(cells, links, allowed, headIndex, 0, seed);
    const strict = bestChain(cells, links, allowed, headIndex, AREA_GROWTH, seed);
    const best = strict.length >= loose.length ? strict : loose;
    return seed && seed.length > best.length ? seed : best;
  }

  function directionFrom(from, to, width, height) {
    return DIRS.findIndex((dir) => wrap(from.x + dir.x, width) === to.x && wrap(from.y + dir.y, height) === to.y);
  }

  function analyzeBoard(image, canvasWidth, canvasHeight, options) {
    const cfg = { ...DEFAULTS, ...(options || {}) };
    const data = image.data;
    const total = canvasWidth * canvasHeight;
    const histogram = new Map();
    let opaque = 0;
    for (let i = 0, p = 0; i < total; i += 1, p += 4) {
      if (data[p + 3] < 250) continue;
      opaque += 1;
      const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
      histogram.set(key, (histogram.get(key) || 0) + 1);
    }
    let background = null;
    if (opaque > total * 0.4) {
      let bestKey = 0;
      let bestCount = 0;
      for (const [key, count] of histogram) {
        if (count > bestCount) {
          bestCount = count;
          bestKey = key;
        }
      }
      background = [((bestKey >> 10) & 31) << 3, ((bestKey >> 5) & 31) << 3, (bestKey & 31) << 3];
    }
    const blueMask = new Uint8Array(total);
    const eyeMask = new Uint8Array(total);
    const otherMask = new Uint8Array(total);
    for (let i = 0, p = 0; i < total; i += 1, p += 4) {
      if (data[p + 3] <= cfg.alphaThreshold) continue;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (background) {
        const distance = Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]);
        if (distance <= cfg.backgroundTolerance) continue;
      }
      if (r < cfg.eyeLuma && g < cfg.eyeLuma && b < cfg.eyeBlue) {
        eyeMask[i] = 1;
      } else if (b - r > cfg.blueRedDiff && b > cfg.blueValue) {
        blueMask[i] = 1;
      } else {
        otherMask[i] = 1;
      }
    }
    // The head is a blue disc with dark eye pixels punched into it, so the snake mask has to
    // include those dark pixels or the fill would split the head in two.
    const snakeMask = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) snakeMask[i] = blueMask[i] | eyeMask[i];
    const nearSnake = dilate(snakeMask, canvasWidth, canvasHeight, 5);
    for (let i = 0; i < total; i += 1) {
      if (nearSnake[i]) otherMask[i] = 0;
    }

    const blueBlobs = collectBlobs(snakeMask, canvasWidth, canvasHeight, {
      data, eyeMask, colorMask: blueMask, minArea: cfg.minSnakeArea, maxArea: cfg.minSnakeArea * 400, maxBox: 4096
    });
    const dotBlobs = collectBlobs(otherMask, canvasWidth, canvasHeight, {
      data, minArea: 2, maxArea: cfg.dotMaxArea, maxBox: cfg.dotMaxBox
    });
    const summary = {
      ok: false,
      canvasWidth,
      canvasHeight,
      opaqueBackground: background,
      blueBlobs: blueBlobs.length,
      dotBlobs: dotBlobs.length
    };
    if (blueBlobs.length < 2) {
      return { ...summary, reason: 'fewer than two blue blobs were found' };
    }

    const dotPitchX = dotBlobs.length >= 4 ? measurePitch(dotBlobs.map((blob) => blob.x), canvasWidth) : null;
    const dotPitchY = dotBlobs.length >= 4 ? measurePitch(dotBlobs.map((blob) => blob.y), canvasHeight) : null;
    const bluePitchX = measurePitch(blueBlobs.map((blob) => blob.x), canvasWidth);
    const bluePitchY = measurePitch(blueBlobs.map((blob) => blob.y), canvasHeight);
    let pitchX = pickPitch(dotPitchX, bluePitchX, dotBlobs.length);
    let pitchY = pickPitch(dotPitchY, bluePitchY, dotBlobs.length);
    // A short snake lying in a single row/column gives no pitch along that axis, and the page
    // may paint the dot lattice with CSS instead of into the canvas. Fall back to square cells.
    const assumeSquare = (other, size) => ({
      pitch: other.pitch,
      columns: Math.max(4, Math.round(size / other.pitch)),
      lattice: 0,
      spanColumns: 0,
      phase: 0,
      assumed: true
    });
    if (!pitchX && pitchY) pitchX = assumeSquare(pitchY, canvasWidth);
    if (!pitchY && pitchX) pitchY = assumeSquare(pitchX, canvasHeight);
    if (!pitchX || !pitchY) {
      return {
        ...summary,
        reason: 'the cell pitch could not be measured',
        dotPitchX,
        dotPitchY,
        bluePitchX,
        bluePitchY
      };
    }
    const columns = Math.max(4, Math.round(canvasWidth / pitchX.pitch));
    const rows = Math.max(4, Math.round(canvasHeight / pitchY.pitch));
    const cellW = canvasWidth / columns;
    const cellH = canvasHeight / rows;
    const phaseX = circularMedian(blueBlobs.map((blob) => (blob.x / cellW) % 1));
    const phaseY = circularMedian(blueBlobs.map((blob) => (blob.y / cellH) % 1));

    const mapped = blueBlobs.map((blob) => {
      const rawX = blob.x / cellW - phaseX;
      const rawY = blob.y / cellH - phaseY;
      return {
        blob,
        gx: wrap(Math.round(rawX), columns),
        gy: wrap(Math.round(rawY), rows),
        residualX: Math.abs(rawX - Math.round(rawX)),
        residualY: Math.abs(rawY - Math.round(rawY))
      };
    });
    const byCell = new Map();
    let offGrid = 0;
    for (const entry of mapped) {
      if (entry.residualX > cfg.maxResidual || entry.residualY > cfg.maxResidual) {
        offGrid += 1;
        continue;
      }
      const key = cellKey(entry.gx, entry.gy);
      const existing = byCell.get(key);
      if (!existing || existing.blob.area < entry.blob.area) byCell.set(key, entry);
    }
    const cells = [...byCell.values()].map((entry) => ({
      x: entry.gx,
      y: entry.gy,
      color: entry.blob.color,
      area: entry.blob.area,
      eyes: entry.blob.eyes,
      px: entry.blob.x,
      py: entry.blob.y
    }));
    const geometry = {
      ...summary,
      columns,
      rows,
      cellW,
      cellH,
      pitchX: pitchX.pitch,
      pitchY: pitchY.pitch,
      pitchSourceX: pitchX.assumed ? 'assumed' : (pitchX === dotPitchX ? 'dots' : 'snake'),
      pitchSourceY: pitchY.assumed ? 'assumed' : (pitchY === dotPitchY ? 'dots' : 'snake'),
      spanColumnsX: pitchX.spanColumns,
      spanColumnsY: pitchY.spanColumns,
      phaseX,
      phaseY,
      offGrid,
      cells
    };
    if (cells.length < 2) {
      return { ...geometry, reason: 'fewer than two snake blobs landed on the measured grid' };
    }
    const blobShare = cells.length / (columns * rows);
    if (blobShare > cfg.maxBlobShare) {
      return {
        ...geometry,
        reason: `${(blobShare * 100).toFixed(0)}% of the cells hold a bright blob, which is the page's background animation and not a snake board`,
        blobShare
      };
    }

    const adjacency = cells.map((cell) => DIRS
      .map((dir) => cells.find((other) => other.x === wrap(cell.x + dir.x, columns) && other.y === wrap(cell.y + dir.y, rows)))
      .filter(Boolean));
    const component = (() => {
      const allowed = new Set();
      let best = new Set();
      const seen = new Array(cells.length).fill(false);
      for (let i = 0; i < cells.length; i += 1) {
        if (seen[i]) continue;
        const group = new Set([i]);
        const queue = [i];
        seen[i] = true;
        while (queue.length) {
          const current = queue.pop();
          for (const cell of adjacency[current]) {
            const j = cells.indexOf(cell);
            if (j >= 0 && !seen[j]) {
              seen[j] = true;
              group.add(j);
              queue.push(j);
            }
          }
        }
        if (group.size > best.size) best = group;
      }
      allowed.clear();
      return best;
    })();
    if (component.size < 2) {
      return { ...geometry, reason: 'the snake blobs are not adjacent on the measured grid' };
    }

    let eyeIndex;
    for (const index of component) {
      if (cells[index].eyes >= 2 && (eyeIndex === undefined || cells[index].eyes > cells[eyeIndex].eyes)) eyeIndex = index;
    }
    const endpointsOf = (allowed) => [...allowed].filter((index) => neighborsOf(cells, adjacency, allowed, index).length <= 1);
    let head = eyeIndex;
    if (head === undefined || !component.has(head)) {
      const endpoints = endpointsOf(component);
      const pool = endpoints.length ? endpoints : [...component];
      const largest = pool.reduce((acc, index) => (cells[index].area > cells[acc].area ? index : acc), pool[0]);
      const darkest = pool.reduce((acc, index) => (sum(cells[index].color) < sum(cells[acc].color) ? index : acc), pool[0]);
      head = largest !== pool[0] ? largest : darkest;
    }
    let allowed = new Set(component);
    let orderedIndexes = orderFrom(cells, adjacency, allowed, head);
    // The body may continue past the tail through the border wrap: absorb a tapering
    // blob that only touches the tail end, never the head end.
    let absorbed = 0;
    for (let guard = 0; guard < cfg.maxDecorations; guard += 1) {
      const tail = orderedIndexes[orderedIndexes.length - 1];
      const tailCell = cells[tail];
      const tailColor = sum(tailCell.color);
      const candidates = cells
        .map((cell, index) => ({ cell, index }))
        .filter(({ cell, index }) => !allowed.has(index) && DIRS.some((dir) => wrap(cell.x + dir.x, columns) === tailCell.x && wrap(cell.y + dir.y, rows) === tailCell.y));
      if (!candidates.length) break;
      const tapering = candidates.filter(({ cell }) => cell.area < tailCell.area * 1.15 && sum(cell.color) > tailColor - 40);
      if (tapering.length !== 1) break;
      allowed.add(tapering[0].index);
      absorbed += 1;
      orderedIndexes = orderFrom(cells, adjacency, allowed, head);
    }
    const ordered = orderedIndexes.map((index) => cells[index]);
    if (ordered.length < 2) {
      return { ...geometry, reason: 'the snake chain could not be ordered', absorbed };
    }
    const toNeck = directionFrom(ordered[0], ordered[1], columns, rows);
    if (toNeck < 0) {
      return { ...geometry, reason: 'the head and neck cells are not adjacent', absorbed };
    }
    const direction = (toNeck + 2) % 4;

    const chainKeys = new Set(ordered.map((cell) => cellKey(cell.x, cell.y)));
    const headCell = ordered[0];
    const candidates = cells
      .filter((cell) => !chainKeys.has(cellKey(cell.x, cell.y)))
      .map((cell) => ({
        x: cell.x,
        y: cell.y,
        area: cell.area,
        color: cell.color,
        distance: Math.min(Math.abs(cell.x - headCell.x), columns - Math.abs(cell.x - headCell.x))
          + Math.min(Math.abs(cell.y - headCell.y), rows - Math.abs(cell.y - headCell.y))
      }))
      .sort((a, b) => (a.distance - b.distance) || (b.area - a.area));
    const food = (() => {
      // A blob that touches the body is usually a segment the walk failed to claim (the taper
      // saturates on a long snake), while the food is normally drawn on its own. So prefer a
      // candidate that does not touch the chain; when every candidate touches it (the food itself
      // can sit right next to the snake) fall back to the nearest blob, which is the old rule.
      const touching = (cell) => DIRS.some((dir) => chainKeys.has(cellKey(wrap(cell.x + dir.x, columns), wrap(cell.y + dir.y, rows))));
      const detached = candidates.filter((cell) => !touching(cell));
      return (detached.length ? detached : candidates)[0] ?? null;
    })();
    const decorations = candidates.slice(1, 1 + cfg.maxDecorations);
    // Every blob the walk did not claim is still occupied pixels. On a long snake the taper
    // saturates, so some body segments are drawn exactly like their neighbours and the walk can
    // leave them out; handing them to the planner as walls is what stops it from driving into
    // one of them (which is the expensive failure: the snake treats its own segment as free).
    const obstacles = candidates
      .filter((cell) => cell !== food)
      .map((cell) => ({ x: cell.x, y: cell.y }));

    return {
      ...geometry,
      ok: true,
      width: columns,
      height: rows,
      cellSizeX: cellW,
      cellSizeY: cellH,
      snake: ordered.map((cell) => ({ x: cell.x, y: cell.y })),
      head: { x: headCell.x, y: headCell.y },
      neck: { x: ordered[1].x, y: ordered[1].y },
      food: food ? { x: food.x, y: food.y } : null,
      foodCandidate: food,
      decorations,
      obstacles,
      direction,
      headHasEyes: eyeIndex !== undefined && component.has(eyeIndex),
      absorbed,
      snakeCells: ordered,
      tailColor: ordered[ordered.length - 1].color,
      headColor: headCell.color
    };
  }

  const api = { analyzeBoard, collectBlobs, measurePitch, __internals: { wrap, median, circularMedian, DIRS, DEFAULTS } };
  root.SnakeVision = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
