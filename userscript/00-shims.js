/**
 * Userscript shim, bundled FIRST.
 *
 * Tampermonkey (with `@grant none`) runs this script in the page itself, which is exactly what the
 * React bridge needs: `bridge.js` reaches the game through the `__reactFiber$…` expando properties
 * that only exist in the page world. The page world has no `chrome.*` APIs, so `config.js` (which
 * saves through `chrome.storage.sync` / `.local`) and `content.js` (which registers a message
 * listener) are given a small localStorage-backed stand-in.
 *
 * Only missing pieces are installed, so the very same bundle keeps using the real extension APIs
 * when it is loaded somewhere that already has them (the headless tests do).
 *
 * Configuration lives in the page's `localStorage` under `snake-autoplay:config`, exactly in the
 * shape `chrome.storage` stores it: `{ snakeConfig: { algorithm, autoStart, panel, interval, lang,
 * savedAt } }`.
 */
(() => {
  'use strict';

  const VERSION = '{{version}}';
  const LS_KEY = 'snake-autoplay:config';
  const STORAGE_KEY = 'snakeConfig';
  const memory = { value: null };

  function readAll() {
    if (memory.value) return memory.value;
    try {
      const raw = window.localStorage && window.localStorage.getItem(LS_KEY);
      memory.value = raw ? JSON.parse(raw) : {};
    } catch (error) {
      memory.value = {};
    }
    if (!memory.value || typeof memory.value !== 'object') memory.value = {};
    return memory.value;
  }

  function writeAll(items) {
    const all = Object.assign({}, readAll(), items);
    memory.value = all;
    try {
      if (window.localStorage) window.localStorage.setItem(LS_KEY, JSON.stringify(all));
    } catch (error) {
      /* Private mode and friends: the in-memory copy still works for this session. */
    }
  }

  function makeArea() {
    return {
      get(keys, callback) {
        const all = readAll();
        const names = Array.isArray(keys) ? keys : keys && typeof keys === 'object' ? Object.keys(keys) : [];
        const result = {};
        for (const name of names) if (name in all) result[name] = all[name];
        if (typeof callback === 'function') callback(result);
      },
      set(items, callback) {
        writeAll(items || {});
        if (typeof callback === 'function') callback();
      },
      remove(keys, callback) {
        const all = Object.assign({}, readAll());
        const names = Array.isArray(keys) ? keys : [keys];
        for (const name of names) delete all[name];
        writeAll(all);
        if (typeof callback === 'function') callback();
      }
    };
  }

  const root = window.chrome && typeof window.chrome === 'object' ? window.chrome : (window.chrome = {});

  if (!root.storage || typeof root.storage !== 'object') {
    const area = makeArea();
    // Both areas exist so `config.js` writes and reads the same payload twice, like the extension.
    root.storage = { sync: area, local: makeArea(), onChanged: { addListener() {} } };
  }

  if (!root.runtime || typeof root.runtime !== 'object') root.runtime = {};
  if (!root.runtime.onMessage || typeof root.runtime.onMessage.addListener !== 'function') {
    root.runtime.onMessage = { addListener() {}, removeListener() {} };
  }
  if (typeof root.runtime.sendMessage !== 'function') root.runtime.sendMessage = function () {};
  if (typeof root.runtime.getManifest !== 'function') root.runtime.getManifest = function () { return { version: VERSION }; };
  if (typeof root.runtime.getURL !== 'function') root.runtime.getURL = function (asset) { return String(asset); };
  if (typeof root.runtime.id !== 'string') root.runtime.id = 'snake-autoplay-userscript';

  // Handy in the console, and the only place the version lives outside the metadata block.
  window.SnakeUserscript = { version: VERSION, storageKey: STORAGE_KEY, localKey: LS_KEY };
})();
