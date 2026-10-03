# Dreamcore Portfolio

一个梦核（dreamcore）风格的个人作品集网站：加载页 → 滚动驱动的首页 →沉浸式工作室 → Green OS 桌面版 About Me。

另有一套**快速浏览版（Quick View）**：单页纵向叙事，把「我是谁 / 做过什么 / 作品 / 怎么找我」压进一屏到底的滚动长页，用 `?quick` 直达。

**技术栈：** Vite 7 · React 19 · TypeScript · Tailwind CSS 3 · GSAP 3 · Lenis（平滑滚动）· Three.js（3D 桌宠）

---

## 两个入口

| | 探索版（主站） | 快速浏览版 |
|---|---|---|
| 入口 | 正常流程：加载页 → 首页滚动 → OPEN | `?quick` 直达，跳过加载页 |
| 结构 | 多屏多场景，逐个进入 | **单页 4 段**，滚动到底 |
| 适合 | 深度浏览、沉浸体验 | 面试官 30 秒扫完、简历附件式分享 |
| 素材 | 120 张滚动序列帧 + 循环视频 + GLB | 纯静态图，无序列帧、无视频 |

两套UI 完全独立（`src/quick-view.css` + `src/meadow-v2.css`，共约 200 KB），
互不共享样式作用域 —— 改快速版不会碰到主站，反之亦然。

---

## 快速浏览版（`?quick`）

4 个板块，单页滚动：

| # | 板块 | 内容 |
|---|---|---|
| 01 | 关于我 | ID 卡（姓名/年龄/能力标签）+ 头像线稿 |
| 02 | 实习与项目经历 | 手绘小猫图，节点可点，展开经历详情 |
| 03 | 精选作品 | 策划案 / 视频 / 文案三章，**仅列片名**，视频在探索版播放 |
| 04 | 联系 | 邮箱、下载简历、进入探索版 |

- 末尾的 `ENTER EXPLORE` 会带着当前上下文跳回探索版对应位置。
- 作品正文在 `src/data/copyProjects.ts`，改文案不用碰组件。

## 体验流程

1. **加载页** — 酒红（`#550507`）背景，右下角粗体 `0 → 100%`，严格 3 秒走完，随后淡出进入首页。
2. **首页（滚动驱动）** — 300vh 滚动映射到 120 张预渲染帧，绘制在 sticky canvas 上（不自动播放、上滚回退、到 100% 锁住不再下滚）。
   - `Portfolio` 文字（Jheri Curls，`#76F0CA`）在滚动约 10% 淡入、`OPEN` 出现前淡出。
   - 滚动到 90% 时门中央弹出 `OPEN` 按钮，伴随一次门铃（`public/bell.mp3`）。
3. **工作室** — 背景是循环视频 `public/studio/studio-loop.mp4`，其上叠了 4 个圆形感应区：

   | 物件 | 按钮名 | 内容 |
   |---|---|---|
   | 电脑屏幕 | About Me | 个人信息 |
   | 线圈本 | Thinking / Process | 实习日记 |
   | 旋转木马 | Works | 策划项目 |
   | 报刊架 | Creative Lab | 视频与 AI 作品 |

   鼠标靠近感应区 → 薄荷绿脉冲点淡出、原地弹出点击按钮。右上角是 `MY STUDIO`（返回首页）与 `MENU`（全屏菜单）。
   工作室内还有背景音乐（`public/studio/studio-music.mp3`）和一只可拖拽的 3D 桌宠（`public/about/mascot.glb`）。

   > 4 个感应区坐标不是估的：把 `studio-loop` 的画帧画到 canvas 上逐点读亮度标定出来的，
   > 原因见 `src/data/studio.ts` 的注释 —— 镜头会放大 12 倍，错 1% 终点就偏 12% 视口宽。
4. **About Me / Green OS** — 点电脑会「镜头扎进屏幕」，随后进入 Win95 风格的 `ABOUT_ME.EXE` 桌面，含 4 个板块：**自我介绍 / 职业愿景 / 灵感收藏 / 留言板**。
   - **也可以从 `MENU → About Me` 直达桌面**，跳过镜头推进、过曝白光与开机自检。URL 会写成 `?greenos=1&direct=1#about`，刷新后依然跳过 —— 方便面试官直接看信息。

