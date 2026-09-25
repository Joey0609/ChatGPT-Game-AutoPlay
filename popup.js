const enabledInput = document.querySelector('#enabled');
const panelInput = document.querySelector('#panel');
const algorithmInput = document.querySelector('#algorithm');
const languageInput = document.querySelector('#language');
const versionLabel = document.querySelector('#version');
const { defaults, normalize, save, load } = window.SnakeConfig;
const I18n = window.SnakeI18n;

let tabId;
let config = { ...defaults };
// Set the moment the user flips the switch, so an answer from the page that is already in flight can
// never undo the click.
let switchTouched = false;

function t(key, vars) {
  return I18n.t(config.lang, key, vars);
}

// Rewrites every static text node from i18n.js. Static markup ships English plus a `data-i18n` key;
// this is the only place that knows about both.
function applyLanguage() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const text = t(node.getAttribute('data-i18n'));
    if (text) node.textContent = text;
  }
  // The manifest version is the single source of truth: the popup prints exactly the same numbers.
  versionLabel.textContent = t('version', { version: chrome.runtime.getManifest?.().version || '1.0.0' });
  document.documentElement.lang = config.lang;
  if (languageInput.value !== config.lang) languageInput.value = config.lang;
}

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, ...payload }, (response) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(response);
    });
  });
}

function onChatGPT(tab) {
  const url = (tab && tab.url) || '';
  return url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/');
}

// The two switches, the strategy and the language ARE the persisted config: nothing is kept only in
// memory.
function readForm() {
  return normalize({
    ...config,
    algorithm: algorithmInput.value,
    autoStart: enabledInput.checked,
    panel: panelInput.checked,
    lang: languageInput.value
  });
}

async function persist() {
  config = readForm();
  // Fire and forget into every storage area; both switches survive a browser restart because of this.
  save(config);
  try {
    await send('snake:config', { config });
  } catch (_) { /* The tab may not have the content script loaded yet. */ }
}

chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  tabId = tab?.id;
  // Show what was stored first, so the switches are right even before the page answers.
  const stored = await new Promise((resolve) => load(resolve));
  if (stored) config = normalize({ ...config, ...stored });
  enabledInput.checked = config.autoStart;
  panelInput.checked = config.panel;
  algorithmInput.value = config.algorithm;
  languageInput.value = config.lang;
  applyLanguage();

  if (!onChatGPT(tab)) {
    // Off-site there is no content script to talk to, but the controls are still the settings: each one
    // writes the stored config, and the page picks it up on its next load. So nothing is disabled - the
    // tooltip just says why flipping a switch changes nothing on screen right now.
    const hint = t('offsiteHint');
    for (const node of [enabledInput, panelInput, algorithmInput, languageInput]) node.title = hint;
    return;
  }
  try {
    const current = await send('snake:status');
    // Storage is the source of truth. A page that still reports autoplay running while the setting says
    // "off" - a content script from an earlier load, a toggle message that never arrived - is put back
    // in step here, instead of flipping the switch back on under the user's hand.
    if (!switchTouched && current && current.enabled !== enabledInput.checked) {
      await send('snake:toggle', { enabled: enabledInput.checked });
    }
  } catch (_) { /* No content script yet: the switch already shows the stored setting. */ }
});

enabledInput.addEventListener('change', async () => {
  switchTouched = true;
  // Persist first: the switch itself is the setting, whether or not the page is reachable.
  await persist();
  try {
    await send('snake:toggle', { enabled: enabledInput.checked });
  } catch (_) { /* Stored already; the page picks it up on its next load. */ }
});

panelInput.addEventListener('change', persist);
algorithmInput.addEventListener('change', persist);

languageInput.addEventListener('change', async () => {
  // Apply immediately - the whole popup switches language under the user's hand - then persist it like
  // any other setting (the content script rebuilds the panel from the pushed config).
  config.lang = I18n.normalizeLang(languageInput.value);
  applyLanguage();
  await persist();
});
