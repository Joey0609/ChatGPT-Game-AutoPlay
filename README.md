# ChatGPT Snake Autoplay

**English** · [中文](README.zh-CN.md)

A Chromium (MV3) extension. While ChatGPT generates an image the page shows a waiting-screen snake game; the extension recognizes the board and plays it automatically, with a switchable strategy, a live recognition panel and a five-language UI.

## Install

1. Open `chrome://extensions` (or the extension page of any Chromium browser, e.g. Edge).
2. Turn on **Developer mode** and click **Load unpacked**.
3. Select this folder and then refresh the ChatGPT page.
4. Click the extension icon. The popup has four controls: the **Auto-play** switch, the **Show panel** switch (directly under Auto-play), the **Strategy** dropdown and the **Language** dropdown; the version printed at the bottom matches `manifest.json` exactly (for example `Version 1.0.0`). Both switches are written to `chrome.storage.sync` **and** `chrome.storage.local` (each with a `savedAt` stamp, the newest copy wins on load), so a page refresh or a browser restart keeps them - and if one storage area fails to write, the other still holds the setting. The polling interval is not configurable: it is fixed at 50ms (a game step takes 95-190ms, so 50ms is early enough to queue the next direction).
5. When the game appears, a recognition panel shows up on the right: grid, snake length, head, food, direction, the decision reason and the **planned route**. The blue dashed line in the preview is the path the algorithm intends to take. The whole panel is controlled by the single **Show panel** switch - turning it off hides the panel completely while reading and deciding keep running.
6. After a code change, click **Reload** for this extension on `chrome://extensions` (refreshing the ChatGPT page is not enough), then refresh the page.

### Interface language

The **Language** dropdown switches between **English / 中文 / Français / Русский / Español** and defaults to **English**. The language lives in the same stored config as the switches (the `lang` field, same dual-area persistence + `savedAt`), so reopening the browser keeps the language you picked.

- Switching re-renders the popup labels, the status line and the version line immediately, and the panel on the page is **rebuilt** in the new language (the panel writes its static labels once at creation, so `content.js` drops the old panel and builds a fresh one - there is never more than one panel on the page).
- Each language ships 45 UI strings and 4 direction names (`i18n.js`, `window.SnakeI18n`); an unknown language id falls back to English.
- **Console logs stay in English** (so they can be searched against this document and the code); only the UI follows the language.

## How the board is recognized (three layers, best to worst)

1. **React Fiber (primary path)** - `bridge.js` runs in the MAIN world, follows the `__reactFiber$…` / `__reactInternalInstance$…` expando property React puts on every DOM node it renders (`bridge.js:48`), finds the game component's `{type, state}` ref and reads `columns/rows/segments/food/direction/queuedDirection/score/gameOver` directly. `segments[0]` is the head and index `i` maps to `col = i % columns, row = Math.floor(i / columns)`. This is exact state and does not depend on pixels. It polls every 40ms (the fastest step is 95ms, so the poll must be clearly faster) and reports `queuedDirection` with the snapshot.
2. **Canvas vision (fallback)** - `vision.js` reads the game canvas (skipping the hidden spare canvas the page keeps), measures the dot-lattice pitch (`cellSize` / `offset`), extracts the blue blobs, chains them into the snake using the renderer's taper (head darkest and largest, fading towards the tail) and picks out the food. Torus wrapping is handled in adjacency, chaining and pathfinding.
3. **Kinematic direction correction** - when the taper saturates the chain order cannot tell head from neck, so `reader.js` derives the heading from the last successful head position (the head just walked in from there, so that cell is the neck).

Rules that beat pixels:

