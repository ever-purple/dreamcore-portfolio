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
   | 线圈本 | Thinking / Process | 实习与思考 |
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

## 已知未完成

- `src/lib/contentApi.ts` 仍是**内存 mock**：留言板 / 灵感收藏的增删**刷新即丢**。
  它是刻意收口出来的读写边界，接后端（Supabase / Vercel Blob / 自建 API）只需改这一个文件，组件不用动。
- `src/components/StudioCursor.tsx` 已不再挂载（工作室改用系统光标），文件保留备用。
- 全屏菜单除 About Me 之外 4 项尚未接页面。
- 字体走 Google Fonts CDN（见 `index.html`）；网络受限环境下会回退到系统字体，排版观感会有差异。
