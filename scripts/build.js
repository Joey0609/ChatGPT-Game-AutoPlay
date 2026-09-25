/**
 * Release build: turns the plain browser extension in this folder into every package we ship.
 *
 *   dist/chrome/                                unpacked Chromium build (Load unpacked, Edge, Brave, …)
 *   dist/firefox/                               unpacked Firefox build (adds browser_specific_settings)
 *   dist/snake-autoplay-<version>-chrome.zip    Chrome Web Store + Microsoft Edge Add-ons upload
 *   dist/snake-autoplay-chrome.zip              the same archive under a stable name
 *   dist/snake-autoplay-<version>-firefox.zip   Mozilla Add-ons (AMO) upload
 *   dist/snake-autoplay-firefox.zip             the same archive under a stable name
 *   dist/snake-autoplay-<version>.user.js       Tampermonkey / Violentmonkey userscript
 *   dist/snake-autoplay.user.js                 the same script under the name @updateURL points at
 *   dist/snake-autoplay-<version>.crx           only with --key / --key-env (see scripts/crx3.js)
 *   dist/checksums.txt                          SHA-256 of every release asset
 *
 * There is no package.json and no dependency: zipping is scripts/zip.js, CRX signing is
 * scripts/crx3.js, and everything else is `fs`. Usage:
 *
 *   node scripts/build.js                            # build into dist/
 *   node scripts/build.js --out temp/build           # build somewhere else (used by the tests)
 *   node scripts/build.js --check-tag v1.0.0         # fail when the tag and manifest.json disagree
 *   node scripts/build.js --key-env CRX_PRIVATE_KEY  # sign a .crx with a PEM private key
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createZip } = require('./zip');
const crx = require('./crx3');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'dist');
const USERSCRIPT_DIR = path.join(ROOT, 'userscript');

// Everything a browser loads. Test suites, scripts/ and userscript/ never end up in a package.
const EXTENSION_FILES = [
  'manifest.json',
  'algorithms.js',
  'vision.js',
  'logger.js',
  'page.js',
  'reader.js',
  'i18n.js',
  'panel.js',
  'config.js',
  'content.js',
  'bridge.js',
  'popup.html',
  'popup.css',
  'popup.js'
];

// The userscript is the same modules concatenated. `bridge.js` is inserted before `content.js` so the
// first poll already has a listener, and `content.js` stays last so the pages it builds are complete.
const BUNDLE_ORDER = [
  'algorithms.js',
  'vision.js',
  'logger.js',
  'page.js',
  'reader.js',
  'i18n.js',
  'panel.js',
  'config.js',
  'bridge.js',
  'content.js'
];
const USERSCRIPT_PARTS = ['00-shims.js'].concat(BUNDLE_ORDER).concat(['99-glue.js']);

// AMO needs a stable id; it is baked into the signed add-on, so change it once, before the first
// upload, and never again. `world: "MAIN"` in a declarative content script needs Firefox 128+.
const GECKO_ID = process.env.FIREFOX_EXTENSION_ID || 'snake-autoplay@chatgpt-snake-autoplay.github.io';
const GECKO_MIN_VERSION = '128.0';

// ------------------------------------------------------------------ helpers

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function manifestText(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function chromiumManifest() {
  return JSON.parse(read(path.join(ROOT, 'manifest.json')));
}

function firefoxManifest(chromium) {
  const manifest = JSON.parse(JSON.stringify(chromium));
  manifest.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION
    }
  };
  // AMO already knows the update channel of a signed add-on; keeping the key out of Firefox avoids
  // a warning about the unused `update_url` in some Firefox versions.
  delete manifest.update_url;
  return manifest;
}

function normalizePrivateKey(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('The private key is empty.');
  if (text.includes('BEGIN')) return text;
  const decoded = Buffer.from(text, 'base64').toString('utf8');
  if (decoded.includes('BEGIN')) return decoded;
  throw new Error('The private key is neither a PEM nor a base64-encoded PEM.');
}

function userscriptSource(options) {
  const version = options.version;
  const repo = options.repo || '';
  const updateURL = repo
    ? `https://github.com/${repo}/releases/latest/download/snake-autoplay.user.js`
    : '';

  const header = read(path.join(USERSCRIPT_DIR, 'header.txt'))
    .replace('{{version}}', version)
    .replace('{{author}}', options.author || 'chatgpt_autoplay_snake')
    .replace('{{updateURL}}', updateURL ? `// @updateURL    ${updateURL}\n// @downloadURL  ${updateURL}` : '');

  const chunks = [header];
  for (const name of USERSCRIPT_PARTS) {
    const file = name === '00-shims.js' || name === '99-glue.js'
      ? path.join(USERSCRIPT_DIR, name)
      : path.join(ROOT, name);
    const banner = `\n// ===========================================================================\n// ${name}\n// ===========================================================================\n`;
    // The trailing `;` is a deliberate statement separator: without it an IIFE that ends in `})()`
    // followed by a line starting with `(` would be parsed as a call of the previous result.
    chunks.push(`${banner}${read(file).replace('{{version}}', version)}\n;\n`);
  }
  return chunks.join('\n');
}

// ------------------------------------------------------------------ the build

/**
 * @param {object} [options]
 * @param {string} [options.out]        Output directory (default: dist/).
 * @param {string} [options.privateKey] PEM private key used to sign a .crx.
 * @param {string} [options.repo]       "owner/name", used for the userscript update URLs.
 * @param {string} [options.author]     @author line of the userscript.
 * @param {boolean} [options.quiet]     Do not print progress.
 * @returns {object} A description of everything that was written.
 */
