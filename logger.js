/**
 * Console logging for the extension, shared by every content script.
 *
 * All messages carry the same prefix so they can be filtered in the page console with
 * `[Game Autoplay]`. `once()` de-duplicates repeated warnings (the game loop runs several times a
 * second, and an unrecognized board must not spam the console).
 */
(() => {
  'use strict';

  const PREFIX = '[Game Autoplay]';
  const seen = new Map();

  function info(event, details) {
    if (details === undefined) console.log(`${PREFIX} ${event}`);
    else console.log(`${PREFIX} ${event}`, details);
  }

  function warn(event, details) {
    if (details === undefined) console.warn(`${PREFIX} ${event}`);
    else console.warn(`${PREFIX} ${event}`, details);
  }

  function once(key, level, event, details) {
    const stamp = `${event}|${JSON.stringify(details ?? null)}`;
    if (seen.get(key) === stamp) return;
    seen.set(key, stamp);
    if (level === 'warn') warn(event, details);
    else info(event, details);
  }

  function reset() {
    seen.clear();
  }

  window.SnakeLog = { PREFIX, info, warn, once, reset };
})();
