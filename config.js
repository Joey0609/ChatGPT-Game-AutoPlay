/**
 * Configuration: defaults, validation and persistence under `snakeConfig` in BOTH `chrome.storage.sync`
 * and `chrome.storage.local`, so a switch the user flips stays flipped across page reloads and browser
 * restarts. `sync` alone is not enough: it can be unavailable in some profiles (no account, quota
 * errors) and a failed write would silently lose the setting. Every area gets the same payload, each
 * one carries a `savedAt` stamp, and loading picks the newest copy.
 *
 * Fields: `algorithm`, `autoStart`, `panel`, `lang` (UI language, default English) and the pinned
 * `interval`.
 *
 * Persistence is wrapped in try/catch because the storage API is not available in a plain page context
 * (and in the headless tests), where the extension must still run with in-memory settings.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'snakeConfig';
  // The poll interval is deliberately NOT user configurable: the game steps every 95-190 ms, so a
  // slower loop would miss steps and a faster one only burns CPU. The popup ships exactly one value.
  const TICK_MS = 50;
  // i18n.js owns the language list; English is the default and the fallback when it is not loaded.
  const DEFAULT_LANG = (window.SnakeI18n && window.SnakeI18n.DEFAULT_LANG) || 'en';
  const defaults = {
    algorithm: 'bfs',
    autoStart: true,
    panel: true,
    interval: TICK_MS,
    lang: DEFAULT_LANG,
    // Timestamp of the last write, used to pick the newest copy when several areas disagree.
    savedAt: 0
  };

  // The only switches the popup exposes. Pane contents (preview / route / details / buttons) are not
  // configurable any more: the panel shows everything whenever it is switched on.
  const BOOLEAN_KEYS = ['autoStart', 'panel'];

  // Every storage area this extension may use, in a fixed order. Missing or throwing areas are skipped.
  function areas() {
    const list = [];
    for (const name of ['sync', 'local']) {
      try {
        const area = chrome.storage[name];
        if (area && typeof area.get === 'function' && typeof area.set === 'function') list.push(area);
      } catch (_) { /* The area does not exist in this context. */ }
    }
    return list;
  }

  // Returns a complete config; unknown fields are ignored and the interval is always pinned.
  function normalize(patch, algorithms) {
    const next = { ...defaults };
    if (!patch || typeof patch !== 'object') return next;
    const known = (algorithms || []).map((entry) => entry.id);
    if (typeof patch.algorithm === 'string' && (!known.length || known.indexOf(patch.algorithm) >= 0)) {
      next.algorithm = patch.algorithm;
    }
    // A stored value from an older version must never slow the loop down again.
    next.interval = TICK_MS;
    for (const name of BOOLEAN_KEYS) {
      if (typeof patch[name] === 'boolean') next[name] = patch[name];
    }
    // The language must be one i18n.js knows; anything else falls back to the default.
    const knownLang = window.SnakeI18n ? window.SnakeI18n.has(patch.lang) : patch.lang === DEFAULT_LANG;
    if (knownLang) next.lang = patch.lang;
    if (Number.isFinite(patch.savedAt)) next.savedAt = patch.savedAt;
    return next;
  }

  // Applies a patch onto an existing config in place, so references held elsewhere stay valid.
  function apply(config, patch, algorithms) {
    const merged = normalize({ ...config, ...(patch || {}) }, algorithms);
    Object.assign(config, merged);
    return config;
  }

  function save(config, log) {
    const payload = { ...config, interval: TICK_MS, savedAt: Date.now() };
    const list = areas();
    if (!list.length) {
      if (log) log.warn('chrome.storage is unavailable; settings live in memory only.');
      return false;
    }
    let saved = false;
    for (const area of list) {
      try {
        area.set({ [STORAGE_KEY]: payload });
        saved = true;
      } catch (error) {
        if (log) log.warn('Could not save the configuration.', { error: String(error) });
      }
    }
    return saved;
  }

  // Asks every area, then hands the newest copy to the callback. `null` when nothing was stored yet.
  function load(callback, log) {
    const list = areas();
    if (!list.length) {
      if (log) log.warn('chrome.storage is unavailable.');
      callback(null);
      return;
    }
    const found = [];
    let pending = list.length;
    const settle = () => {
      pending -= 1;
      if (pending > 0) return;
      const newest = found.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;
      callback(newest);
    };
    for (const area of list) {
      try {
        area.get([STORAGE_KEY], (result) => {
          const value = result && result[STORAGE_KEY];
          if (value && typeof value === 'object') found.push(value);
          settle();
        });
      } catch (error) {
        if (log) log.warn('Could not read from one storage area.', { error: String(error) });
        settle();
      }
    }
  }

  window.SnakeConfig = { STORAGE_KEY, TICK_MS, defaults, normalize, apply, save, load };
})();
