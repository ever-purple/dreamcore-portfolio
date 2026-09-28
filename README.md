# Dreamcore Portfolio

一个梦核（dreamcore）风格的个人作品集网站：加载页 → 滚动驱动的首页 → 沉浸式工作室 → Green OS 桌面版 About Me。

**技术栈：** Vite 7 · React 19 · TypeScript · Tailwind CSS 3 · Lenis（平滑滚动）· Three.js（3D 桌宠）

---

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
2. 线上没有这个通道时，依次回退 microlink → allorigins 抓 og 标签 → 从 URL 推断标题 + 稳定占位封面。
3. 无论哪一级成功，标题 / 封面 / 标签都能手动改。

## 目录结构

```
dreamcore-loader-home/
├─ index.html
├─ vite.config.ts              # @/* 别名；base: './'
├─ tailwind.config.js          # wine / cream / jheri 等自定义主题
├─ postcss.config.js
├─ tsconfig*.json
├─ .env.example                # 站点开关的可用变量
├─ package.json / package-lock.json
├─ scripts/extract_frames.py   # 从源视频重新生成序列帧
├─ public/
│  ├─ bell.mp3                 # 首页 OPEN 的门铃
│  ├─ frames/                  # 首页滚动序列帧 0001–0120.jpg（120 张，已入库）
│  ├─ fonts/                   # JheriCurls.ttf（首页标题）
│  │                           # Cubic_11.woff2 / zpix.woff2（Green OS 像素字）
│  ├─ studio/                  # studio-loop.mp4 循环视频 + poster + 背景音乐
│  └─ about/                   # 头像 / 横幅 / 底纹 / ascii-art.txt / mascot.glb
└─ src/
   ├─ main.tsx
   ├─ App.tsx                  # Lenis + 加载页 → 首页 → 工作室 的编排
   ├─ config.ts                # IS_ADMIN 站点开关
   ├─ index.css / App.css
   ├─ context/                 # AdminContext（作者模式）、PlayerContext（播放器）
   ├─ data/                    # studio.ts（4 个物件）、about.ts（导航）、inspiration.ts（内容）
   ├─ lib/                     # contentApi（内容读写边界）、crtAudio、pixelCursor、audioTags
   ├─ hooks/useImagePreloader.ts
   ├─ sections/                # HomeSection、StudioSection
   └─ components/              # LoadingScreen、ObjectZone、StudioMenu、NotebookOverlay、
                               # AboutOverlay + About*（4 个板块）、GreenOs、MascotViewer …
```

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
  首页滚动帧、工作室 3D 感应区、Green OS 三栏都没正经适配。
- **产物体积**：`dist/` 现在约 **560MB** —— `public/media/` 306MB（单个视频最大 73MB）、
  `public/frames/` 64MB（120 张序列帧，每张 350–600KB）、`public/works/` 101MB。
  静态托管普遍有单文件 / 总容量上限，上线前必须压。
- **首屏等待**：进入首页要求 120 帧**全部**加载完（`ready` 才放行），慢网下会长时间卡在加载页。
- **作者模式可被 URL 打开**：`?admin=1` 优先级最高，线上任何人加这个参数都会看到编辑入口。
  改动只落在他自己浏览器（不影响别人），但 `VITE_CONTENT_API` 一旦配上就会改到共享后端。
- **无 SEO / 分享卡片**：`index.html` 只有 title，没有 description / og:image，
  链接贴到微信、飞书、Twitter 里是一块空白。
- **留言板 / 访客计数**仍是本地 localStorage：访客看不到别人的留言，计数也只是自己刷新 +1。
- `src/components/StudioCursor.tsx` 已不再挂载（工作室改用系统光标），文件保留备用。
- 全屏菜单除 About Me 之外 4 项尚未接页面。
