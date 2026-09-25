<p align="center"><img src="logo.png" alt="ChatGPT Game Autoplay: a green snake climbing a dark playfield towards a red apple." width="104" height="104"></p>

# ChatGPT Game Autoplay

**English** · [中文](README.zh-CN.md)

ChatGPT shows a little snake game on the waiting screen while it draws an image. **ChatGPT Game Autoplay plays it for you** - it recognizes the real board, steers the snake with a strategy of your choice and keeps a live panel on the page so you can watch what it is thinking.

Everything happens locally in your browser: the extension reads the page it is already on, and it never sends anything anywhere.

<img src="screenshot.png" alt="The extension on a real ChatGPT image-generation page: the snake game it is playing on the left, the live panel on the right of the page." width="760">

*On a real image-generation page: the game it is playing on the left, the live panel on the right.*

## What you get

- **Hands-free play.** The game starts, the snake starts moving. As soon as a game ends it waits quietly for the next one.
- **A live panel** on the right of the page: miniature board, snake length, where the food is, where the snake is heading, the reason for the current move and the **planned route** drawn as a blue dashed line.
- **Three strategies**, switchable at any time from the toolbar popup.
- **Five languages** - English, 中文, Français, Русский, Español (English by default).
- **Board-aware movement.** The board wraps around (no walls), and the snake deliberately uses the "you may move into your own tail" rule, so it does not trap itself even when the body fills most of the board.
- **Play it your way.** Three builds: a Chrome/Edge extension, a Firefox add-on and a Tampermonkey userscript.
- **You stay in control.** Auto-play can be paused from the popup at any moment; the arrow keys, WASD, Space and Esc still work exactly as before.

## Install

### Chrome, Edge or any Chromium browser

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open `chatgpt.com` (or `chat.openai.com`) and start an image generation. When the game appears, the panel shows up on the right and the snake starts playing by itself.
5. Change the strategy, language or switches from the toolbar popup whenever you like.

If you edit the code, click **Reload** for this extension on the extensions page, then refresh the ChatGPT tab.

### Firefox