> 全屏菜单共 5 项，目前只有 **About Me** 接了落地页；`Works / Creative Lab / Contact / Resume` 仍是占位。

## 本地运行

```bash
npm install      # 需要 Node >= 20.19（已锁 package-lock.json，可复现）
npm run dev      # 开发服务器
npm run build    # 类型检查 + 生产构建到 dist/
npm run preview  # 预览构建产物
```

## 站点开关（作者模式）

`IS_ADMIN`（`src/config.ts`）控制「上传框 / 删除按钮」这类编辑入口是否渲染。
优先级从高到低：**URL 参数 > 环境变量 > 默认值（开发环境开、生产构建关）**。

```bash
npm run dev                          # 本地默认【开】，方便直接改内容
VITE_AUTHOR_MODE=false npm run dev   # 本地也切成访客只读
```

- 生产构建默认关闭 → **直接把 `dist/` 部署出去就是访客只读**，不需要额外配置。
- 需要临时覆盖时改 URL 即可：`?admin=0` 强制只读、`?admin=1` 强制开启（不用重新构建）。
- 可用变量见 `.env.example`，复制成 `.env` 才生效（`.env` 已在 gitignore）。

## 改内容：在网站上直接编辑（不用写代码）

进入 `About Me → 灵感收藏`，作者模式下每个分类都有新增 / 编辑 / 删除入口，
**改完刷新就还在，不需要动任何源码文件**。

> 六个分类现在是**空的**（`src/data/inspiration.ts` 里的种子数组已清空 ——
> 之前那批是占位素材，留着会让人误以为内容已经填好了）。直接从零录入真实内容即可。

```bash
npm run dev      # 用这个跑，编辑能力才是完整的
```

打开后：`?admin=1` 是作者模式，`?admin=0` 是访客只读（本地默认已经是作者模式）。

### 三个入口怎么选

| 想放什么 | 用哪个入口 | 会自动拿到什么 |
|---|---|---|
| 别人的案例 / 文章链接 | **粘贴链接添加** | 标题、封面（自动识别）；识别不到可以自己上传封面 |
| AI 项目（一般是 GitHub 开源仓库） | **新增项目 → 粘仓库链接** | 仓库名、简介、topics 当标签、官方 social preview 图、★star 数 |
| 音乐（网易云 / QQ音乐 / Spotify） | **粘贴音乐链接** | 歌名、歌手、封面、平台外链播放器 |
| 自己手里的图 / 音频文件 | **拖拽上传 / 上传歌曲** | 图片直接上传；音频会读 ID3 标签补歌名歌手封面 |

### 加错了不用删：每张卡都能就地改

作者模式下每张卡右上角都有 **✎**，点开就能改这条的**全部**字段，包括封面 ——
换图直接粘一张新的就行，不用删掉重传（删了还得重新识别一遍）。

| 分类 | ✎ 里能改 |
|---|---|
| 案例 / 知识 | 标题、跳转链接、标签、封面 |
| AI 项目 | 名称、简介、标签、链接、封面 |
| AI 技能 | 图标、名称、描述、链接 |
| 音乐 | 歌名、歌手、曲风、封面、原链接 |
| 视觉 | 标题、角标、图片本身、原链接 |

封面那栏留空 = **不换图**（避免手滑清空）；想换就直接 Ctrl/⌘+V 粘一张新的。

### 封面怎么放：直接 Ctrl/⌘+V

所有封面字段都支持**粘贴**，不用先存成文件：

1. 在别的网站右键图片 → **复制图片**（或从微信 / QQ / 系统截图工具复制）；
2. 回到本站，点一下封面输入框；
3. **Ctrl / ⌘ + V** —— 图片自动上传到 `public/insp/media/`，地址填进字段，下面立刻出预览。

三种剪贴板内容都认：图片**文件**（复制图片 / 截图）、图片**地址**（复制图片链接）、
网页里复制的 `<img>`（抠出 src 用）。把图片直接**拖**进封面区也行。
粘贴的不是图片（比如一段普通文字）则原样放行，不打断你正常编辑。

### 音乐为什么不上传 mp3

**版权 + 体积**：本站不落任何音频文件，只存平台链接与外链播放器地址，
音频永远由平台自己放。VIP / 付费歌曲在站外本就只能听到可试听的那一段，
由平台规则决定 —— 行为与官方一致，不用我们自己做裁剪。
（真要放自己录的音频，用「上传歌曲」，那会进 `public/insp/media/`。）

