/**
 * The floating panel on the right edge of the page: a live view of what was recognized, the
 * strategy picker and an on/off switch.
 *
 * The panel is pure UI: it never reads the page or decides a move. It reports clicks through the
 * callbacks it was created with, and `paint()` renders whatever state the game loop hands it.
 * Every visible string comes from i18n.js, in the language the config carries.
 */
(() => {
  'use strict';

  const I18n = window.SnakeI18n;

  // The panel is rebuilt when the language changes (content.js drops it), so the static labels can be
  // written once here while `paint()` re-reads the language on every frame.
  function translator(lang) {
    const chosen = I18n ? I18n.normalizeLang(lang) : 'en';
    return (key, vars) => (I18n ? I18n.t(chosen, key, vars) : key);
  }

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      width: 248px; font: 12px/1.45 ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", sans-serif;
      color: #1f2430; background: #ffffff; border: 1px solid #dfe2e8; border-radius: 12px;
      box-shadow: 0 8px 28px rgba(15, 23, 42, .18); overflow: hidden;
    }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; background: #f6f7f9; border-bottom: 1px solid #e6e8ec; }
    .title { font-weight: 600; font-size: 12px; }
    .status { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #e8eaee; color: #4b5563; white-space: nowrap; }
    .status.ok { background: #e3f5ea; color: #10703c; }
    .status.bad { background: #fdeaea; color: #a3261b; }
    .status.idle { background: #eef1f6; color: #3f5875; }
    .board { position: relative; margin: 8px; border-radius: 8px; background: #f7f7f8; border: 1px solid #eceef1; }
    .board canvas { display: block; width: 100%; height: auto; border-radius: 8px; }
    .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #8b929c; text-align: center; padding: 0 12px; }
    .board.ready .empty { display: none; }
    .details { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; padding: 0 10px 8px; }
    .row { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
    .k { color: #8b929c; font-size: 11px; flex: none; }
    .v { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .config { display: flex; align-items: center; gap: 6px; padding: 0 10px 12px; }
    select { flex: 1; font: inherit; padding: 3px 4px; border: 1px solid #dfe2e8; border-radius: 6px; background: #fff; color: inherit; }
    button { font: inherit; cursor: pointer; background: #fff; border: 1px solid #dfe2e8; border-radius: 6px; color: inherit; }
    button:hover { background: #f3f4f6; }
    button.on { background: #e8f0fe; border-color: #b9cdf7; color: #1a56c4; }
  `;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) node.appendChild(child);
    return node;
  }

  function create(options) {
    const algorithms = options.algorithms || [];
    const callbacks = options.callbacks || {};
    const config = options.config || { algorithm: 'bfs', panel: true };
    const tr = translator(config.lang);

    const host = document.createElement('div');
    host.id = 'snake-autoplay-panel';
    Object.assign(host.style, {
      all: 'initial',
      position: 'fixed',
      right: '16px',
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: '2147483647',
      pointerEvents: 'auto'
    });
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;

    const status = el('span', { class: 'status', text: tr('boardUnknown') });
    const head = el('div', { class: 'head' }, [el('span', { class: 'title', text: tr('panelTitle') }), status]);

    const preview = el('canvas');
    preview.width = 224;
    preview.height = 200;
    const empty = el('div', { class: 'empty', text: tr('emptyWaiting') });
    const boardBox = el('div', { class: 'board' }, [preview, empty]);

    const field = (label) => {
      const value = el('span', { class: 'v', text: '--' });
      return { node: el('div', { class: 'row' }, [el('span', { class: 'k', text: label }), value]), value };
    };
    const grid = field(tr('fieldGrid'));
    const length = field(tr('fieldLength'));
    const headCell = field(tr('fieldHead'));
    const food = field(tr('fieldFood'));
    const direction = field(tr('fieldDirection'));
    const reason = field(tr('fieldReason'));
    const source = field(tr('fieldSource'));
    const route = field(tr('fieldRoute'));
    const details = el('div', { class: 'details' }, [
      grid.node, length.node, headCell.node, food.node, direction.node, reason.node, source.node, route.node
    ]);

    const select = el('select');
    for (const algorithm of algorithms) {
      const label = I18n ? I18n.algLabel(config.lang, algorithm.id, algorithm.label) : algorithm.label;
      select.appendChild(el('option', { value: algorithm.id, text: label }));
    }
    select.value = config.algorithm;
    select.addEventListener('change', () => {
      if (typeof callbacks.onAlgorithm === 'function') callbacks.onAlgorithm(select.value);
    });
    const toggle = el('button', { text: tr('toggleOn') });
    toggle.addEventListener('click', () => {
      if (typeof callbacks.onToggle === 'function') callbacks.onToggle();
    });
    const configRow = el('div', { class: 'config' }, [select, toggle]);

    root.append(style, el('div', { class: 'panel' }, [head, boardBox, details, configRow]));
    document.documentElement.appendChild(host);
    return {
      host,
      status,
      preview,
      empty,
      boardBox,
      details,
      select,
      toggle,
      fields: { grid, length, headCell, food, direction, reason, source, route }
    };
  }

  // Draws the recognized board small, so the user can compare it with the real one at a glance.
  function drawPreview(overlay, state, dirs, route) {
    const canvas = overlay.preview;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f7f7f8';
    ctx.fillRect(0, 0, width, height);
    if (!state || !state.ok) return;

    const columns = state.width;
    const rows = state.height;
    const cell = Math.max(3, Math.min((width - 12) / columns, (height - 12) / rows));
    const originX = (width - cell * columns) / 2;
    const originY = (height - cell * rows) / 2;
    const center = (x, y) => [originX + (x + 0.5) * cell, originY + (y + 0.5) * cell];

    ctx.fillStyle = '#e3e5e9';
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const [cx, cy] = center(x, y);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.7, cell * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The route the planner intends to walk, drawn under the snake: a dashed line from the head
    // through every planned cell. A step that wraps is drawn as a break instead of a line across
    // the whole board.
    const planned = Array.isArray(route) ? route.filter((cell2) => cell2 && Number.isFinite(cell2.x)) : [];
    if (planned.length && typeof ctx.moveTo === 'function' && typeof ctx.lineTo === 'function') {
      const cells = [{ x: state.head.x, y: state.head.y }, ...planned];
      ctx.strokeStyle = 'rgba(37, 99, 235, .7)';
      ctx.lineWidth = Math.max(1, cell * 0.14);
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([Math.max(2, cell * 0.28), Math.max(2, cell * 0.22)]);
      ctx.beginPath();
      let previous = null;
      for (const point of cells) {
        const [cx, cy] = center(point.x, point.y);
        const wraps = previous && (Math.abs(point.x - previous.x) > 1 || Math.abs(point.y - previous.y) > 1);
        if (previous && !wraps) ctx.lineTo(cx, cy);
        else ctx.moveTo(cx, cy);
        previous = { x: point.x, y: point.y };
      }
      ctx.stroke();
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
      const last = planned[planned.length - 1];
      const [lx, ly] = center(last.x, last.y);
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(lx, ly, Math.max(1.4, cell * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.food) {
      const [fx, fy] = center(state.food.x, state.food.y);
      ctx.fillStyle = '#dc4c3e';
      ctx.beginPath();
      ctx.arc(fx, fy, cell * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }

    const body = state.snake || [];
    body.forEach((segment, index) => {
      const [cx, cy] = center(segment.x, segment.y);
      const ratio = body.length > 1 ? index / (body.length - 1) : 0;
      const shade = Math.round(150 - 90 * (1 - ratio));
      ctx.fillStyle = index === 0 ? '#145d3b' : `rgb(${Math.round(shade * 0.5)}, ${shade}, ${Math.round(shade * 0.75)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (index === 0 ? 0.42 : 0.38), 0, Math.PI * 2);
      ctx.fill();
    });

    if (body.length) {
      const vector = dirs[state.direction] || { x: 1, y: 0 };
      const [hx, hy] = center(state.head.x, state.head.y);
      ctx.fillStyle = '#ffffff';
      for (const side of [-1, 1]) {
        const ox = vector.x !== 0 ? cell * 0.16 : -vector.y * cell * 0.2 * side;
        const oy = vector.y !== 0 ? cell * 0.16 : vector.x * cell * 0.2 * side;
        ctx.beginPath();
        ctx.arc(hx + ox, hy + oy * (vector.x !== 0 ? side : 1), Math.max(1, cell * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function coords(point) {
    return point ? `${point.x},${point.y}` : '--';
  }

  function paint(overlay, view) {
    const state = view.state;
    const tr = translator(view.lang);
    // The popup has a single switch for the whole panel (handled in content.js), so every part is
    // always shown here: preview, route and details travel together.
    const recognized = !!(state && state.ok);
    // The board element is in the page long before the game is; the panel says "Not started" then, so
    // the user can tell "the game has not started" apart from "the board could not be read".
    const notStarted = !!(state && state.notStarted);
    const enabled = !!view.enabled;
    const sourceLabel = !recognized ? tr('boardUnknown') : tr(state.source === 'fiber' ? 'sourceFiber' : 'sourceCanvas');
    if (notStarted) {
      overlay.status.textContent = tr('notStarted');
      overlay.status.className = 'status idle';
    } else {
      overlay.status.textContent = !recognized || enabled ? sourceLabel : `${sourceLabel}${tr('autoOffSuffix')}`;
      overlay.status.className = `status ${recognized ? 'ok' : 'bad'}`;
    }
    overlay.boardBox.classList.toggle('ready', recognized);
    overlay.empty.textContent = tr(notStarted ? 'emptyNotStarted' : 'emptyWaiting');
    overlay.toggle.textContent = tr(enabled ? 'toggleOn' : 'toggleOff');
    overlay.toggle.className = enabled ? 'on' : '';
    if (overlay.select.value !== view.algorithm) overlay.select.value = view.algorithm;

    const fields = overlay.fields;
    fields.grid.value.textContent = recognized ? `${state.width}×${state.height}` : '--';
    fields.length.value.textContent = recognized ? `${state.snake.length}` : '--';
    fields.headCell.value.textContent = recognized ? coords(state.head) : '--';
    fields.food.value.textContent = recognized ? coords(state.food) : '--';
    fields.direction.value.textContent = recognized ? view.directionNames[state.direction] : '--';
    fields.source.value.textContent = recognized ? tr(state.source === 'fiber' ? 'sourceFiber' : 'sourceCanvas') : '--';
    fields.reason.value.textContent = notStarted
      ? tr('waitingStart')
      : (recognized && view.plan
        ? (I18n ? I18n.reason(view.lang, view.plan.reason) : view.plan.reason)
        : (state && state.reason ? String(state.reason).slice(0, 28) : '--'));
    const route = recognized && view.plan && Array.isArray(view.plan.route) ? view.plan.route : [];
    fields.route.value.textContent = route.length
      ? tr('routeSteps', { steps: route.length, target: coords(route[route.length - 1]) })
      : '--';

    drawPreview(overlay, state, view.dirs, route);
  }

  window.SnakePanel = { create, paint, drawPreview, PANEL_CSS };
})();
