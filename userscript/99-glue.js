/**
 * Userscript glue, bundled LAST (after content.js).
 *
 * A browser extension has a popup with the language dropdown; a userscript has no popup, so the
 * language selector is added to the on-page panel instead. Everything else (strategies, the
 * auto-play switch, the board preview) already lives in `panel.js` and works unchanged.
 *
 * The panel is created inside a shadow root that `panel.js` attaches to `#snake-autoplay-panel`, so
 * the extra row is injected into the panel's own configuration column - `#snake-autoplay-config`,
 * the mount point panel.js keeps for exactly this. Inline rules style it, so nothing here depends on
 * the panel's stylesheet, but the row still sits inside the card: appending it to the shadow root
 * itself left it hanging below the rounded container. `content.js` rebuilds the panel whenever the
 * language changes, and the observer here re-injects the row into the new one.
 */
(() => {
  'use strict';

  const I18n = window.SnakeI18n;
  const Config = window.SnakeConfig;
  const PANEL_ID = 'snake-autoplay-panel';
  // panel.js gives its configuration column this id so the userscript can mount inside the card.
  const SLOT_ID = 'snake-autoplay-config';
  const ROW_ID = 'snake-autoplay-userscript-language';
  const ROW_STYLE = [
    'display:flex', 'align-items:center', 'justify-content:space-between', 'gap:8px',
    'font:12px/1.45 ui-sans-serif,system-ui,"Segoe UI","PingFang SC",sans-serif', 'color:#4b5566'
  ].join(';');
  const SELECT_STYLE = [
    'font:inherit', 'color:#1a2230', 'background:#fff', 'border:1px solid #dfe2e8',
    'border-radius:7px', 'padding:4px 6px', 'max-width:120px', 'cursor:pointer'
  ].join(';');

  // Both modules are bundled above; if one of them is missing the panel cannot be built anyway.
  if (!I18n || !Config) return;

  function panelHost() {
    try {
      return document.getElementById(PANEL_ID);
    } catch (error) {
      return null;
    }
  }

  function shadowOf(host) {
    return (host && (host.shadowRoot || host.shadow)) || null;
  }

  function currentLang() {
    const handle = window.__snakeAutoplay;
    if (handle && handle.config && I18n.has(handle.config.lang)) return handle.config.lang;
    return I18n.DEFAULT_LANG;
  }

  function buildRow(lang) {
    const row = document.createElement('div');
    row.id = ROW_ID;
    row.setAttribute('style', ROW_STYLE);

    const label = document.createElement('span');
    label.textContent = I18n.t(lang, 'language');

    const select = document.createElement('select');
    select.setAttribute('style', SELECT_STYLE);
    select.setAttribute('aria-label', I18n.t(lang, 'language'));
    for (const entry of I18n.LANGUAGES) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      select.appendChild(option);
    }
    select.value = lang;
    select.addEventListener('change', () => {
      const next = I18n.normalizeLang(select.value);
      label.textContent = I18n.t(next, 'language');
      const handle = window.__snakeAutoplay;
      if (handle && typeof handle.applyConfig === 'function') {
        handle.applyConfig({ lang: next });
        // `applyConfig` only applies; the switch has to be written to storage to survive a reload.
        if (typeof Config.save === 'function') {
          Config.save(Object.assign({}, handle.config, { lang: next }));
        }
      } else {
        select.value = currentLang();
      }
    });

    row.appendChild(label);
    row.appendChild(select);
    return row;
  }

  // The configuration column first, then the card, then the shadow root: whichever one exists keeps
  // the row inside the panel, where the card's own padding and rounded corner apply.
  function slotOf(shadow) {
    const pick = (selector) =>
      (typeof shadow.querySelector === 'function' ? shadow.querySelector(selector) : null);
    return pick(`#${SLOT_ID}`) || pick('.panel') || shadow;
  }

  function inject() {
    const host = panelHost();
    const shadow = shadowOf(host);
    if (!shadow || typeof shadow.appendChild !== 'function') return;
    if (shadow.querySelector && shadow.querySelector(`#${ROW_ID}`)) return;
    if (typeof shadow.getElementById === 'function' && shadow.getElementById(ROW_ID)) return;
    slotOf(shadow).appendChild(buildRow(currentLang()));
  }

  function watch() {
    inject();
    if (typeof MutationObserver !== 'function') {
      // No observer: the panel is appended to `document.documentElement`, so a slow poll is enough.
      setInterval(inject, 1000);
      return;
    }
    // Only direct children of <html> are watched: `panel.js` appends the host there, and a shallow
    // observer does not fire for every React render on the page.
    const observer = new MutationObserver(() => inject());
    observer.observe(document.documentElement, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch, { once: true });
  } else {
    watch();
  }
})();
