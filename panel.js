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

  // The userscript has no popup, so its glue adds the language row to this panel. This id is the
  // mount point it looks for: inside the card, under the same padding as the other controls, which
  // keeps the row from hanging below the rounded container.
  const CONFIG_ID = 'snake-autoplay-config';

  // The panel is rebuilt when the language changes (content.js drops it), so the static labels can be
  // written once here while `paint()` re-reads the language on every frame.
  function translator(lang) {
    const chosen = I18n ? I18n.normalizeLang(lang) : 'en';
    return (key, vars) => (I18n ? I18n.t(chosen, key, vars) : key);
  }

  // The panel styles itself from inside a shadow root, so it cannot share popup.css. The two are kept
  // deliberately in step: the same blue, the same switch, the same list animation.
  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      width: 248px; font: 12px/1.45 ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", sans-serif;
      color: #1a2230; background: #ffffff; border: 1px solid #dfe2e8; border-radius: 12px;
      box-shadow: 0 8px 28px rgba(15, 23, 42, .18);
      animation: panel-in .26s cubic-bezier(.22, .61, .36, 1) both;
    }
    @keyframes panel-in { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; background: #f6f7f9; border-bottom: 1px solid #e6e8ec; border-radius: 11px 11px 0 0; }
    .title { font-weight: 600; font-size: 12px; }
    .status { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #e8eaee; color: #4b5563; white-space: nowrap; transition: background .2s ease, color .2s ease; }
    .status.ok { background: #e3f5ea; color: #10703c; }
    .status.bad { background: #fdeaea; color: #a3261b; }
    .status.idle { background: #eef1f6; color: #3f5875; }
    .board { position: relative; margin: 8px; border-radius: 8px; background: #f7f7f8; border: 1px solid #eceef1; overflow: hidden; }
    .board canvas { display: block; width: 100%; height: auto; border-radius: 8px; }
    .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #8b929c; text-align: center; padding: 0 12px; }
    .board.ready .empty { display: none; }
    .details { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; padding: 0 10px 8px; }
    .row { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
    .row.wide { grid-column: 1 / -1; }
    .row.wide .v { white-space: normal; overflow-wrap: anywhere; }
    .k { color: #8b929c; font-size: 11px; flex: none; }
    .v { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .config { display: flex; flex-direction: column; gap: 6px; padding: 0 10px 12px; }
    .select { position: relative; }
    .select-native { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .select-face {
      display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%;
      font: inherit; padding: 5px 8px; border: 1px solid #dfe2e8; border-radius: 7px; background: #ffffff;
      color: inherit; cursor: pointer; text-align: left;
      transition: border-color .16s ease, box-shadow .16s ease, background .16s ease, transform .12s ease;
    }
    .select-face:hover { border-color: #c7d4e6; background: #f8fafc; }
    .select-face:active { transform: scale(.99); }
    .select-face[aria-expanded="true"] { border-color: #93b4f5; box-shadow: 0 0 0 3px rgba(37, 99, 235, .16); }
    .select-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chevron { flex: none; width: 7px; height: 7px; margin-right: 2px; border-right: 1.6px solid #7b8494; border-bottom: 1.6px solid #7b8494; transform: rotate(45deg) translateY(-1px); transition: transform .22s cubic-bezier(.22, .61, .36, 1); }
    .select[data-open="true"] .chevron { transform: rotate(-135deg) translateY(-1px); }
    .select-menu {
      position: absolute; left: 0; right: 0; bottom: calc(100% + 5px); z-index: 2; padding: 4px;
      background: #ffffff; border: 1px solid #e2e7f0; border-radius: 9px;
      box-shadow: 0 12px 26px rgba(15, 30, 60, .16), 0 2px 8px rgba(15, 30, 60, .08);
      opacity: 0; visibility: hidden; transform: translateY(6px) scale(.98); transform-origin: bottom center;
      transition: opacity .16s ease, transform .18s cubic-bezier(.22, .61, .36, 1), visibility 0s linear .18s;
    }
    .select[data-open="true"] .select-menu { opacity: 1; visibility: visible; transform: none; transition-delay: 0s; }
    .select-option { padding: 5px 7px; border-radius: 6px; cursor: pointer; opacity: 0; transition: background .14s ease; }
    .select-option[aria-selected="true"] { color: #1a56c4; font-weight: 600; }
    .select-option[data-active="true"] { background: #eef2fb; }
    .select[data-open="true"] .select-option { animation: option-in .18s ease forwards; }
    .select[data-open="true"] .select-option:nth-child(2) { animation-delay: .03s; }
    .select[data-open="true"] .select-option:nth-child(3) { animation-delay: .06s; }
    .select[data-open="true"] .select-option:nth-child(4) { animation-delay: .09s; }
    @keyframes option-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .switch { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; font: inherit; padding: 1px 0; background: none; border: 0; color: inherit; cursor: pointer; }
    .switch-text { color: #4b5566; }
    .switch-track { position: relative; flex: none; width: 32px; height: 18px; border-radius: 999px; background: #d7dce5; transition: background .2s ease; }
    .switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #ffffff; box-shadow: 0 1px 3px rgba(15, 30, 60, .35); transition: transform .24s cubic-bezier(.34, 1.56, .64, 1); }
    .switch[data-on="true"] .switch-track { background: #2563eb; }
    .switch[data-on="true"] .switch-knob { transform: translateX(14px); }
    .switch:hover .switch-track { box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
    .switch:focus-visible .switch-track { box-shadow: 0 0 0 3px rgba(37, 99, 235, .28); }
    @media (prefers-reduced-motion: reduce) {
      .panel, .select-option { animation: none !important; }
      * { transition: none !important; }
    }
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

  // ------------------------------------------------------------------ the strategy picker
  //
  // A native <select> list is painted by the browser itself and cannot be animated, so the panel paints
  // its own button and list over the select and mirrors every pick back through a real `change` event.
  // popup-ui.js does the same job for the popup; the panel cannot reuse it because it lives in a shadow
  // root and is created and dropped whenever the page or the language changes.
  //
  // Every part is optional on purpose: the panel is also built by the test shims, which only implement
  // the DOM they need. When an API is missing the panel simply keeps its plain, native select.
  const openPickers = [];

  function closePickers() {
    while (openPickers.length) openPickers.pop().hide();
  }

  function enhancePicker(shell) {
    try {
      const select = shell.querySelector('select');
      const face = shell.querySelector('.select-face');
      const label = shell.querySelector('.select-label');
      const menu = shell.querySelector('.select-menu');
      if (!select || !face || !label || !menu) return null;
      shell.setAttribute('data-enhanced', 'true');
      shell.setAttribute('data-open', 'false');

      // The painted button replaces the native control as the click and keyboard target.
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');
      face.setAttribute('role', 'combobox');
      face.setAttribute('aria-expanded', 'false');

      // paint() writes `select.value` on every frame, and assigning to a native select fires no event
      // that could repaint the button. Taking the property over on the instance is what keeps the
      // button honest through every one of those writes.
      let value = select.value;
      const proto = Object.getPrototypeOf(select);
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      Object.defineProperty(select, 'value', {
        configurable: true,
        get() {
          return value;
        },
        set(next) {
          if (descriptor && descriptor.set) descriptor.set.call(select, next);
          value = descriptor && descriptor.get ? descriptor.get.call(select) : next;
          render();
        }
      });

      let active = 0;

      function options() {
        return Array.prototype.slice.call(select.options || []);
      }

      function items() {
        return menu.children ? Array.prototype.slice.call(menu.children) : [];
      }

      function labelOf() {
        for (const option of options()) if (option.value === value) return (option.textContent || '').trim();
        return '';
      }

      function highlight(index) {
        const all = items();
        if (!all.length) return;
        active = ((index % all.length) + all.length) % all.length;
        all.forEach((item, at) => {
          if (at === active) item.setAttribute('data-active', 'true');
          else item.removeAttribute('data-active');
        });
      }

      function build() {
        while (menu.firstChild) menu.removeChild(menu.firstChild);
        for (const option of options()) {
          const item = document.createElement('div');
          item.className = 'select-option';
          item.setAttribute('role', 'option');
          item.setAttribute('data-value', option.value);
          item.textContent = (option.textContent || '').trim();
          item.addEventListener('click', () => choose(option.value));
          menu.appendChild(item);
        }
      }

      function render() {
        label.textContent = labelOf();
        for (const item of items()) {
          const selected = item.getAttribute('data-value') === value;
          item.setAttribute('aria-selected', selected ? 'true' : 'false');
        }
      }

      function isOpen() {
        return shell.getAttribute('data-open') === 'true';
      }

      function show() {
        closePickers();
        shell.setAttribute('data-open', 'true');
        face.setAttribute('aria-expanded', 'true');
        openPickers.push(control);
        const all = items();
        const at = all.findIndex((item) => item.getAttribute('data-value') === value);
        highlight(at < 0 ? 0 : at);
      }

      function hide() {
        shell.setAttribute('data-open', 'false');
        face.setAttribute('aria-expanded', 'false');
        const at = openPickers.indexOf(control);
        if (at !== -1) openPickers.splice(at, 1);
      }

      function choose(next) {
        hide();
        select.value = next;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof face.focus === 'function') face.focus();
      }

      const control = { shell, select, show, hide, render, build, isOpen };

      face.addEventListener('click', () => (isOpen() ? hide() : show()));
      face.addEventListener('keydown', (event) => {
        const key = event.key;
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (!isOpen()) show();
          else highlight(active + (key === 'ArrowDown' ? 1 : -1));
        } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (!isOpen()) show();
          else {
            const item = items()[active];
            if (item) choose(item.getAttribute('data-value'));
          }
        } else if (key === 'Escape' && isOpen()) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          hide();
        } else if (key === 'Tab') {
          hide();
        }
      });
      menu.addEventListener('mousedown', (event) => {
        if (typeof event.preventDefault === 'function') event.preventDefault();
      });

      build();
      render();

      // Translations are written into the <option> elements after load, so the list and the button follow
      // the elements they are a picture of.
      if (typeof MutationObserver === 'function') {
        new MutationObserver(() => {
          build();
          render();
        }).observe(select, { childList: true, subtree: true, characterData: true });
      }
      return control;
    } catch (_) {
      return null;
    }
  }

  // A pointer anywhere else closes the open list. The click may come from inside the panel's shadow root,
  // where `event.target` is retargeted to the host, so containment is decided from the composed path.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('pointerdown', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
      for (const control of openPickers.slice()) {
        const inside = (path && path.indexOf(control.shell) !== -1)
          || !!(event.target && control.shell.contains && control.shell.contains(event.target));
        if (!inside) control.hide();
      }
    });
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

    // The last two fields carry sentences rather than coordinates, so they get a line of their own
    // instead of half a row.
    const field = (label, wide) => {
      const value = el('span', { class: 'v', text: '--' });
      const row = el('div', { class: wide ? 'row wide' : 'row' }, [
        el('span', { class: 'k', text: label }),
        value
      ]);
      return { node: row, value };
    };
    const grid = field(tr('fieldGrid'));
    const length = field(tr('fieldLength'));
    const headCell = field(tr('fieldHead'));
    const food = field(tr('fieldFood'));
    const direction = field(tr('fieldDirection'));
    const source = field(tr('fieldSource'));
    const reason = field(tr('fieldReason'), true);
    const route = field(tr('fieldRoute'), true);
    const details = el('div', { class: 'details' }, [
      grid.node, length.node, headCell.node, food.node, direction.node, source.node, reason.node, route.node
    ]);

    const select = el('select', { class: 'select-native' });
    for (const algorithm of algorithms) {
      const label = I18n ? I18n.algLabel(config.lang, algorithm.id, algorithm.label) : algorithm.label;
      select.appendChild(el('option', { value: algorithm.id, text: label }));
    }
    select.value = config.algorithm;
    select.addEventListener('change', () => {
      if (typeof callbacks.onAlgorithm === 'function') callbacks.onAlgorithm(select.value);
    });
    const selectLabel = el('span', { class: 'select-label', text: '' });
    const selectFace = el('button', { class: 'select-face', type: 'button', 'aria-expanded': 'false' }, [
      selectLabel,
      el('span', { class: 'chevron', 'aria-hidden': 'true' })
    ]);
    const selectMenu = el('div', { class: 'select-menu', role: 'listbox' });
    const selectShell = el('div', { class: 'select' }, [select, selectFace, selectMenu]);

    const toggle = el('button', {
      class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'data-on': 'false'
    }, [
      el('span', { class: 'switch-text', text: tr('autoPlay') }),
      el('span', { class: 'switch-track' }, [el('span', { class: 'switch-knob' })])
    ]);
    toggle.addEventListener('click', () => {
      if (typeof callbacks.onToggle === 'function') callbacks.onToggle();
    });

    const configRow = el('div', { class: 'config', id: CONFIG_ID }, [selectShell, toggle]);

    root.append(style, el('div', { class: 'panel' }, [head, boardBox, details, configRow]));
    document.documentElement.appendChild(host);
    enhancePicker(selectShell);
    return {
      host,
      status,
      preview,
      empty,
      boardBox,
      details,
      select,
      selectShell,
      selectFace,
      selectLabel,
      selectMenu,
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
    // The switch carries its state in the knob, its accessible name in `aria-checked` and its wording in
    // the tooltip, so it can be read without the colour.
    overlay.toggle.setAttribute('data-on', enabled ? 'true' : 'false');
    overlay.toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    overlay.toggle.setAttribute('title', tr(enabled ? 'toggleOn' : 'toggleOff'));
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