function build(options = {}) {
  const quiet = Boolean(options.quiet);
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const out = path.resolve(options.out || DEFAULT_OUT);
  const chromium = chromiumManifest();
  const version = chromium.version;

  if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
    throw new Error(`manifest.json has a version Chrome will not accept: ${version}`);
  }

  fs.rmSync(out, { recursive: true, force: true });
  const chromeDir = path.join(out, 'chrome');
  const firefoxDir = path.join(out, 'firefox');

  const chromiumFiles = {};
  for (const name of EXTENSION_FILES) {
    chromiumFiles[name] = fs.readFileSync(path.join(ROOT, name));
  }

  const firefox = firefoxManifest(chromium);
  const firefoxFiles = Object.assign({}, chromiumFiles, {
    'manifest.json': Buffer.from(manifestText(firefox), 'utf8')
  });

  for (const name of EXTENSION_FILES) {
    writeFile(path.join(chromeDir, name), chromiumFiles[name]);
    writeFile(path.join(firefoxDir, name), firefoxFiles[name]);
  }

  const chromeZip = createZip(EXTENSION_FILES.map((name) => ({ name, data: chromiumFiles[name] })));
  const firefoxZip = createZip(EXTENSION_FILES.map((name) => ({ name, data: firefoxFiles[name] })));
  const userscript = Buffer.from(userscriptSource({
    version,
    repo: options.repo,
    author: options.author
  }), 'utf8');

  const artifacts = new Map();
  artifacts.set(`snake-autoplay-${version}-chrome.zip`, chromeZip);
  artifacts.set('snake-autoplay-chrome.zip', chromeZip);
  artifacts.set(`snake-autoplay-${version}-firefox.zip`, firefoxZip);
  artifacts.set('snake-autoplay-firefox.zip', firefoxZip);
  artifacts.set(`snake-autoplay-${version}.user.js`, userscript);
  // Stable name: this is what the @updateURL inside the script points at.
  artifacts.set('snake-autoplay.user.js', userscript);

  let extensionId = null;
  let crxName = null;
  if (options.privateKey) {
    const packed = crx.pack(chromeZip, normalizePrivateKey(options.privateKey));
    extensionId = packed.extensionId;
    crxName = `snake-autoplay-${version}.crx`;
    artifacts.set(crxName, packed.buffer);
    log(`Signed a .crx for extension id ${extensionId}`);
  }

  const checksums = Array.from(artifacts.keys()).sort()
    .map((name) => `${sha256(artifacts.get(name))}  ${name}`)
    .join('\n');
  artifacts.set('checksums.txt', Buffer.from(`${checksums}\n`, 'utf8'));

  for (const [name, data] of artifacts) writeFile(path.join(out, name), data);

  log(`Built ChatGPT Snake Autoplay ${version} into ${path.relative(ROOT, out) || '.'}`);
  for (const name of Array.from(artifacts.keys()).sort()) {
    log(`  ${name} (${artifacts.get(name).length} bytes)`);
  }
  if (!options.privateKey) {
    log('  no .crx: pass --key <file.pem> or --key-env <VAR> to sign one');
  }

  return {
    version,
    outDir: out,
    chromeDir,
    firefoxDir,
    extensionId,
    crxName,
    files: Array.from(artifacts.keys()).sort(),
    artifacts
  };
}

// ------------------------------------------------------------------ command line

function parseArgs(argv) {
  const options = { quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') options.out = argv[(index += 1)];
    else if (arg === '--key') options.keyFile = argv[(index += 1)];
    else if (arg === '--key-env') options.keyEnv = argv[(index += 1)];
    else if (arg === '--repo') options.repo = argv[(index += 1)];
    else if (arg === '--author') options.author = argv[(index += 1)];
    else if (arg === '--check-tag') options.checkTag = argv[(index += 1)];
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function runCli(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log([
      'Usage: node scripts/build.js [options]',
      '',
      '  --out <dir>        output directory (default: dist/)',
      '  --check-tag <tag>  fail unless the tag matches manifest.json (e.g. --check-tag v1.0.0)',
      '  --key <file.pem>   sign a .crx with this PEM private key',
      '  --key-env <NAME>   read the PEM private key from an environment variable',
      '  --repo <o/n>       owner/name used for the userscript update URLs',
      '  --author <name>    @author line of the userscript',
      '  --quiet            only report failures'
    ].join('\n'));
    return 0;
  }

  const version = chromiumManifest().version;

  if (options.checkTag) {
    const wanted = String(options.checkTag).replace(/^refs\/tags\//, '').replace(/^v/, '');
    if (wanted !== version) {
      console.error(`Tag ${options.checkTag} does not match manifest.json version ${version}.`);
      console.error('Bump "version" in manifest.json (and bridge.js + popup.js) or retag the release.');
      return 1;
    }
    console.log(`Tag ${options.checkTag} matches manifest.json ${version}.`);
  }

  let privateKey = null;
  if (options.keyFile) {
    privateKey = fs.readFileSync(options.keyFile, 'utf8');
  } else if (options.keyEnv) {
    const value = process.env[options.keyEnv];
    if (!value) {
      console.error(`Environment variable ${options.keyEnv} is empty; building without a .crx.`);
    } else {
      privateKey = value;
    }
  }

  const result = build({
    out: options.out,
    privateKey,
    repo: options.repo || process.env.GITHUB_REPOSITORY || '',
    author: options.author,
    quiet: options.quiet
  });

  if (result.extensionId) {
    console.log(`Extension id for this key: ${result.extensionId}`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`Build failed: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  build,
  EXTENSION_FILES,
  BUNDLE_ORDER,
  USERSCRIPT_PARTS,
  GECKO_ID,
  GECKO_MIN_VERSION,
  chromiumManifest,
  firefoxManifest,
  userscriptSource
};
