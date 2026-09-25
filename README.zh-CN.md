# ChatGPT 贪吃蛇自动游玩扩展

[English](README.md) · **中文**

Chromium（MV3）扩展：ChatGPT 生成图片时页面会出现等待用贪吃蛇，扩展负责识别棋盘并自动操作，同时提供可切换的策略、实时识别面板和五语言界面。

## 安装

1. 打开 `chrome://extensions`（或 Edge 等 Chromium 浏览器的扩展页）。
2. 打开「开发者模式」，点击「加载已解压的扩展程序」。
3. 选择本文件夹，然后刷新 ChatGPT 页面。
4. 点击扩展图标：弹窗里有四样东西——**自动游玩**开关、**显示面板**开关（就在自动游玩下面）、**策略**下拉和**语言**下拉；底部显示当前版本号（与 `manifest.json` 完全一致，例如 `Version 1.0.0`）。两个开关都会写进 `chrome.storage.sync` 与 `chrome.storage.local`（各带 `savedAt` 时间戳，读取时取较新的一份），所以页面刷新、浏览器重启后依然保持；即使某个存储区写失败，另一个也还在。轮询间隔不可调，固定 50ms（游戏每步 95–190ms，50ms 足够提前排好下一步方向）。
5. 游戏出现时页面右侧出现识别面板，实时显示识别到的网格、蛇长、蛇头、食物、方向、决策依据与**规划路线**；预览图里的蓝色虚线就是算法打算走的路。整个面板由弹窗里的「显示面板」一个开关控制，关掉后面板整块隐藏（读取与决策照常进行）。
6. 代码有更新后，需要在 `chrome://extensions` 里对本扩展点一次「重新加载」（只刷新 ChatGPT 页面不够），再刷新页面。

### 界面语言

弹窗里的**语言**下拉可以在 **English / 中文 / Français / Русский / Español** 之间切换，默认 **English**。语言和开关存在同一份配置里（`lang` 字段，同样双区持久化 + `savedAt`），所以重开浏览器后还是上次选的那一种。

- 切换后弹窗里的标签、状态行、版本行立刻跟着变，**页面右侧面板也会整块重建**成新语言（面板的静态标签只在创建时写一次，所以 `content.js` 在语言变化时销毁旧面板再建一个，不会留下两个）。
- 五种语言各自带 45 个界面词条和 4 个方向名（`i18n.js`，`window.SnakeI18n`），语言 id 不认识时回落到英语。
- **控制台日志始终是英语**（方便对着本文档和代码搜索），只有界面跟着语言走。

## 识别方式（三层，从准到糙）

1. **React Fiber（主路径）**：`bridge.js` 在 MAIN world 里顺着 React 给每个 DOM 节点挂的 `__reactFiber$…` / `__reactInternalInstance$…` 属性（`bridge.js:48`）遍历 fiber 树，找到游戏组件的 `{type, state}` ref，直接读 `columns/rows/segments/food/direction/queuedDirection/score/gameOver`。`segments[0]` 是蛇头，索引 `i` 对应 `col = i % columns, row = Math.floor(i / columns)`。这是精确状态，不依赖像素。它每 40ms 轮询一次（游戏最快 95ms 一步，轮询必须明显更快），并把 `queuedDirection` 一起报上来。
2. **Canvas 像素（降级路径）**：`vision.js` 读取游戏 canvas（跳过页面保留的隐藏备用 canvas），先测点阵间距（cellSize / offset），再提取蓝色 blob，按画布的 taper（蛇头最深最大、向尾巴越来越浅越来越小）把 blob 串成蛇身链，并挑出食物。边界环绕（torus）在相邻判定、串联和寻路里都被处理。
3. **运动学方向修正**：canvas 的链序在 taper 饱和时无法分辨头和脖子，`reader.js` 用上一次成功识别的蛇头位置反推朝向（蛇头刚从上一次的位置走进来，那一格就是脖子）。

比像素更可靠的补充规则：

- 链没能覆盖到的 blob（长蛇中段颜色完全相同，链可能漏掉几格）会被当成**墙**传给算法（`obstacles`），避免规划器把身体当成空格撞上去。
- 食物优先取**不贴身体**的 blob；只有当所有候选都贴着身体时才退回「离蛇头最近」（食物确实可能紧贴身体）。
- 亮色 blob 占满棋盘的比例超过一半时直接拒绝（`maxBlobShare = 0.5`）：蛇不可能铺满整个棋盘，这一定是页面自己的背景动画。