### 改动存在哪

作者面板顶部会实时显示。三选一，**自动探测，不需要配置**：

| 显示 | 落在哪 | 什么时候用 |
|---|---|---|
| 存于：**项目文件** | `public/insp/data.json` + `public/insp/media/` | `npm run dev` 时。刷新、换浏览器、重新构建部署都带着走 ✅ 推荐 |
| 存于：**远端后端** | 配了 `VITE_CONTENT_API` 的那个接口 | 上线后想在后端改内容 |
| 存于：**仅本浏览器** | localStorage + IndexedDB | 看构建产物 / 线上没配后端时，换设备就没了 |

面板上还有 **导出 JSON / 导入 JSON / 清空全部 / 恢复默认** 四个按钮：
「清空全部」一次清掉六个分类；导出那份 JSON 可以直接贴到自己的后端里。

### 接自己的后端

```bash
# .env
VITE_CONTENT_API=https://your-api.example.com/insp
VITE_AUTHOR_KEY=你自己约定的密钥      # 会作为 x-author-key 请求头带上
```

接口只要满足三个约定就行：

```
GET  {base}         → { "savedAt": 123, "store": { "vision": [...], "music": [...] } }
PUT  {base}         → body 同上，整份保存
POST {base}/upload  → multipart/form-data，字段 file，返回 { "url": "https://..." }
```

### 链接识别的原理

浏览器直连目标页会被 CORS 拦，所以：

1. **本地 dev 走服务端通道** `/__studio/link-meta`（`link-meta.ts`）—— 没有同源限制，
   还能直接调网易云 / QQ音乐 / GitHub 的官方接口，比 og 标签准得多；
2. **线上走同一份逻辑的 serverless 版** `/api/link-meta`（`api/link-meta.ts`）——
   部署后也具备平台级识别能力。该文件里那段实现是构建时从 `link-meta.ts` 同步过去的
   （`npm run sync:link-meta`，已挂在 `npm run build` 最前面），**改识别逻辑只改 `link-meta.ts`**；
   之所以不直接 import，是因为 Vercel 对 `/api` 下的函数按文件独立转译，跨文件 import 有过
   解析不到且无日志的先例（见 `api/visit.ts` 顶部注释）；
3. 两个服务端通道都拿不到东西时，回退 microlink → allorigins 抓 og 标签 → 从 URL 推断标题 + 稳定占位封面；
4. 无论哪一级成功，标题 / 封面 / 播放器地址都能手动改；**已经存下的条目**可以在卡片上点
   「✎ 编辑 → 🔍 重新识别」就地修好，不用删掉重加。

> **分享短链**（`https://163cn.tv/xxxxx`）本身不含 song id。服务端会先逐跳跟随重定向还原出
> 真实地址，再拿 id 调平台接口 —— 少了这一步，识别结果会退化成短码：歌名变成 `Bhr5rXOI`、
> 封面空白、也拿不到外链播放器（点播放没声音）。
> 回归验证：`BASE=http://127.0.0.1:5199 node verify-music-link.mjs`。

## 字体体系

**12 个自托管字族，全部本地托管，不外链 Google Fonts。** 分片在 `public/fonts/sliced/`
（思源宋体 70 片、思源黑体 56 片，按 `unicode-range` 按需下载）。

站点的分配规则写在 `src/index.css` 顶部（**改字体前先读那段注释**）：

| 场景 | 字族 |
|---|---|
| 屏幕内像素字 / 小标签 | Zpix、Cubic11 |
| 屏幕外英文手写 | Caveat |
| 屏幕外中文 display（**标题级，不是正文**） | NanoOldSongA（子集） |
| 中文手写标注 | PF频凡胡涂体 |
| 正文 | 思源黑体 |

> ⚠️ **display 字族不能拿来渲染正文。** NanoOldSongA 的子集只收站点实际用到的字，
> 正文里任何一个子集外的字都会掉回思源宋体 → 一行字里两种字体混排。

###⚠️ 换文案后必须重跑子集脚本

子集是**静态产物**，不会自动跟着文案更新。文案一改就会大面积缺字，表现为
「有的字粗有的字细」或掉回系统字体。三个脚本：