Firefox **128 or newer**. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `manifest.json` from the Firefox build (see [Build and release](#build-and-release)). A temporary add-on lasts until Firefox restarts.

### Userscript (Tampermonkey / Violentmonkey)

Install `snake-autoplay.user.js` from the [latest release](../../releases/latest) (or build it yourself). The script installs itself with an `@updateURL`, so later releases update automatically. There is no toolbar popup in this build; the language picker lives inside the on-page panel instead.

## Using it

The toolbar popup has four controls:

| Control | What it does |
| --- | --- |
| **Auto-play** | Master switch. Off means the extension only watches and reports, and never presses a key. |
| **Show panel** | Hides or shows the on-page panel. Reading and deciding keep running while it is hidden. |
| **Strategy** | Which algorithm plays the game (see below). |
| **Language** | Language of the popup and the panel. Console logs stay in English so they always match the code. |

Your switches and language are remembered across restarts. The number under the title is the extension version - the popup, `manifest.json` and the userscript always carry the same one. Both dropdowns are painted by the popup itself, so they drop in with a short animation instead of using the browser's own list.

**The popup also works on a tab that is not ChatGPT.** Nothing is greyed out there: each control still writes the stored setting, which the next ChatGPT page picks up when it loads, and the tooltip says exactly that. Only the live status exchange with the page is skipped, because there is no content script to answer on any other site.

### The panel

| Row | Meaning |
| --- | --- |
| Board | Size of the grid in cells, `columns × rows`. |
| Length | How long the snake is right now. |
| Head / Food | Cells of the head and of the food, as `x, y`. |
| Direction | The direction the snake is currently moving in. |
| Source | Where the state came from: the exact game state read from the page, or the pixel fallback. |
| Why | Why the algorithm chose this move, in plain words. |
| Route | Length of the planned route, and the dashed line in the preview. |

*Why* and *Route* each get a full-width line of their own, so a long explanation or a long route is never squeezed into a column. The strategy list and the auto-play switch in the panel are painted and animated like the popup's dropdowns: the list opens upward, its rows arrive one after another, and it closes again as soon as you click anywhere else.

## Strategies

| Strategy | Best for |
| --- | --- |
| **Safe BFS** (default) | The everyday choice: shortest path to the food, but only when the snake can still reach its own tail afterwards. Otherwise it takes the move that leaves the most room. |
| **Flood fill** | Maximum safety in tight spots: it prefers the move with the largest reachable area and only then closes in on the food. |
| **Hamiltonian cycle** | Guaranteed to never die on an even-height board: it follows a fixed loop around the whole board and only jumps ahead when the food happens to be right on the loop. Steady rather than fast. |

All three understand the wrap-around board and are checked against each other in `test/test-algorithms.js` (three strategies × 4000 steps each, no reversals, no self-collisions).

## Good to know

- **Before the game starts** the page paints its own background animation inside the board. The extension can tell that apart from a real game and stays completely passive: no keys are pressed and the panel says *Not started*.
- **While a game runs**, auto-play sends a direction only after the game has consumed the previous one, so the snake never turns twice inside one step, and the pace follows the real speed of the game instead of a fixed timer.
- **Reading is best-effort by design.** The exact game state comes from the page itself; if ChatGPT changes its internals, the extension falls back to reading the board's pixels, which stays correct for the head, the food and the grid but becomes approximate for a very long snake.
- The `Canvas2D: Multiple readback operations using getImageData…` warning in the console comes from ChatGPT creating the canvas context before the extension ever runs. It is harmless and cannot be removed.

## Troubleshooting

Open the DevTools console on the ChatGPT tab. Extension messages are prefixed with `[Game Autoplay]` and report the board appearing/disappearing, successful reads (grid, length, head, food, direction), read failures and every automatic decision (reason, algorithm, step length, route). Repeated identical messages are collapsed.

- **No panel at all** - make sure the extension is enabled and the page was refreshed after installing.
- **Panel shows "Board not recognized"** - ChatGPT's board was not found on the page; wait for the game to start or reload the tab.
- **The snake does not move** - check that *Auto-play* is on and that the game is not paused (press Space in the page).

## Build and release

No dependencies are needed - Node's standard library only, there is no `package.json` and nothing to install:

```sh
node scripts/build.js                            # every package into dist/
node scripts/build.js --check-tag v1.0.0         # also fail when the tag disagrees with manifest.json
node scripts/build.js --key-env CRX_PRIVATE_KEY  # additionally sign a .crx from the PEM key in that variable
```

`dist/` then contains the Chrome/Edge zip, the Firefox zip, the userscript, the unpacked `chrome/` and `firefox/` folders, `checksums.txt` and - when a key was passed - a signed `.crx`. `scripts/build.js` also writes the Firefox manifest (adding `browser_specific_settings.gecko`, minimum Firefox 128) and the userscript bundle (the modules concatenated, plus the userscript-only shims and its in-panel language picker).

**GitHub Action** (`.github/workflows/release.yml`): push a tag such as `v1.0.0` and the workflow tests, builds, attaches every package to the GitHub Release and, when the matching secrets exist, also uploads to Mozilla Add-ons, the Chrome Web Store and Microsoft Edge Add-ons. Pull requests and manual runs just build and test. A tag that disagrees with `manifest.json` fails the build on purpose. Store uploads are only ever *new versions of an item that already exists* - create the item in the store dashboard once, then put its id in a repository secret (`CRX_PRIVATE_KEY`, `AMO_API_KEY` / `AMO_API_SECRET`, `CWS_*`, `EDGE_*`). See the table and comments in the workflow for details.

## Project layout

- Root: the extension itself (`manifest.json`, the modules, `popup.*`), these two READMEs, `screenshot.png` (the picture shown above) and `logo.png`, the master artwork behind the icon above and every icon the extension ships.
- `icons/`: the 16/32/48/128 px icons the manifest declares plus the 128 px picture the popup header shows. `scripts/make-icons.py` derives all of them from `logo.png` with Pillow - it first trims the transparent border around the artwork and then scales it edge to edge, so the snake fills every size instead of floating in padding. Replacing `logo.png` and re-running it refreshes the whole set.
- `scripts/`: the zero-dependency release build (packaging, ZIP and CRX3 writing, signing).
- `userscript/`: the pieces only the Tampermonkey build needs.
- `test/`: the Node test suites and their board fixture. Development material, ignored by git.
- `.github/workflows/`: build and release automation.
- `dist/`, `temp/`: build output and scratch files, both ignored.

### Tests

```sh
node test/test-algorithms.js                      # strategies, wrapping, survival
node test/test-recognition.js                     # pixel recognition, incl. the page's own animation
node test/test-real-board.js                      # recognizer over a board captured from the real game
node test/test-popup.js                           # popup: version, switches, language
node test/test-popup-ui.js                        # popup: painted dropdowns over the real selects
node test/test-popup-css.js                       # popup stylesheet: valid rules, markup coverage, reduced motion
node test/test-i18n.js                            # five languages, identical key sets
node test/test-bridge.js                          # state reading from the page
node test/test-build.js                           # zips, Firefox manifest, userscript, CRX signing, checksums, tag guard
node test/test-userscript.js                      # the userscript bundle in a page without extension APIs
node test/test-panel-ui.js                        # on-page panel: painted picker, switch, full-width rows, animations
node test/test-integration.js 900 fiber           # end to end: read → decide → key events → simulated game
node test/test-integration.js 900 canvas          # the same through the pixel fallback
```

The version printed in the popup, `manifest.json` and `bridge.js` is the same three-part number (currently `1.0.0`), and a release tag must be `v<version>` - the workflow refuses a tag that disagrees, so the extension and the userscript can never drift apart.
