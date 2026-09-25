const enabledInput = document.querySelector('#enabled');
const panelInput = document.querySelector('#panel');
const algorithmInput = document.querySelector('#algorithm');
const languageInput = document.querySelector('#language');
const status = document.querySelector('#status');
const versionLabel = document.querySelector('#version');
const { defaults, normalize, save, load } = window.SnakeConfig;
const I18n = window.SnakeI18n;

let tabId;
let config = { ...defaults };
// The status line is kept as a translation KEY, so switching the language re-renders it instead of
// leaving a sentence in the language that was active when it was written.
let statusKey = 'checking';
let statusState = '';

function t(key, vars) {
  return I18n.t(config.lang, key, vars);
}

function setStatus(key, state = '') {
  statusKey = key;
  statusState = state;
  renderStatus();
}

function renderStatus() {
  status.textContent = statusKey ? t(statusKey) : '';
  status.dataset.state = statusState;
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
  renderStatus();
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
    // Off-site there is no content script to talk to: the switches stay disabled and the status stays
    // empty instead of explaining it.
    setStatus('');
    enabledInput.disabled = true;
    return;
  }
  try {
    const current = await send('snake:status');
    enabledInput.checked = current.enabled;
    setStatus(current.board ? 'boardFound' : 'waitingBoard', current.board ? 'ready' : '');
  } catch (_) {
    setStatus('pageReload', 'error');
  }
});

enabledInput.addEventListener('change', async () => {
  // Persist first: the switch itself is the setting, whether or not the page is reachable.
  await persist();
  try {
    await send('snake:toggle', { enabled: enabledInput.checked });
    setStatus(enabledInput.checked ? 'autoOn' : 'autoOff', 'ready');
  } catch (_) {
    setStatus('savedReload', 'error');
  }
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