```bash
python scripts/subset-nanooldsong.py   # 标题级中文 display（NanoOldSongA）
python scripts/subset-qihei.py      # 正文（汉仪旗黑）
python scripts/slice-cjk-font.py       # 思源宋体/黑体按 unicode-range 分片
```

`subset-nanooldsong.py` 里的 `add_cjk_from_jsx()` 负责扫**组件里写死的中文**
（JSX 文本），不只是 `src/data/*.ts` 的字符串字面量 —— 只扫字面量会漏掉
组件内硬编码的所有中文，这是之前踩过的坑。

验证子集是否够用：

```bash
python scripts/check-font-subset.py     # 扫出站点用字 vs 子集字形的差集
python scripts/verify-font-slices.py    # 验分片是否完整
```

### 已知的字体硬约束

- **PF频凡胡涂体没有「晨」「龄」「载」**。线上 ttf、`D:\字体` 里的副本、原始压缩包、
  历史备份四份文件 md5 完全一致（`7285c810…`，4901 字形仅 4347 有编码），
  没有 U+6668 / U+9F84 / U+8F7D；另有 566 个「有轮廓没编码」的字形渲染出来
  全部是希腊文 / 西里尔文 / 日文假名，**一个汉字都没有**。
  → ID 卡姓名、年龄、「下载简历」这些位置改用NanoOldSongA，不要改回胡涂体。
- **不要引入站点没用过的新字族**，也不要用非站点字族（`Georgia` / `Arial` 等）
  渲染内容 —— 它们不托管在站内，会掉系统字体，在不同机器上表现不一致。
- 装饰符号（★ ☆ · ↗ ↓）已确认在 NanoOldSongA 子集内。`✦` `✧` 不在任何字族里，
  已全部换成 ★ ☆。

---

## 目录结构

```
dreamcore-loader-home/
├─ index.html
├─ vite.config.ts              # @/* 别名；base: './'
├─ tailwind.config.js# wine / cream / jheri 等自定义主题
├─ postcss.config.js
├─ tsconfig*.json
├─ .env.example                # 站点开关的可用变量
├─ package.json / package-lock.json
├─ scripts/                    # 素材与字体工具（见下）
├─ api/                        # Vercel serverless：留言、访问日志、链接识别
├─ public/
│  ├─ bell.mp3                 # 首页 OPEN 的门铃
│  ├─ frames/                  # 首页滚动序列帧 0001–0120.jpg（120 张，已入库）
│  ├─ fonts/                   # 12 个自托管字族+ sliced/ 分片
│  ├─ studio/                  # studio-loop.mp4 循环视频 + poster + 背景音乐
│  ├─ quick-view/              # 快速版：ID 卡线稿、4 个空间图标、撕纸效果
│  ├─ quick-view-v2/           # 快速版：超现实桌面 / 草甸世界图层
│  ├─ works/                   # 作品分章图（chiwei / guanxia / kuaike / shenzhou）
│  ├─ journal/                 # 日记页素材（贴纸 / 胶带 / 拍立得边框等）
│  └─ about/                   # 头像 / 横幅 / 底纹 / ascii-art.txt / mascot.glb
└─ src/
   ├─ main.tsx
   ├─ App.tsx                  # Lenis + 加载页 → 首页 → 工作室 / 快速版的编排
   ├─ config.ts                # IS_ADMIN 站点开关
   ├─ index.css / App.css     # index.css 顶部是字体分配规则
   ├─ quick-view.css           # 快速版基础样式
   ├─ meadow-v2.css            # 快速版草甸主题（在 quick-view.css 之后加载）
   ├─ styles/fonts-sliced.css# 思源宋体 / 黑体的 unicode-range 分片声明
   ├─ context/                 # AdminContext（作者模式）、PlayerContext（播放器）
   ├─ data/                    # studio.ts（4 个物件）、about.ts、inspiration.ts
   │                           # copyProjects.ts（快速版作品文案）
   ├─ lib/                     # contentApi（内容读写边界）、crtAudio、pixelCursor…
   ├─ sections/                # HomeSection、StudioSection
   └─ components/              # LoadingScreen、ObjectZone、StudioMenu、NotebookOverlay、
                               # AboutOverlay + About*（4 个板块）、GreenOs、MascotViewer、
                               # QuickViewShell（快速版）、ExploreChoice、TornPaperReveal …
```

