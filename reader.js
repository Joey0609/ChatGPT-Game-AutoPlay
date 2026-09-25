/**
 * Board state reader: the exact React state when it is available, canvas vision as the fallback.
 *
 * bridge.js runs in the page's MAIN world, reads the game ref off the React fiber tree and posts a
 * plain snapshot here (`source: 'fiber'`); it gives columns/rows/segments/food/direction without
 * guessing. When the bridge has nothing fresh (no fiber, another game, an older page) the visible
 * canvas is analysed by vision.js (`source: 'canvas'`). Both produce the same shape, so the game
 * loop and the panel do not care which one won.
 */
(() => {
  'use strict';

  const BRIDGE_SOURCE = 'snake-autoplay-bridge';
  const CONTENT_SOURCE = 'snake-autoplay';
  const DIRECTION_INDEX = { up: 0, right: 1, down: 2, left: 3 };
  const BRIDGE_STALE_MS = 1500;

  function wrap(value, size) {
    return ((value % size) + size) % size;
  }

  function create(options) {
    const page = options.page;
    const vision = options.vision;
    const log = options.log;
    const dirs = options.dirs || [];
    const staleMs = options.staleMs || BRIDGE_STALE_MS;

    let ready = false;
    let snapshot = null;
    let snapshotAt = -1e9;
    let seq = 0;
    let lastHead = null;

    // Pixels cannot tell the neck from a folded body when the taper saturates (a long snake draws a
    // long run of identical blobs), but time can: the head just moved into its current cell from
    // the neck, so the previous head cell IS the neck as long as the two reads are one step apart.
    // That pins the heading exactly, which is the only thing the planner needs from the order.
    function refineDirection(state) {
      if (!state || !state.ok || !state.head) return state;
      const head = state.head;
      if (state.source === 'canvas' && lastHead && (lastHead.x !== head.x || lastHead.y !== head.y)) {
        const index = dirs.findIndex((dir) =>
          wrap(lastHead.x + dir.x, state.width) === head.x && wrap(lastHead.y + dir.y, state.height) === head.y);
        if (index >= 0) {
          state.direction = index;
          state.directionSource = 'motion';
        }
      }
      if (!state.directionSource) state.directionSource = 'chain';
      return state;
    }

    function onMessage(event) {
      const data = event && event.data;
      if (!data || typeof data !== 'object' || data.source !== BRIDGE_SOURCE) return;
      if (data.type === 'snake:bridge-ready') {
        if (!ready) {
          ready = true;
          log.info('React bridge is available.', { version: data.version });
        }
        return;
      }
      ready = true;
      if (data.type === 'snake:missing') {
        snapshot = null;
        snapshotAt = performance.now();
        return;
      }
      if (data.type === 'snake:state') {
        snapshot = data.state || null;
        snapshotAt = performance.now();
        seq = data.seq || seq;
      }
    }

    function start() {
      try {
        window.addEventListener('message', onMessage);
      } catch (error) {
        log.warn('Could not listen for the React bridge.', { error: String(error) });
      }
    }

    function ask() {
      try {
        window.postMessage({ source: CONTENT_SOURCE, type: 'snake:poll' }, '*');
      } catch (error) {
        // The bridge simply stays as stale as it was.
      }
    }

    function fresh() {
      return !!snapshot && performance.now() - snapshotAt <= staleMs;
    }

    function info() {
      return { ready, fresh: fresh(), seq, snapshot };
    }

    // segments[0] is the head, but a page update could hand us the tail first: the direction field
    // settles it, because the head sits one step ahead of the neck along the current heading.
    function orientSnake(cells, columns, rows, direction) {
      if (cells.length < 2 || !direction) return cells;
      const fits = (head, neck) =>
        wrap(neck.x + direction.x, columns) === head.x && wrap(neck.y + direction.y, rows) === head.y;
      if (fits(cells[0], cells[1])) return cells;
      const reversed = cells.slice().reverse();
      if (fits(reversed[0], reversed[1])) return reversed;
      return cells;
    }

    function fromBridge() {
      if (!fresh()) return null;
      const payload = snapshot;
      if (!payload || payload.type !== 'snake') return null;
      const columns = Math.round(payload.columns);
      const rows = Math.round(payload.rows);
      if (!(columns > 0) || !(rows > 0)) return null;
      const total = columns * rows;
      const seen = new Set();
      const cells = [];
      for (const raw of payload.segments || []) {
        const index = Number(raw);
        if (!Number.isFinite(index) || index < 0 || index >= total) continue;
        const key = `${Math.round(index)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ x: index % columns, y: Math.floor(index / columns) });
      }
      if (!cells.length) return null;

      const rawDirection = DIRECTION_INDEX[payload.direction];
      const queued = DIRECTION_INDEX[payload.queuedDirection];
      // The queued turn is the heading the game will use on the next tick, so plan against it.
      const direction = queued !== undefined ? queued : (rawDirection !== undefined ? rawDirection : -1);
      const heading = dirs[rawDirection !== undefined ? rawDirection : direction] || null;
      const ordered = orientSnake(cells, columns, rows, heading);
      const head = ordered[0];
      if (!head) return null;

      let food = null;
      if (Number.isFinite(payload.food) && payload.food >= 0 && payload.food < total) {
        food = { x: payload.food % columns, y: Math.floor(payload.food / columns) };
      }

      let canvasWidth = 0;
      let canvasHeight = 0;
      const board = page.board();
      const canvas = board ? page.gameCanvas(board) : null;
      if (canvas) {
        canvasWidth = canvas.width || 0;
        canvasHeight = canvas.height || 0;
      }
      const cellW = canvasWidth ? canvasWidth / columns : 0;
      const cellH = canvasHeight ? canvasHeight / rows : 0;
      return {
        ok: true,
        source: 'fiber',
        width: columns,
        height: rows,
        columns,
        rows,
        snake: ordered,
        head,
        neck: ordered[1] || null,
        tail: ordered[ordered.length - 1],
        food,
        direction: direction >= 0 ? direction : 1,
        gameOver: !!payload.gameOver,
        score: payload.score,
        queuedDirection: payload.queuedDirection || null,
        cellSizeX: cellW,
        cellSizeY: cellH,
        pitchX: cellW,
        pitchY: cellH,
        pitchSourceX: 'fiber',
        pitchSourceY: 'fiber',
        phaseX: 0.5,
        phaseY: 0.5,
        offGrid: 0,
        headHasEyes: true,
        absorbed: 0,
        decorations: [],
        obstacles: [],
        blueBlobs: ordered.length + (food ? 1 : 0),
        dotBlobs: 0,
        canvasWidth,
        canvasHeight,
        bridgeSeq: seq
      };
    }

    function fromCanvas(board) {
      if (!vision) return { ok: false, reason: 'vision.js did not load' };
      const canvas = page.gameCanvas(board);
      if (!canvas) return { ok: false, notStarted: true, reason: 'the game is not on screen (it has not started)' };
      const read = page.pixels(canvas);
      if (read.error) return { ok: false, reason: read.error };
      const state = vision.analyzeBoard(read.image, read.width, read.height);
      state.canvasWidth = read.width;
      state.canvasHeight = read.height;
      state.source = state.ok ? 'canvas' : 'none';
      if (!state.ok && ready && !fresh()) {
        state.reason = `${state.reason} (the React bridge had no fresh state either)`;
      }
      return state;
    }

    function read(board) {
      if (!board) return { ok: false, reason: 'the game board is not on the page' };
      // The board element lives in the page for the whole image-generation wait, but the game
      // itself is only on screen while the page shows the game canvas: until then the page renders
      // its background animation there. Reading that animation produces a plausible-looking but
      // meaningless "board" (a full dot lattice), so nothing is read - and nothing is pressed -
      // until the game canvas is actually shown.
      if (!page.gameCanvas(board)) {
        return { ok: false, notStarted: true, reason: 'the game is not on screen (it has not started)' };
      }
      const bridged = fromBridge();
      if (bridged) {
        // The fiber state knows the real heading (and the queued turn), so it is not refined.
        lastHead = bridged.head ? { x: bridged.head.x, y: bridged.head.y } : null;
        return bridged;
      }
      const state = refineDirection(fromCanvas(board));
      if (state.ok) lastHead = { x: state.head.x, y: state.head.y };
      return state;
    }

    return { start, read, ask, fresh, info };
  }

  window.SnakeReader = { create, BRIDGE_SOURCE, CONTENT_SOURCE, BRIDGE_STALE_MS };
})();