## 游戏还没开始时

等待图片生成期间，棋盘元素会一直在页面里，但页面此时在里面画自己的背景动画（铺满整块区域的亮点阵），游戏画布是淡出到 `opacity: 0` 的。扩展对此的处理是：

- **画布选取**：游戏画布是棋盘里的**最后一个** canvas，且必须真的显示（`display/visibility/opacity` 都不隐藏）才算「游戏在场」；否则视为未开始，不读像素、不按空格、不发方向键（否则按键会落到页面上、点阵也会被当成棋盘）。
- 面板状态胶囊显示 `Not started`（中文界面为「未开始」），预览区显示 `The game has not started yet`，依据栏显示 `Waiting for the game to start`。
- 控制台只打印一次 `The game has not started; no keys are sent until its canvas appears.`
- 游戏真正上屏（画布显示出来）后自动恢复识别与自动开局；游戏结束/离开屏幕则回到未开始状态并等待下一次。

## 游戏规则（按页面源码整理，算法就按这些规则写）

- **棋盘**：`columns = max(8, floor(容器宽 / 21))`，`rows = max(10, floor(容器高 / 21))`；绘制时按 `min(width/columns, height/rows)` 等比缩放并居中。
- **初始状态**：蛇长 4、蛇头在棋盘正中、蛇身向左延伸、方向向右；食物在蛇头同一行右边 4 格（越界绕回）。
- **穿墙**：水平/垂直越界都绕到另一边，撞墙不死。
- **碰撞**：`hitSelf = segments.indexOf(next)`，只有 `hitSelf !== -1 && (hitFood || hitSelf < segments.length - 1)` 才结束。也就是说**走进尾巴这一格（最后一节）不算死**——尾巴这一步会移走，而食物永远不会生成在蛇身上，所以这个走法不可能同时吃到食物。算法因此把最后一节当作可进入的格子（只有长度 ≤ 3 时才靠 `tail-escape` 兜底），这修掉了旧启发式「长蛇封尾」造成的「trapped 假死」。占满棋盘（无处生成食物）算胜利。
- **吃食物**：长度 +1、分数 +1；没吃到则头进尾出，长度不变。新食物从所有空格里均匀随机。
- **速度**：`max(95, 190 - 7 * score)` —— 0 分 190ms 一步，每吃一个食物快 7ms，14 分之后封顶 95ms。所以自动操作的节奏不能写死：`content.js` 用 `Algorithms.stepIntervalMs(score)` 算出当前一步有多久，并在 Fiber 路径上等游戏消费掉上一次按键（`queuedDirection` 被清空）再发下一次。
- **方向**：一次只能排队一个方向，禁止 180° 反向，同方向忽略；空格暂停/恢复，Esc 退出。

## 策略

- **安全 BFS（默认）**：先找最短路径吃食物，并检查吃完后蛇尾仍可达；否则回到可达空间最大的走法。四个方向都会穿墙环绕。
- **空间评估**：按可达空间排序合法走法，同分时靠近食物。
- **循环路线**：棋盘行数为偶数时走哈密顿环，保证不死；食物在环前方很近时允许短跳。

每次决策都会带上一段**规划路线**（`route`）：用的是到食物的 BFS 路径 / 哈密顿环上的若干步 / 下一格，最长 28 步。它在面板里以蓝色虚线画出来，也在控制台日志里以 `route: N` 出现。

自动操作会等游戏消费掉上一次按键后才发下一次（避免同一 tick 内连转两次），并按固定的 50ms 轮询节流；超时阈值跟着真实步长走（`stepMs + max(120, interval*2)`，`interval` 固定 50），所以蛇越吃越快时扩展不会掉队。

## 控制台日志

内容脚本在 ChatGPT 页面的 DevTools 控制台打印 `[Snake Autoplay]` 前缀的日志：画板出现/消失、识别成功（含 grid/snake/head/food/direction）、识别失败原因、自动决策（含依据、算法、`stepMs` 与 `route`）、手动/自动按键。这些日志**始终是英语**，与界面语言无关。重复的相同失败与未变化状态会自动去重。页面上 `Canvas2D: Multiple readback operations using getImageData...` 是 ChatGPT 自己先创建了 2D 上下文导致的性能提示，扩展无法消除，不影响功能。

## 独立测试

需要 Node.js（无需浏览器）：

