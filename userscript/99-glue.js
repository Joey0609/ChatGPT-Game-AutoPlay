/**
 * Userscript glue, bundled LAST (after content.js).
 *
 * A browser extension has a popup with the language dropdown; a userscript has no popup, so the
 * language selector is added to the on-page panel instead. Everything else (strategies, the
 * auto-play switch, the board preview) already lives in `panel.js` and works unchanged.
 *
 * The panel is created inside a shadow root that `panel.js` attaches to `#snake-autoplay-panel`,
 * so the extra row is injected there, styled with inline rules that do not depend on the panel's
 * stylesheet. `content.js` rebuilds the panel whenever the language changes, and the observer here
 * re-injects the row into the new one.
 */
(() => {
  'use strict';

  const I18n = window.SnakeI18n;
  const Config = window.SnakeConfig;
  const PANEL_ID = 'snake-autoplay-panel';
  const ROW_ID = 'snake-autoplay-userscript-language';
  const ROW_STYLE = [
    'display:flex', 'align-items:center', 'justify-content:space-between', 'gap:8px',
    'padding:8px 10px', 'border-top:1px solid rgba(148,163,184,.3)',
    'font:12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', 'color:#0f172a'
  ].join(';');
  const SELECT_STYLE = [
    'font:inherit', 'color:inherit', 'background:#fff', 'border:1px solid rgba(148,163,184,.6)',
    'border-radius:6px', 'padding:2px 4px', 'max-width:120px'
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

  function inject() {
    const host = panelHost();
    const shadow = shadowOf(host);
    if (!shadow || typeof shadow.appendChild !== 'function') return;
    if (shadow.querySelector && shadow.querySelector(`#${ROW_ID}`)) return;
    if (typeof shadow.getElementById === 'function' && shadow.getElementById(ROW_ID)) return;
    shadow.appendChild(buildRow(currentLang()));
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
