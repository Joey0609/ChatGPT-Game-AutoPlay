/**
 * ChatGPT snake autoplay - MAIN world bridge.
 *
 * The exact game state lives in a React ref inside the page
 * (`{ type: "snake", state: { columns, rows, segments, previousSegments, food, direction,
 * queuedDirection, score, lastStepAtMs, gameOver } }`, `segments[0]` is the head and every
 * segment/food is a flat cell index `row * columns + column`). DOM code cannot see a React ref,
 * so this file runs in the page's own JavaScript world (`"world": "MAIN"` in the manifest), where
 * it can walk the fiber tree and read the ref directly. It then posts a plain snapshot to the
 * content script with `window.postMessage`; reading pixels in vision.js stays as a fallback for
 * the cases where React is not found (a renamed minified key, a different game, a canvas-only
 * board).
 *
 * Protocol (all messages are tagged so both sides can ignore their own traffic):
 *   content -> main : { source: 'snake-autoplay',        type: 'snake:poll' }              ask now
 *   main -> content : { source: 'snake-autoplay-bridge', type: 'snake:bridge-ready' }       once
 *   main -> content : { source: 'snake-autoplay-bridge', type: 'snake:state', state: {...} }
 *
 * The snapshot is sent whenever it changes and as a heartbeat, so the content script always has a
 * recent state without a request per game tick. Nothing in the game state is mutated here.
 */
(() => {
  'use strict';

  const CONTENT_SOURCE = 'snake-autoplay';
  const BRIDGE_SOURCE = 'snake-autoplay-bridge';
  const GAME_SELECTOR = '[data-testid="image-gen-loading-game-board"]';
  const LOG_PREFIX = '[Snake Autoplay]';
  const VERSION = '1.0.0';

  // The real game steps every 95..190 ms (max(95, 190 - 7*score)); polling clearly faster than the
  // fastest step keeps the content script's view of `segments`/`queuedDirection` current.
  const POLL_MS = 40;
  const HEARTBEAT_MS = 1000;
  const MAX_FIBER_NODES = 40000;
  const MAX_HOOKS = 200;

  let lastSignature = '';
  let lastSentAt = 0;
  let sent = 0;
  let pollTimer = null;

  // ------------------------------------------------------------------ fiber access

  function fiberOf(node) {
    if (!node) return null;
    for (const key of Object.keys(node)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) return node[key];
    }
    return null;
  }

  function isGameRef(value) {
    if (!value || typeof value !== 'object') return false;
    if (typeof value.type !== 'string' || !value.state || typeof value.state !== 'object') return false;
    const state = value.state;
    return state.segments !== undefined || state.bricks !== undefined;
  }

  function gameInHooks(fiber) {
    let hook = fiber ? fiber.memoizedState : null;
    let guard = 0;
    while (hook && guard < MAX_HOOKS) {
      const memo = hook.memoizedState;
      if (memo && typeof memo === 'object') {
        if ('current' in memo && isGameRef(memo.current)) return memo.current;
        if ('current' in memo && memo.current && typeof memo.current === 'object') {
          const nested = memo.current.state;
          if (nested && (nested.segments !== undefined || nested.bricks !== undefined)) return memo.current;
        }
      }
      if (isGameRef(hook.baseState)) return hook.baseState;
      hook = hook.next;
      guard += 1;
    }
    return null;
  }

  function gameFromFiber(fiber, budget) {
    const stack = [fiber];
    let seen = 0;
    while (stack.length && seen < budget) {
      const node = stack.pop();
      if (!node) continue;
      seen += 1;
      const found = gameInHooks(node);
      if (found) return found;
      if (node.child) stack.push(node.child);
      if (node.sibling) stack.push(node.sibling);
    }
    return null;
  }

  // Looks for the game ref along the board's ancestors first (cheap and exact), then in the whole
  // fiber tree that hangs off the nearest root.
  function findGame() {
    const board = document.querySelector(GAME_SELECTOR);
    const start = fiberOf(board);
    let fiber = start;
    while (fiber) {
      const found = gameInHooks(fiber);
      if (found) return { game: found, how: 'ancestor' };
      fiber = fiber.return;
    }
    let root = start;
    let guard = 0;
    while (root && root.return && guard < 5000) {
      root = root.return;
      guard += 1;
    }
    if (!root) return null;
    const found = gameFromFiber(root, MAX_FIBER_NODES);
    return found ? { game: found, how: 'tree' } : null;
  }

  // ------------------------------------------------------------------ snapshot

  function toArray(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value.slice();
    if (typeof value.length === 'number') return Array.prototype.slice.call(value);
    if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
    return null;
  }

  function snapshot(game) {
    const state = game.state || {};
    return {
      type: game.type,
      columns: Number(state.columns) || 0,
      rows: Number(state.rows) || 0,
      segments: toArray(state.segments) || [],
      previousSegments: toArray(state.previousSegments),
      food: Number.isFinite(state.food) ? state.food : null,
      direction: state.direction || null,
      queuedDirection: state.queuedDirection || null,
      score: Number.isFinite(state.score) ? state.score : null,
      gameOver: !!state.gameOver,
      lastStepAtMs: Number.isFinite(state.lastStepAtMs) ? state.lastStepAtMs : null
    };
  }

  function signatureOf(payload) {
    return [
      payload.type, payload.columns, payload.rows,
      payload.segments.join(','), payload.food, payload.direction,
      payload.queuedDirection, payload.score, payload.gameOver
    ].join('|');
  }

  function post(message) {
    try {
      window.postMessage(message, '*');
      return true;
    } catch (error) {
      return false;
    }
  }

  function publish(force) {
    const found = findGame();
    if (!found) {
      if (force) post({ source: BRIDGE_SOURCE, type: 'snake:missing', version: VERSION });
      return null;
    }
    const payload = snapshot(found.game);
    const signature = signatureOf(payload);
    const now = Date.now();
    if (!force && signature === lastSignature && now - lastSentAt < HEARTBEAT_MS) return payload;
    lastSignature = signature;
    lastSentAt = now;
    sent += 1;
    post({
      source: BRIDGE_SOURCE,
      type: 'snake:state',
      version: VERSION,
      how: found.how,
      seq: sent,
      state: payload
    });
    return payload;
  }

  // ------------------------------------------------------------------ wiring

  window.addEventListener('message', (event) => {
    const data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== CONTENT_SOURCE) return;
    if (data.type === 'snake:poll') publish(true);
  });

  window.__snakeAutoplayBridge = {
    version: VERSION,
    read: () => {
      const found = findGame();
      return found ? snapshot(found.game) : null;
    },
    publish,
    get sent() { return sent; }
  };

  pollTimer = setInterval(() => publish(false), POLL_MS);
  if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();

  post({ source: BRIDGE_SOURCE, type: 'snake:bridge-ready', version: VERSION });
  console.log(`${LOG_PREFIX} React bridge loaded; waiting for the game state.`);
})();