- Blobs the chain did not cover (a long snake's middle is drawn identically, so the chain can miss a few cells) are passed to the algorithm as **walls** (`obstacles`), so the planner cannot plan through its own body.
- Food prefers a blob **not touching the body**; only when every candidate touches the body does it fall back to "closest to the head" (food really can sit right next to it).
- When bright blobs cover more than half the board the read is rejected (`maxBlobShare = 0.5`): a snake cannot fill the board, so that must be the page's own background animation.

## Before the game starts

While the image is generating the board element stays in the page, but the page paints its own background animation inside it (a bright dot lattice over the whole area) and fades the game canvas to `opacity: 0`. The extension handles this as follows:

- **Canvas selection**: the game canvas is the **last** canvas inside the board and it must actually be visible (`display`/`visibility`/`opacity` all showing) to count as "the game is here". Otherwise it is treated as not started: no pixels are read, no Space is pressed and no direction key is sent (otherwise the keys would land on the page and the lattice would be read as a board).
- The panel status pill reads `Not started` (「未开始」 in the Chinese UI), the preview says `The game has not started yet` and the reason row says `Waiting for the game to start`.
- The console prints `The game has not started; no keys are sent until its canvas appears.` once.
- Once the game is really on screen the extension resumes reading and auto-starts; when the game ends or leaves the screen it goes back to waiting for the next one.

## Game rules (read from the page source - the algorithms follow them)

- **Board**: `columns = max(8, floor(containerWidth / 21))`, `rows = max(10, floor(containerHeight / 21))`; it is drawn scaled by `min(width/columns, height/rows)` and centered.
- **Initial state**: 4 segments, head in the middle of the board, body extending left, direction right; food 4 cells to the right of the head on the same row (wrapping around).
- **Wrapping**: leaving the board horizontally or vertically wraps to the other side; hitting a wall never kills you.
- **Collision**: `hitSelf = segments.indexOf(next)` and the game only ends when `hitSelf !== -1 && (hitFood || hitSelf < segments.length - 1)`. In other words **moving into the last segment (the tail) is legal** - that segment moves away this step, and food never spawns on the snake, so that move can never eat at the same time. The algorithm therefore treats the last segment as enterable (only with length ≤ 3 does it fall back to `tail-escape`), which fixed the "trapped" false deaths caused by the old "the long snake owns its tail" heuristic. Filling the whole board (nowhere to spawn food) counts as a win.
- **Eating**: length +1 and score +1; without food the head advances and the tail retreats, so the length stays the same. New food is uniform random over all free cells.
- **Speed**: `max(95, 190 - 7 * score)` - 190ms per step at score 0, 7ms faster per food eaten, capped at 95ms after 14 foods. The auto-play therefore never hardcodes its rhythm: `content.js` asks `Algorithms.stepIntervalMs(score)` how long the current step takes and, on the Fiber path, waits until the game has consumed the previous key (`queuedDirection` cleared) before sending the next one.
- **Direction**: only one direction can be queued at a time, a 180° reversal is ignored, the same direction is ignored; Space pauses/resumes and Esc exits.

## Strategies

- **Safe BFS (default)**: find the shortest path to the food first and check that the tail is still reachable afterwards; otherwise fall back to the move with the largest reachable area. All four directions wrap around the board.
- **Space evaluation**: order legal moves by reachable space, breaking ties by closeness to the food.
- **Cycle**: walk a Hamiltonian cycle when the row count is even, which guarantees survival; a short jump is allowed when the food sits close ahead on the cycle.

Every decision carries a **planned route** (`route`): the BFS path to the food / a run of steps along the Hamiltonian cycle / the next cell, at most 28 steps. It is drawn in the panel as the blue dashed line and shows up in the console log as `route: N`.

Auto-play only sends the next key after the game has consumed the previous one (so it never turns twice inside one tick) and is throttled by the fixed 50ms poll; the timeout threshold follows the real step length (`stepMs + max(120, interval*2)` with `interval` fixed at 50), so the extension does not fall behind as the snake speeds up.

## Console logs

The content script prints logs prefixed with `[Snake Autoplay]` in the ChatGPT page's DevTools console: board appeared/disappeared, successful reads (with grid/snake/head/food/direction), read failures, automatic decisions (with reason, algorithm, `stepMs` and `route`) and manual/automatic key presses. These logs are **always English**, whatever the UI language is. Identical repeated failures and unchanged state are de-duplicated. The page's own `Canvas2D: Multiple readback operations using getImageData...` warning comes from ChatGPT creating the 2D context first; the extension cannot remove it and it does not affect anything.

## Tests

Node.js is required (no browser):

```sh
node test/test-algorithms.js        # algorithms: cycle coverage/adjacency, no reversal, wrapping BFS, three strategies × 4000 steps survival
node test/test-recognition.js       # pixel recognition: wrapped tail, short snake, vertical wrap, no lattice, background-animation lattice must be rejected
node test/test-real-board.js        # run the recognizer over the fixture captured from the real board
node test/test-bridge.js            # React bridge: fiber lookup, snapshot de-duplication, polling and heartbeat
node test/test-i18n.js              # five languages: identical key sets, placeholders, fallbacks, direction names, every decision reason translated
node test/test-popup.js             # popup: version matches manifest, both switches persist, language switch applies instantly
node test/test-build.js             # release build: store zips, Firefox manifest, reproducible archives, userscript metadata/order, CRX signing round-trip + tamper detection, checksums, tag guard
node test/test-userscript.js        # the userscript bundle boots in a page with no chrome.* APIs: shims, storage, panel rebuild, in-panel language picker
node test/test-integration.js 900 fiber    # headless integration: React bridge → decision → real key events → simulated game
node test/test-integration.js 900 canvas   # headless integration: the canvas vision fallback
```

The integration test loads the real extension scripts against a fake DOM/chrome shim, simulates a 17×15 torus snake and checks every read against the truth (grid/head/food/direction/body coverage), and also covers "nothing happens while the game is off screen", "the popup's show-panel switch really hides the whole panel" and "switching the language rebuilds the panel and leaves exactly one on the page".

In PowerShell, redirect test output to a file and read it back (`Start-Process -FilePath node -ArgumentList 'test/test-integration.js','900','canvas' -RedirectStandardOutput temp\canvas-run.txt -NoNewWindow -Wait`); a bare `>` or a pipeline hits this environment's output-encoding limits.

## Build and release

`scripts/build.js` produces every package with **no dependencies at all** - Node standard library only, there is no `package.json` and nothing to install:

```sh
node scripts/build.js                            # everything into dist/
node scripts/build.js --check-tag v1.0.0         # also fail when the tag disagrees with manifest.json
node scripts/build.js --key-env CRX_PRIVATE_KEY  # additionally sign a .crx (PEM or base64-encoded PEM)
```

What lands in `dist/`:

| Asset | What it is for |
| --- | --- |
| `snake-autoplay-<version>-chrome.zip` and `snake-autoplay-chrome.zip` | Chrome Web Store and Microsoft Edge Add-ons upload (the stable name is the one the workflow and the docs use) |
| `snake-autoplay-<version>-firefox.zip` and `snake-autoplay-firefox.zip` | Mozilla Add-ons (AMO). The manifest inside adds `browser_specific_settings.gecko` with `strict_min_version: "128.0"`, the first Firefox that supports `world: "MAIN"` in a declared content script |
| `snake-autoplay-<version>.user.js` and `snake-autoplay.user.js` | Tampermonkey / Violentmonkey script. The stable name is what `@updateURL` points at, so installed copies update themselves from the latest release |
| `snake-autoplay-<version>.crx` | only when a signing key is passed |
| `chrome/` and `firefox/` | unpacked folders for `chrome://extensions` -> Load unpacked, or `about:debugging` -> Load Temporary Add-on |
| `checksums.txt` | SHA-256 of every asset above |

- **Userscript**: the modules are concatenated in `userscript/` order (shim, algorithms ... content, glue). `userscript/00-shims.js` adds the `chrome.storage` / `chrome.runtime` pieces the page world lacks (they are kept in the page's `localStorage` under `snake-autoplay:config`), and `userscript/99-glue.js` adds the language dropdown to the on-page panel, because a userscript has no popup. The metadata uses `@grant none` deliberately: `bridge.js` has to run in the page world to read the React fiber. An existing `chrome.*` is never overwritten, so the very same bundle also runs where the real extension APIs exist.
- **Signing a `.crx`**: `scripts/crx3.js` writes the CRX3 container itself (zero dependencies: `crypto.sign` plus a hand-built protobuf header, verified by `test/test-build.js`). `CRX_PRIVATE_KEY` (or `--key <file.pem>`) is a PEM private key such as `openssl genrsa -out key.pem 2048`; a base64-encoded PEM is accepted as well. The extension ID is `SHA-256(public key)` in Chrome's `a`-`p` alphabet, so **a new key means a new extension ID**, and Chrome only installs a `.crx` that matches the Web Store or an enterprise policy - the file is for your own policy deployment, everybody else uses the zip.
- **GitHub Action** (`.github/workflows/release.yml`): pushing a tag like `v1.0.0` builds everything, uploads the artifacts and creates the GitHub Release with every package attached. Pull requests and manual runs only build and test. The build fails when the tag does not match `manifest.json`. The store steps are optional and each one is skipped until its secrets exist:

| Secret | Effect |
| --- | --- |
| `CRX_PRIVATE_KEY` | adds the signed `.crx` to the release |
| `AMO_API_KEY`, `AMO_API_SECRET` | signs an unlisted XPI for Firefox and attaches it (`kewisch/action-web-ext`) |
| `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | uploads the zip as a new version of the existing Chrome Web Store item (`chrome-webstore-upload-cli`) |
| `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` | uploads the zip as a new version of the existing Edge add-on (`wdzeng/edge-addon`) |

The two store steps only publish **new versions of an item that already exists**: create the item once in the store dashboard (a manual first upload), then put its id in the secret. Publishing to the Chrome Web Store is an explicit `publish` command on purpose - the workflow only uploads, so a tag never submits something for review by surprise.

## Repository layout

- The root holds the extension itself (`manifest.json`, the `*.js` modules, `popup.*`) plus the two READMEs.
- `scripts/` holds the release build: `build.js` (packages, manifests, userscript, checksums), `zip.js` (ZIP writer/reader) and `crx3.js` (CRX3 signing and verification). Standard library only.
- `userscript/` holds what only the Tampermonkey build needs: `header.txt` (metadata template with `{{version}}` / `{{author}}` / `{{updateURL}}`), `00-shims.js` (the `chrome.*` stand-in) and `99-glue.js` (the in-panel language picker).
- `.github/workflows/release.yml` builds and publishes on a tag.
- `test/` holds the Node test suites and their fixture `real-board.rgba`. It is local development material and is kept out of the repository by `.gitignore` - if you want CI to run the suites, commit `test/` (remove that ignore line) and the workflow picks them up.
- `temp/` holds diagnostic scripts, image crops and test transcripts; `dist/` holds the build output. Both are ignored as well (together with `.test/`, `.tmp/`, `doc/`, editor/agent directories and so on).

## Known limitations

- The primary (Fiber) path depends on ChatGPT's internal React structure (component props, hook ref shapes). A page update can break it; the extension then falls back to pixel recognition automatically.
- The pixel fallback cannot be cell-exact once the snake is long: the render taper saturates and whole runs of segments are drawn identically, so the chain order is geometrically ambiguous (in the integration test about 5% of reads over 900 ticks miss 1-6 cells, while head/food/grid stay correct). The fallback is therefore accepted as "survive as long as possible" while the primary path is accepted as "no drift for a whole game".
- Key injection relies on the page still accepting synthetic keyboard events, and a tainted canvas cannot be read.

## Versioning

`manifest.json` and the popup print the same three-part version (currently `1.0.0`). **Every delivered round of user feedback bumps it by one** (`1.0.0` -> `1.0.1` -> ...); change `manifest.json` and `VERSION` in `bridge.js` together, and update the popup's fallback value as well. A release tag must be `v<version>` - the Release workflow refuses to publish a tag that disagrees with `manifest.json`, so the tag, the extension and `@version` of the userscript can never drift apart.
