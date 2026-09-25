/**
 * ChatGPT Game Autoplay - the orchestrator (content script, isolated world).
 *
 * This file holds only the game loop and the wiring; each concern lives in its own module:
 *   algorithms.js  how to move        (BFS / flood / Hamiltonian cycle planners)
 *   vision.js      canvas -> state    (pixel recognition of the board)
 *   bridge.js      React -> state     (MAIN world bridge that reads the game ref off the fiber tree)
 *   reader.js      state              (bridge first, canvas vision as the fallback)
 *   page.js        DOM + keys         (board element, canvas pixels, keyboard events)
 *   panel.js       UI                 (the floating panel on the right)
 *   config.js      settings           (defaults + chrome.storage.sync)
 */
(() => {
  'use strict';

  const log = window.SnakeLog;
  const Page = window.SnakePage;
  const Reader = window.SnakeReader;
  const Panel = window.SnakePanel;
  const Config = window.SnakeConfig;
  const Algorithms = window.SnakeAlgorithms;
  const Vision = window.SnakeVision;
  const DIRS = (Algorithms && Algorithms.DIRS) || [];
  const ALGORITHMS = (Algorithms && Algorithms.ALGORITHMS) || [];
  const I18n = window.SnakeI18n;
  // Console logs stay English on purpose (the README documents their wording); only the panel is
  // translated, and it asks i18n.js for the direction labels of the configured language.
  const DIRECTION_NAMES = ['up', 'right', 'down', 'left'];

  const config = { ...(Config ? Config.defaults : { algorithm: 'bfs', interval: 50, autoStart: true, panel: true }) };
  const stats = { moves: 0, recognized: 0, failures: 0, eaten: 0 };
  const reader = Reader.create({ page: Page, vision: Vision, log, dirs: DIRS });

  let enabled = false;
  let timer = null;
  let observer = null;
  let overlay = null;
  let boardKnown = false;
  let gameStarted = false;
  let gameOnScreen = false;
  let lastRead = null;
  let lastPlan = null;
  let lastSentAt = 0;
  let lastSpaceAt = -1e9;
  let lastSentSignature = '';
  let lastDirection = -1;
  let lastMoveLogAt = 0;
  let lastDisplay = { head: null, length: 0 };
  let lastReportAt = -1e9;
  let lastReportedLength = -1;

  reader.start();

  // ------------------------------------------------------------------ input

  // Sends one arrow key to the game element, exactly like a human pressing it.
  function sendDirection(index, source, reason) {
    const dir = DIRS[index];
    const board = Page.board();
    if (!dir || !board) return false;
    Page.focus(board);
    Page.pressKey(board, dir.key, dir.key);
    lastSentSignature = '';
    if (source === 'manual') {
      log.info('Direction key sent.', { source, direction: dir.name, key: dir.key, reason });
    }
    return true;
  }

  function resumeGame() {
    const board = Page.board();
    if (!board) return;
    Page.pressSpace(board);
  }

  // ------------------------------------------------------------------ reporting

  function stateSignature(state) {
    const food = state.food ? `${state.food.x},${state.food.y}` : '-';
    return `${state.head.x},${state.head.y}|${state.snake.length}|${state.direction}|${food}`;
  }

  function reportState(state) {
    // The live state is on the panel; in the console keep the first reading, every growth and a
    // slow heartbeat instead of one dump per game tick.
    const now = performance.now();
    const grew = state.snake.length !== lastReportedLength;
    if (lastReportedLength >= 0 && !grew && now - lastReportAt < 3000) return;
    lastReportAt = now;
    lastReportedLength = state.snake.length;

    if (state.source === 'fiber') {
      log.info('Board state read from the React state.', {
        source: 'react',
        grid: `${state.width}x${state.height}`,
        cell: state.cellSizeX ? state.cellSizeX.toFixed(1) : 'unknown',
        snake: state.snake.length,
        head: `(${state.head.x},${state.head.y})`,
        food: state.food ? `(${state.food.x},${state.food.y})` : 'none',
        direction: DIRECTION_NAMES[state.direction],
        queued: state.queuedDirection || 'none',
        score: state.score,
        gameOver: state.gameOver
      });
      return;
    }
    log.info('Board state recognized.', {
      source: 'canvas',
      grid: `${state.width}x${state.height}`,
      cell: `${state.cellSizeX.toFixed(1)}x${state.cellSizeY.toFixed(1)}`,
      pitch: `${state.pitchX.toFixed(2)}x${state.pitchY.toFixed(2)} (${state.pitchSourceX}/${state.pitchSourceY})`,
      phase: `${state.phaseX.toFixed(3)}/${state.phaseY.toFixed(3)}`,
      offGrid: state.offGrid,
      snake: state.snake.length,
      head: `(${state.head.x},${state.head.y})`,
      eyes: state.headHasEyes,
      absorbed: state.absorbed,
      food: state.food ? `(${state.food.x},${state.food.y})` : 'none',
      direction: DIRECTION_NAMES[state.direction],
      decorations: state.decorations.length
    });
  }

  function reportFailure(state) {
    if (state && state.notStarted) {
      log.once('not-started', 'info', 'The game has not started; no keys are sent until its canvas appears.', {
        status: Page.statusText()
      });
      return;
    }
    log.once('failure', 'warn', 'Board state not recognized.', {
      reason: state.reason,
      canvas: state.canvasWidth ? `${state.canvasWidth}x${state.canvasHeight}` : 'unknown',
      blueBlobs: state.blueBlobs,
      dotBlobs: state.dotBlobs
    });
  }

  // ------------------------------------------------------------------ game loop

  function step(board) {
    // The board element is on the page long before the game is: while the image is still being
    // generated the page draws its background animation there and the game canvas stays faded out.
    // Nothing may be pressed then - arrow keys and Space would go to the page, not to a game - and
    // the panel says so instead of showing a board made up from the background animation.
    if (!Page.gameCanvas(board)) {
      if (gameOnScreen) {
        gameOnScreen = false;
        gameStarted = false;
        lastSentSignature = '';
        lastDirection = -1;
        log.info('The game left the screen; waiting for it to start.', { status: Page.statusText() });
      }
      lastRead = { ok: false, notStarted: true, reason: 'the game has not started yet' };
      lastPlan = null;
      return;
    }
    if (!gameOnScreen) {
      gameOnScreen = true;
      log.info('The game canvas is on screen.', { status: Page.statusText() });
    }

    const status = Page.statusText();
    if (/已暂停|paused/i.test(status) && !gameStarted) {
      const now = performance.now();
      if (now - lastSpaceAt > 800) {
        lastSpaceAt = now;
        resumeGame();
        log.info('The game was paused; sent Space to start it.', { status });
      }
      return;
    }

    const state = reader.read(board);
    lastRead = state;
    if (!state.ok) {
      stats.failures += 1;
      reportFailure(state);
      return;
    }
    stats.recognized += 1;
    reportState(state);

    if (state.gameOver) {
      log.once('gameover', 'info', 'The game reports game over; waiting for the next round.', {
        score: state.score,
        length: state.snake.length
      });
      gameStarted = false;
      return;
    }

    if (lastDisplay.head && state.snake.length > lastDisplay.length) {
      stats.eaten += state.snake.length - lastDisplay.length;
    }
    lastDisplay = { head: state.head, length: state.snake.length };

    const signature = stateSignature(state);
    const now = performance.now();
    // Real game rules: a step applies `queuedDirection ?? direction` and the game ignores every key
    // pressed while `queuedDirection` is still set, so exactly one direction per step may be queued.
    // With the React bridge we can see that flag, which makes the pace exact instead of guessed: the
    // state becomes "not consumed" the moment the game applies our key, and only then do we plan the
    // next one. The canvas fallback has no flag, so it falls back to the state signature plus a
    // timeout of one game step (which shrinks as the snake eats: 190 ms - 7 ms per food, floor 95 ms).
    const queued = state.source === 'fiber' && state.queuedDirection != null;
    const consumed = signature !== lastSentSignature;
    const stepMs = Algorithms.stepIntervalMs(state.score);
    const overdue = now - lastSentAt >= stepMs + Math.max(120, config.interval * 2);
    if (queued || (!consumed && !overdue)) return;

    const plan = Algorithms.planMove({
      width: state.width,
      height: state.height,
      snake: state.snake,
      food: state.food || null,
      direction: state.direction,
      // Cells the reader saw as blobs but could not walk into the body: walls, not free space.
      obstacles: state.obstacles || []
    }, config.algorithm);

    if (!plan) {
      log.once('noplan', 'warn', 'No direction could be planned for this board.', {
        snake: state.snake.length,
        head: `(${state.head.x},${state.head.y})`,
        algorithm: config.algorithm
      });
      return;
    }

    gameStarted = true;
    lastPlan = plan;
    lastSentAt = now;
    lastSentSignature = signature;
    stats.moves += 1;
    sendDirection(plan.index, 'auto', plan.reason);

    const changed = plan.index !== lastDirection;
    if (changed || now - lastMoveLogAt > 3000) {
      lastDirection = plan.index;
      lastMoveLogAt = now;
      log.info('Direction key sent.', {
        source: 'auto',
        direction: DIRS[plan.index].name,
        key: DIRS[plan.index].key,
        reason: plan.reason,
        algorithm: config.algorithm,
        head: `(${state.head.x},${state.head.y})`,
        food: state.food ? `(${state.food.x},${state.food.y})` : 'none',
        length: state.snake.length,
        stepMs,
        route: plan.route ? plan.route.length : 0,
        moves: stats.moves
      });
    }
  }

  function tick() {
    const board = Page.board();
    if (board && reader.info().ready && !reader.fresh()) reader.ask();
    if (board && !boardKnown) {
      boardKnown = true;
      log.info('Game board appeared.');
    } else if (!board && boardKnown) {
      boardKnown = false;
      log.info('Game board disappeared.');
    }
    if (!board) {
      lastRead = null;
      lastPlan = null;
      gameStarted = false;
      gameOnScreen = false;
    } else if (enabled) {
      step(board);
    } else {
      lastRead = reader.read(board);
      if (lastRead.ok) reportState(lastRead);
      else reportFailure(lastRead);
    }
    paintOverlay();
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, enabled ? config.interval : 300);
  }

  function setEnabled(value) {
    const next = !!value;
    if (next === enabled) {
      restartTimer();
      paintOverlay();
      return enabled;
    }
    enabled = next;
    // The switch IS the setting: keep it in storage so it survives a page reload or a browser restart.
    config.autoStart = enabled;
    Config.save(config, log);
    if (enabled) {
      gameStarted = false;
      lastSentSignature = '';
      lastDirection = -1;
      log.info('Autoplay enabled.', { algorithm: config.algorithm, interval: config.interval });
      tick();
    } else {
      log.info('Autoplay disabled.');
    }
    restartTimer();
    paintOverlay();
    return enabled;
  }

  function applyConfig(patch) {
    if (!patch || typeof patch !== 'object') return config;
    const previousLang = config.lang;
    Config.apply(config, patch, ALGORITHMS);
    // Storage is the source of truth: a config that arrives while this loop is running has to be able to
    // stop it, otherwise a page that was enabled by an earlier load would keep sending keys after the
    // setting was switched off.
    if (!config.autoStart && enabled) setEnabled(false);
    // The panel writes its static labels once, when it is created, so a language switch has to drop it
    // and let the next paint build a fresh one.
    if (config.lang !== previousLang && overlay) {
      overlay.host.remove();
      overlay = null;
    }
    if (overlay) overlay.select.value = config.algorithm;
    paintOverlay();
    restartTimer();
    log.info('Configuration applied.', { ...config });
    return config;
  }

  // ------------------------------------------------------------------ panel

  function paintOverlay() {
    if (config.panel) {
      if (overlay && !overlay.host.isConnected) overlay = null;
      if (!overlay) {
        overlay = Panel.create({
          algorithms: ALGORITHMS,
          config,
          callbacks: {
            onAlgorithm(id) {
              applyConfig({ algorithm: id });
              saveConfig();
              log.info('Algorithm switched from the panel.', { algorithm: config.algorithm });
            },
            onToggle() {
              setEnabled(!enabled);
            }
          }
        });
      }
      overlay.host.style.display = '';
      Panel.paint(overlay, {
        state: lastRead,
        plan: lastPlan,
        enabled,
        algorithm: config.algorithm,
        lang: config.lang,
        dirs: DIRS,
        directionNames: I18n ? I18n.dirNames(config.lang) : DIRECTION_NAMES
      });
      return;
    }
    if (overlay) overlay.host.style.display = 'none';
  }

  // ------------------------------------------------------------------ wiring

  function saveConfig() {
    Config.save(config, log);
  }

  function watchForBoard() {
    if (observer) return;
    observer = new MutationObserver(() => {
      const board = Page.board();
      if (board && !boardKnown) tick();
      if (board && config.autoStart && !enabled) {
        log.info('Game board detected; starting autoplay.', { algorithm: config.algorithm });
        setEnabled(true);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.type !== 'string') return undefined;
      if (message.type === 'snake:toggle') {
        sendResponse({ ok: true, enabled: setEnabled(message.enabled === undefined ? !enabled : message.enabled) });
      } else if (message.type === 'snake:config') {
        sendResponse({ ok: true, config: applyConfig(message.config) });
      } else if (message.type === 'snake:status') {
        sendResponse({
          ok: true,
          enabled,
          config: { ...config },
          stats: { ...stats },
          board: !!Page.board(),
          status: Page.statusText(),
          notStarted: !!(lastRead && lastRead.notStarted),
          state: lastRead && lastRead.ok
            ? {
                source: lastRead.source,
                grid: `${lastRead.width}x${lastRead.height}`,
                snake: lastRead.snake.length,
                head: lastRead.head,
                food: lastRead.food,
                direction: lastRead.direction,
                algorithm: config.algorithm,
                reason: lastPlan ? lastPlan.reason : null
              }
            : null
        });
      }
      return true;
    });
  } catch (error) {
    log.warn('Could not register the message listener.', { error: String(error) });
  }

  log.info('Content script loaded; waiting for the game board.');
  if (!Algorithms) log.warn('algorithms.js did not load; autoplay will stay idle.');
  if (!Vision) log.warn('vision.js did not load; only the React bridge can read the board.');
  if (!reader.info().ready) log.info('Waiting for bridge.js to report the React game state; canvas vision is the fallback.');

  window.__snakeAutoplay = {
    config,
    stats,
    tick,
    setEnabled,
    applyConfig,
    readBoard: () => reader.read(Page.board()),
    state: () => lastRead,
    plan: () => lastPlan,
    bridge: () => reader.info(),
    source: () => (lastRead && lastRead.source) || null,
    get enabled() { return enabled; },
    get gameOnScreen() { return gameOnScreen; },
    get board() { return !!Page.board(); }
  };

  Config.load((stored) => {
    if (stored) applyConfig(stored);
    paintOverlay();
    watchForBoard();
    if (Page.board() && config.autoStart) {
      log.info('Game board already on the page; starting autoplay.', { algorithm: config.algorithm });
      setEnabled(true);
    } else {
      restartTimer();
    }
  }, log);
})();