```sh
node test/test-algorithms.js        # 算法：环覆盖/相邻、不反向、跨边界 BFS、三种策略各 4000 步不死
node test/test-recognition.js       # 像素识别：穿墙蛇尾、短蛇、纵向穿墙、无点阵、背景动画点阵必须被拒绝
node test/test-real-board.js        # 用真实截图夹具 real-board.rgba 跑识别
node test/test-bridge.js            # React 桥：fiber 查找、快照去重、轮询与心跳
node test/test-i18n.js              # 五语言词条：键集一致、占位符、回落、方向名、决策依据全有翻译
node test/test-popup.js             # 弹窗：版本号与 manifest 一致、两个开关永久化、语言切换即时生效
node test/test-build.js             # 打包：商店 zip、Firefox manifest、可重现归档、油猴元数据/模块顺序、CRX 签名往返与篡改检测、校验和、tag 守卫
node test/test-userscript.js        # 油猴 bundle 在没有 chrome.* 的页面里能跑：垫片、存储、面板重建、面板内语言选择器
node test/test-integration.js 900 fiber   # 无头集成：React 桥 → 决策 → 真实按键 → 模拟游戏
node test/test-integration.js 900 canvas  # 无头集成：像素识别降级路径
```

集成测试用假 DOM/chrome 垫片加载扩展的真实脚本，模拟 17×15 环面贪吃蛇，并逐 tick 用真值校验识别结果（网格/蛇头/食物/方向/身体覆盖），同时验证「游戏没上屏时不动作」「弹窗的显示面板开关真的整块隐藏面板」「切换语言后面板整块重建且页面上只剩一个面板」。

在 PowerShell 里跑测试要把输出重定向到文件再读（`Start-Process -FilePath node -ArgumentList 'test/test-integration.js','900','canvas' -RedirectStandardOutput temp\canvas-run.txt -NoNewWindow -Wait`），直接用 `>` 或管道会被环境的输出编码限制挡住。

## 打包与发布

`scripts/build.js` 用**零依赖**（只用 Node 标准库，仓库里没有 `package.json`，什么都不用装）产出全部安装包：

```sh
node scripts/build.js                            # 全部产出到 dist/
node scripts/build.js --check-tag v1.0.0         # 顺便校验 tag 与 manifest.json 是否一致
node scripts/build.js --key-env CRX_PRIVATE_KEY  # 额外签一个 .crx（PEM 或 base64 的 PEM）
```

`dist/` 里的东西：

| 产物 | 用途 |
| --- | --- |
| `snake-autoplay-<版本>-chrome.zip` 和 `snake-autoplay-chrome.zip` | Chrome 应用商店与 Microsoft Edge 加载项的上传包（稳定文件名是 workflow 和文档里引用的那个） |
| `snake-autoplay-<版本>-firefox.zip` 和 `snake-autoplay-firefox.zip` | Mozilla Add-ons（AMO）上传包；里面的 manifest 多了 `browser_specific_settings.gecko`，`strict_min_version: "128.0"`（声明式 content script 支持 `world: "MAIN"` 的第一个 Firefox 版本） |
| `snake-autoplay-<版本>.user.js` 和 `snake-autoplay.user.js` | 油猴（Tampermonkey / Violentmonkey）脚本；稳定文件名就是脚本里 `@updateURL` 指向的地址，所以装过的副本能从最新 release 自动更新 |
| `snake-autoplay-<版本>.crx` | 只有传了签名密钥才有 |
| `chrome/`、`firefox/` | 解包目录，分别用于 `chrome://extensions` 的「加载已解压的扩展程序」和 `about:debugging` 的「临时载入附加组件」 |
| `checksums.txt` | 以上每个产物的 SHA-256 |