> **快速版的开发副本在 `_quickview_v2_meadow_preview/`**（已 gitignore）——
> 那是带自己 `package.json` / `node_modules` 的完整独立站，只作试验场。
> **改动必须同步回上面的 `src/` 才算数**，否则推GitHub 上去的还是旧版。
> 用 md5 逐文件比对同步，别整目录盲拷。

## 常用脚本

除字体脚本外，常用的还有：

```bash
python scripts/extract_frames.py    # 源视频 → 滚动序列帧
python scripts/images-to-webp.py    # 批量图片转 webp
python scripts/media-compress.py    # 视频压制
node   scripts/compress-glb.mjs     # GLB 压缩到能进网页的体积
node   scripts/check-assets.mjs     # 素材引用完整性检查（已挂在 build 最前）
node   scripts/verify-mode.mjs      # 各预览模式冒烟
```

`npm run build` 的顺序是 `sync:link-meta → check:assets → tsc -b → vite build`，
类型不过就不出包。

## 素材说明

`public/frames/`（120 张，约 64 MB）**已提交进仓库**，克隆后开箱即可看到滚动动画，无需额外步骤。

如需自行重新生成（例如换了源视频）：

```bash
pip install "imageio[ffmpeg]" Pillow
python scripts/extract_frames.py "<源视频>.mp4" public/frames 120 --width 2560 --quality 95
```

## 部署

产物是 `dist/` 下的纯静态站点（无服务端），任何静态托管都能放：

```bash
npm run build
```

- **Vercel / Netlify / Cloudflare Pages**：直接连仓库即可。Build Command `npm run build`，Output Directory `dist`，Node ≥ 20.19。
- ⚠️ **GitHub Pages 不支持子路径部署**：代码里有 47 处**运行时绝对路径**（`/frames/…`、`/about/…`、`/studio/…`）。
  `vite.config.ts` 的 `base: './'` 只重写打包产物里的引用，管不到这些字符串常量 ——
  放到 `https://<user>.github.io/dreamcore-portfolio/` 会整站 404。要用 Pages 必须先把它们改成相对路径或加上前缀。
- 仓库当前是 **private**：GitHub Pages 对私有库需要付费计划；上面三家平台连私有库没问题。

## 已知未完成 / 上线前清单

- **移动端适配**：全站按桌面视口做的，窄屏只有零星 `@media (max-width:900px)` 兜底，
  首页滚动帧、工作室 3D 感应区、Green OS 三栏、快速版 4 段都没正经适配。
- **产物体积**：`dist/` 现在约 **560MB** —— `public/media/` 306MB（单个视频最大 73MB）、
  `public/frames/` 64MB（120 张序列帧，每张 350–600KB）、`public/works/` 101MB。
  静态托管普遍有单文件 / 总容量上限，上线前必须压。
  另：`public/fonts/PFHuTu.ttf` 整份 5.1 MB，但快速版只用到它 4347 字形里的 67 个。
- **首屏等待**：进入首页要求 120 帧**全部**加载完（`ready` 才放行），慢网下会长时间卡在加载页。
- **作者模式可被 URL 打开**：`?admin=1` 优先级最高，线上任何人加这个参数都会看到编辑入口。
  改动只落在他自己浏览器（不影响别人），但 `VITE_CONTENT_API` 一旦配上就会改到共享后端。
- **无 SEO / 分享卡片**：`index.html` 只有 title，没有 description / og:image，
  链接贴到微信、飞书、Twitter 里是一块空白。
- **留言板 / 访客计数**仍是本地 localStorage：访客看不到别人的留言，计数也只是自己刷新 +1。
- **快速版的 Contact 导语对比度 2.64:1**，是全页唯一不及格的文字。
  试过三种方案全被否（径向黑蒙版实测无效 / 深色玻璃片被否 / text-shadow 被禁），
  维持原样。真要修只能动它下方的世界照或加深该处 scrim。
- **快速版只列片名**，视频仍需跳到探索版播放，两版内容有重叠。
- `src/components/StudioCursor.tsx` 已不再挂载（工作室改用系统光标），文件保留备用。
- 全屏菜单除 About Me 之外 4 项尚未接页面。

