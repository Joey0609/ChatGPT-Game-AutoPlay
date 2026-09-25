/**
 * Page access: everything that touches ChatGPT's DOM lives here.
 *
 * The game root is `[data-testid="image-gen-loading-game-board"]`; it holds two canvases - the page's
 * background animation first, the game canvas second - and only the second carries the board while
 * the game is on screen (`gameCanvas`). Keys are delivered as real KeyboardEvents on the game
 * element, which is how the page's own keyboard handler receives them.
 */
(() => {
  'use strict';

  const GAME_SELECTOR = '[data-testid="image-gen-loading-game-board"]';
  const STATUS_SELECTOR = '[role="status"][aria-live="polite"]';

  function board() {
    return document.querySelector(GAME_SELECTOR);
  }

  function statusText() {
    const node = document.querySelector(STATUS_SELECTOR);
    return node ? (node.textContent || '').trim() : '';
  }

  function canvasShown(canvas) {
    let style = null;
    try {
      style = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
    } catch (error) {
      style = null;
    }
    if (!style) return true;
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  // The board element holds two canvases: the page's background animation first, the game canvas
  // second. The game canvas is the LAST one, and the page fades it out (opacity 0) whenever the
  // game itself is not on screen - which is most of the image-generation wait. Taking "the first
  // canvas that is not hidden" therefore reads the background animation as a board, which used to
  // make the extension plan moves on a full dot lattice and send keys into nothing. So: last canvas
  // only, and only while it is actually shown.
  function gameCanvas(boardElement) {
    if (!boardElement || typeof boardElement.querySelectorAll !== 'function') return null;
    const canvases = boardElement.querySelectorAll('canvas');
    for (let index = canvases.length - 1; index >= 0; index -= 1) {
      const canvas = canvases[index];
      if (!canvas || !canvas.width || !canvas.height) continue;
      if (canvasShown(canvas)) return canvas;
    }
    return null;
  }

  // Returns { image, width, height } or { error }. The canvas is created by the page, so
  // `willReadFrequently` cannot be set by us - the browser only prints a performance hint.
  function pixels(canvas) {
    if (!canvas) return { error: 'the game board has no visible canvas' };
    try {
      const context = canvas.getContext('2d');
      if (!context) return { error: 'the visible canvas has no 2d context' };
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      return { image, width: canvas.width, height: canvas.height };
    } catch (error) {
      return { error: `canvas pixels could not be read (${error.message})` };
    }
  }

  function focus(boardElement) {
    if (!boardElement || typeof boardElement.focus !== 'function') return;
    try {
      boardElement.focus({ preventScroll: true });
    } catch (error) {
      try { boardElement.focus(); } catch (inner) { /* not focusable */ }
    }
  }

  function pressKey(boardElement, key, code) {
    if (!boardElement || typeof boardElement.dispatchEvent !== 'function') return false;
    if (typeof KeyboardEvent !== 'function') return false;
    const init = { key, code, bubbles: true, cancelable: true, composed: true };
    boardElement.dispatchEvent(new KeyboardEvent('keydown', init));
    boardElement.dispatchEvent(new KeyboardEvent('keyup', init));
    return true;
  }

  // Space is the page's own pause/resume shortcut.
  function pressSpace(boardElement) {
    focus(boardElement);
    return pressKey(boardElement, ' ', 'Space');
  }

  window.SnakePage = {
    GAME_SELECTOR,
    STATUS_SELECTOR,
    board,
    statusText,
    canvasShown,
    gameCanvas,
    visibleCanvas: gameCanvas,
    pixels,
    focus,
    pressKey,
    pressSpace
  };
})();