- **油猴脚本**：把各模块按 `userscript/` 的顺序拼接（垫片 → algorithms … content → 胶水）。`userscript/00-shims.js` 补齐页面世界没有的 `chrome.storage` / `chrome.runtime`（配置落在页面 `localStorage` 的 `snake-autoplay:config`），`userscript/99-glue.js` 把语言下拉加进页面右侧面板（油猴没有弹窗）。元数据用 `@grant none` 是刻意的：`bridge.js` 必须跑在页面世界才能读到 React fiber。脚本只补缺失的 `chrome.*`、不覆盖已有的，所以同一份 bundle 放到有真实扩展 API 的环境里也照常工作。
- **签 `.crx`**：`scripts/crx3.js` 自己写 CRX3 容器（零依赖：`crypto.sign` + 手写 protobuf 头，由 `test/test-build.js` 验证签名可校验、改一字节即失败）。`CRX_PRIVATE_KEY`（或 `--key <file.pem>`）是 PEM 私钥，例如 `openssl genrsa -out key.pem 2048`，也接受 base64 编码后的 PEM。扩展 ID 是 `SHA-256(公钥)` 按 Chrome 的 `a`–`p` 字母表映射，**换密钥就是换扩展 ID**；而且 Chrome 只安装与商店或企业策略匹配的 `.crx`，所以这个文件是给自己做策略分发用的，其他人用 zip。
- **GitHub Action**（`.github/workflows/release.yml`）：推一个 `v1.0.0` 这样的 tag，它会跑测试、打包、上传 artifact，并创建 GitHub Release 把全部安装包挂上去；PR 和手动触发只打包测试、不发 release。tag 与 `manifest.json` 不一致会直接失败。商店步骤是可选的，对应 secret 不存在就跳过：

| Secret | 作用 |
| --- | --- |
| `CRX_PRIVATE_KEY` | 让 release 多一个签好的 `.crx` |
| `AMO_API_KEY`、`AMO_API_SECRET` | 给 Firefox 签一个 unlisted XPI 并挂到 release（`kewisch/action-web-ext`） |
| `CWS_EXTENSION_ID`、`CWS_CLIENT_ID`、`CWS_CLIENT_SECRET`、`CWS_REFRESH_TOKEN` | 把 zip 作为已存在的 Chrome 应用商店条目的新版本上传（`chrome-webstore-upload-cli`） |
| `EDGE_PRODUCT_ID`、`EDGE_CLIENT_ID`、`EDGE_API_KEY` | 把 zip 作为已存在的 Edge 加载项的新版本上传（`wdzeng/edge-addon`） |

两个商店步骤只能给**已存在**的条目发新版本：先在商店后台手动传一次建条目，再把 id 放进 secret。Chrome 商店只上传、不自动 `publish`（提交审核），是有意为之——不希望某个 tag 悄悄把东西送审。

## 仓库目录约定

- 根目录只放扩展本体（`manifest.json`、各 `*.js` 模块、`popup.*`）和两份 README。
- `scripts/` 放发布构建：`build.js`（打包、manifest、油猴脚本、校验和）、`zip.js`（ZIP 读写）、`crx3.js`（CRX3 签名与校验），只用标准库。
- `userscript/` 只放油猴构建需要的东西：`header.txt`（含 `{{version}}` / `{{author}}` / `{{updateURL}}` 占位符的元数据模板）、`00-shims.js`（`chrome.*` 垫片）、`99-glue.js`（面板内语言选择器）。
- `.github/workflows/release.yml` 负责 tag 触发的打包与发布。
- `test/` 放 Node 测试脚本与它的夹具 `real-board.rgba`；这只是本地开发用的东西，已由 `.gitignore` 排除在仓库之外。如果想让 CI 也跑测试，把 `test/` 提交进仓库（去掉那行忽略），workflow 会自动发现它们。
- `temp/` 放诊断脚本、截图裁剪和测试输出，`dist/` 放构建产物；两者同样被忽略（连同 `.test/`、`.tmp/`、`doc/`、编辑器/代理目录等一起）。

## 已知限制

- 主路径（Fiber）依赖 ChatGPT 内部的 React 结构（组件 props、hook ref 形状）。页面改版可能让它失效，此时自动降级到像素识别。
- 像素降级路径在蛇很长时无法保证逐格正确：渲染的渐变会饱和，多段蛇身画得完全一样，链序在几何上不可分辨（集成测试里 900 tick 内约 5% 的读取会漏 1–6 格，但蛇头/食物/网格始终正确）。因此降级路径按「尽量活久」验收，主路径按「整局不漂移」验收。
- 键盘注入依赖页面继续接受合成键盘事件；画布被污染（tainted）时无法读取像素。

## 版本约定

`manifest.json` 与弹窗显示同一个三段版本号（当前 `1.0.0`）。**每次与用户对话后的交付都把版本号 +1**（`1.0.0` → `1.0.1` → …），改版本时 `manifest.json` 与 `bridge.js` 里的 `VERSION` 一起改（弹窗的回落值也一起改）。release 的 tag 必须是 `v<版本号>`；Release workflow 会拒绝与 `manifest.json` 不一致的 tag，所以 tag、扩展本体和油猴脚本的 `@version` 不会互相漂移。
