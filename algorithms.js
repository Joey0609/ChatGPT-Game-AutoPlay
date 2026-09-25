// Snake algorithms. The board is a torus: leaving one edge re-enters on the opposite one, so
// every neighbour lookup has to wrap. Cell coordinates are integers x in [0,width), y in [0,height).
(function (root) {
  'use strict';

  const DIRS = [
    { x: 0, y: -1, key: 'ArrowUp', name: 'up', label: '↑' },
    { x: 1, y: 0, key: 'ArrowRight', name: 'right', label: '→' },
    { x: 0, y: 1, key: 'ArrowDown', name: 'down', label: '↓' },
    { x: -1, y: 0, key: 'ArrowLeft', name: 'left', label: '←' }
  ];

  const wrap = (value, size) => ((value % size) + size) % size;
  const key = (p) => `${p.x},${p.y}`;

  function neighbors(p, width, height) {
    return DIRS.map((dir) => ({ x: wrap(p.x + dir.x, width), y: wrap(p.y + dir.y, height) }));
  }

  function directionTo(from, to, width, height) {
    for (let i = 0; i < DIRS.length; i += 1) {
      if (wrap(from.x + DIRS[i].x, width) === to.x && wrap(from.y + DIRS[i].y, height) === to.y) return i;
    }
    return -1;
  }

  function manhattan(a, b, width, height) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return Math.min(dx, width - dx) + Math.min(dy, height - dy);
  }

  // Breadth first search on the torus. `blocked` is a Set of "x,y" keys.
  // Returns the cells to walk through after the start (goal included) or null.
  function bfsPath(start, goal, blocked, width, height) {
    const startKey = key(start);
    const goalKey = key(goal);
    if (startKey === goalKey) return [];
    const queue = [start];
    const cameFrom = new Map([[startKey, null]]);
    let head = 0;
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      for (const next of neighbors(current, width, height)) {
        const nextKey = key(next);
        if (cameFrom.has(nextKey)) continue;
        if (blocked.has(nextKey) && nextKey !== goalKey) continue;
        cameFrom.set(nextKey, current);
        if (nextKey === goalKey) {
          const path = [];
          let node = next;
          while (node && key(node) !== startKey) {
            path.push(node);
            node = cameFrom.get(key(node));
          }
          return path.reverse();
        }
        queue.push(next);
      }
    }
    return null;
  }

  function reachableArea(start, blocked, width, height) {
    const seen = new Set([key(start)]);
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      for (const next of neighbors(current, width, height)) {
        const nextKey = key(next);
        if (seen.has(nextKey) || blocked.has(nextKey)) continue;
        seen.add(nextKey);
        queue.push(next);
      }
    }
    return seen.size;
  }

  // `tailFree` leaves the last segment out of the blocked set, which both lets the head walk into
  // the cell the tail is vacating this step and counts it as free space.
  function bodyKeys(snake, tailFree, obstacles) {
    const blocked = new Set();
    const last = tailFree ? snake.length - 1 : snake.length;
    for (let i = 0; i < last; i += 1) blocked.add(key(snake[i]));
    // Blobs the reader could not walk into the body (an unwalked segment on a long snake, or a
    // second blob the food pick passed over) still stand for occupied pixels: treating them as
    // walls is what keeps the planner from steering into a cell it believes is free.
    if (obstacles) for (const cell of obstacles) blocked.add(key(cell));
    return blocked;
  }

  function walkSnake(snake, path, food, width, height) {
    const body = snake.map((cell) => ({ ...cell }));
    const willEat = food && path.some((cell) => cell.x === food.x && cell.y === food.y);
    for (const step of path) {
      body.unshift({ x: step.x, y: step.y });
      if (!willEat || key(step) !== key(path[path.length - 1])) body.pop();
    }
    return body;
  }

  function tailIsReachable(snake, width, height, obstacles) {
    const tail = snake[snake.length - 1];
    const blocked = bodyKeys(snake, true, obstacles);
    if (snake.length < 3) return true;
    return bfsPath(snake[0], tail, blocked, width, height) !== null;
  }

  // Move that keeps the most space available, breaking ties towards the food.
  function safestMove(state, options) {
    const { width, height, snake } = state;
    const food = state.food || null;
    // Real collision rule (from the game's own source):
    //   hitSelf = segments.indexOf(next)
    //   gameOver = hitSelf !== -1 && (hitFood || hitSelf < segments.length - 1)
    // so walking into the *last* segment is legal: the tail vacates that cell on this very step, and
    // food never spawns on the body, so that move can never eat at the same time. It stays free for
    // snakes longer than three segments, where the head sitting next to its own tail is a real
    // position worth using. Measured: with the tail blocked instead, the space-first strategy stops
    // reaching the food (flood ate 1 instead of 140 in the simulation) because every candidate loses
    // the same cell of room.
    const tailFree = snake.length > 3 || Boolean(options && options.tailFree);
    const blocked = bodyKeys(snake, tailFree, state.obstacles);
    // The cell the snake may enter this step: the snake's own body except the tail (and the neck is
    // excluded below by the no-reverse rule).
    const reverse = state.direction >= 0 ? (state.direction + 2) % 4 : -1;
    let best = null;
    for (let i = 0; i < DIRS.length; i += 1) {
      if (i === reverse && snake.length > 2) continue;
      const next = { x: wrap(snake[0].x + DIRS[i].x, width), y: wrap(snake[0].y + DIRS[i].y, height) };
      if (blocked.has(key(next))) continue;
      const area = reachableArea(next, blocked, width, height);
      const distance = food ? manhattan(next, food, width, height) : 0;
      const score = area * 4 - distance;
      if (!best || score > best.score) best = { index: i, score, area, distance };
    }
    if (!best) {
      // Every neighbour is body: the last chance is the cell the tail leaves behind, which the real
      // game accepts, so the snake may survive a step the old heuristic called trapped. Only if even
      // that fails does it pick anything that is not the neck.
      const tailKey = snake.length ? key(snake[snake.length - 1]) : null;
      for (let i = 0; i < DIRS.length; i += 1) {
        if (i === reverse && snake.length > 2) continue;
        const next = { x: wrap(snake[0].x + DIRS[i].x, width), y: wrap(snake[0].y + DIRS[i].y, height) };
        if (tailKey && key(next) === tailKey) return { index: i, reason: 'tail-escape', area: 0, distance: 0 };
      }
      for (let i = 0; i < DIRS.length; i += 1) {
        if (i === reverse && snake.length > 2) continue;
        return { index: i, reason: 'trapped', area: 0, distance: 0 };
      }
      return { index: wrap(state.direction + 1, 4), reason: 'trapped', area: 0, distance: 0 };
    }
    return { ...best, reason: food ? 'space-then-food' : 'space' };
  }

  // The game's own pace: 190 ms per step, 7 ms faster per eaten food, never below 95 ms.
  function stepIntervalMs(score) {
    const points = Number.isFinite(score) ? score : 0;
    return Math.max(95, 190 - 7 * points);
  }

  function pathToFood(state) {
    const { width, height, snake, food } = state;
    if (!food) return null;
    const blocked = bodyKeys(snake, true, state.obstacles);
    const path = bfsPath(snake[0], food, blocked, width, height);
    if (!path || !path.length) return null;
    // Walk the whole path forward and demand that the snake keeps room to breathe at every
    // single step. Checking only the end state lets a long snake walk into a pocket.
    let body = snake;
    for (const step of path) {
      const direction = directionTo(body[0], step, width, height);
      if (direction < 0) return null;
      body = stepSnake({ width, height, snake: body, food }, direction);
      if (!tailIsReachable(body, width, height, state.obstacles)) return null;
      const room = reachableArea(body[0], bodyKeys(body, true, state.obstacles), width, height);
      if (room <= body.length) return null;
    }
    return path;
  }

  // Hamiltonian cycle over the whole torus. Any w,h >= 3 works: for an even height the
  // serpentine rows close on themselves; for an odd height the last column is walked back
  // upwards and the wrap in x closes the loop.
  function cycleCoordinates(width, height) {
    if (width < 2 || height < 2) return [];
    const cycle = [];
    const limit = height % 2 === 0 ? width : width - 1;
    for (let y = 0; y < height; y += 1) {
      if (y % 2 === 0) {
        for (let x = 0; x < limit; x += 1) cycle.push({ x, y });
      } else {
        for (let x = limit - 1; x >= 0; x -= 1) cycle.push({ x, y });
      }
    }
    if (height % 2 === 1) {
      for (let y = height - 1; y >= 0; y -= 1) cycle.push({ x: width - 1, y });
    }
    return cycle;
  }

  function cycleDirection(state) {
    const { width, height, snake, food } = state;
    const cycle = cycleCoordinates(width, height);
    if (cycle.length !== width * height) return null;
    const index = new Map(cycle.map((cell, i) => [key(cell), i]));
    const total = cycle.length;
    const headIndex = index.get(key(snake[0]));
    const tailIndex = index.get(key(snake[snake.length - 1]));
    if (headIndex === undefined || tailIndex === undefined) return null;
    const body = bodyKeys(snake, true, state.obstacles);
    const successor = cycle[(headIndex + 1) % total];
    const predecessor = cycle[(headIndex - 1 + total) % total];
    let step = 1;
    if (body.has(key(successor))) {
      // The snake is walking the cycle the other way round: follow it so we never reverse.
      if (body.has(key(predecessor))) return null;
      step = -1;
    }
    const ahead = (target) => ((target - headIndex) * step + total * 2) % total;
    const tailAhead = ahead(tailIndex);
    if (food) {
      const foodIndex = index.get(key(food));
      const foodAhead = foodIndex === undefined ? -1 : ahead(foodIndex);
      // A short hop towards food that already sits in the free arc cannot cut the body in two.
      // Hops are kept short on purpose: a long detour leaves the body tangled and throws away
      // the survival guarantee the cycle buys us.
      if (foodAhead > 0 && foodAhead <= 3 && tailAhead > snake.length + foodAhead + 2) {
        const path = pathToFood(state);
        if (path && path.length && path.length <= foodAhead) {
          const direction = directionTo(snake[0], path[0], width, height);
          if (direction >= 0) return { index: direction, reason: 'cycle-eat', area: 0, distance: foodAhead };
        }
      }
    }
    const next = cycle[(headIndex + step + total) % total];
    const direction = directionTo(snake[0], next, width, height);
    if (direction < 0) return null;
    return {
      index: direction,
      reason: 'cycle',
      area: 0,
      distance: food ? ahead(index.get(key(food))) : 0
    };
  }

  function stepSnake(state, direction) {
    const { width, height, snake, food } = state;
    const head = snake[0];
    const next = { x: wrap(head.x + DIRS[direction].x, width), y: wrap(head.y + DIRS[direction].y, height) };
    const eating = Boolean(food) && next.x === food.x && next.y === food.y;
    const body = eating ? snake : snake.slice(0, -1);
    return [next, ...body.map((cell) => ({ ...cell }))];
  }

  const ALGORITHMS = [
    { id: 'bfs', label: '安全寻路 (BFS)' },
    { id: 'flood', label: '空间优先 (Flood)' },
    { id: 'cycle', label: '哈密顿环 (Cycle)' }
  ];

  // The cells a plan intends to walk, starting with the cell the head enters next. It is what the
  // panel draws, so it must be a contiguous run on the torus and never longer than the drawing
  // needs: the food path when it starts with the planned step, the Hamiltonian run for cycle moves,
  // and otherwise the single next cell.
  const ROUTE_LIMIT = 28;

  function routeFor(state, planned, limit) {
    const { width, height, snake, food } = state;
    const size = limit || ROUTE_LIMIT;
    const dir = DIRS[planned.index];
    if (!dir) return [];
    const next = { x: wrap(snake[0].x + dir.x, width), y: wrap(snake[0].y + dir.y, height) };
    const blocked = bodyKeys(snake, true, state.obstacles);
    if (food) {
      const path = bfsPath(snake[0], food, blocked, width, height);
      if (path && path.length && key(path[0]) === key(next)) return path.slice(0, size);
    }
    if (String(planned.reason).indexOf('cycle') === 0) {
      const cycle = cycleCoordinates(width, height);
      if (cycle.length === width * height) {
        const index = new Map(cycle.map((cell, i) => [key(cell), i]));
        const headIndex = index.get(key(snake[0]));
        if (headIndex !== undefined) {
          const clockwise = key(cycle[(headIndex + 1) % cycle.length]) === key(next);
          const step = clockwise ? 1 : -1;
          const route = [];
          for (let i = 1; i <= Math.min(size, cycle.length); i += 1) {
            route.push(cycle[((headIndex + step * i) % cycle.length + cycle.length) % cycle.length]);
          }
          return route;
        }
      }
    }
    return [next];
  }

  // Returns { index, reason, route } where index is a DIRS index, or null when the state is
  // unusable. The Hamiltonian cycle is the only strategy with a survival guarantee, so every
  // algorithm falls back to it before the greedy heuristics can walk the snake into a pocket.
  function planMove(state, algorithm) {
    const { width, height, snake } = state;
    if (!snake || snake.length < 1 || width < 2 || height < 2) return null;
    const cells = width * height;
    const cyclePlan = () => {
      const planned = cycleDirection(state);
      if (!planned) return null;
      const next = stepSnake(state, planned.index);
      return tailIsReachable(next, width, height, state.obstacles) ? planned : null;
    };
    let chosen = null;
    if (algorithm === 'cycle') {
      chosen = cyclePlan() || safestMove(state);
    } else if (algorithm === 'flood') {
      const space = safestMove(state);
      if (space.area < Math.max(8, snake.length * 1.5)) {
        const planned = cyclePlan();
        chosen = planned ? { ...planned, reason: 'cycle-fallback' } : space;
      } else {
        chosen = space;
      }
    } else {
      // bfs: chase the food while there is plenty of room, then ride the cycle.
      const path = pathToFood(state);
      const roomy = snake.length < cells * 0.35;
      const planned = cyclePlan();
      if (path && path.length && roomy) {
        const direction = directionTo(snake[0], path[0], width, height);
        if (direction >= 0) chosen = { index: direction, reason: 'food-path', area: 0, distance: path.length };
      }
      if (!chosen && planned) chosen = planned;
      if (!chosen && path && path.length) {
        const direction = directionTo(snake[0], path[0], width, height);
        if (direction >= 0) chosen = { index: direction, reason: 'food-path', area: 0, distance: path.length };
      }
      if (!chosen) chosen = safestMove(state);
    }
    if (!chosen) return null;
    return { ...chosen, route: routeFor(state, chosen, ROUTE_LIMIT) };
  }

  function chooseMove(state, algorithm) {
    const planned = planMove(state, algorithm);
    return planned ? planned.index : null;
  }

  const api = {
    DIRS,
    ALGORITHMS,
    wrap,
    key,
    neighbors,
    directionTo,
    manhattan,
    bfsPath,
    reachableArea,
    safestMove,
    pathToFood,
    stepIntervalMs,
    routeFor,
    cycleCoordinates,
    cycleDirection,
    planMove,
    chooseMove
  };
  root.SnakeAlgorithms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
