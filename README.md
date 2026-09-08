# Dreamcore · 加载页 + 首页（滚动驱动）

本仓库只含 **加载页（Loading）** 与 **首页（Home / 滚动驱动序列帧）** 两部分代码，房间（OPEN 之后的内容）在完整项目 `app/` 中，不在此处。

**技术栈：** Vite 7 · React 19 · TypeScript · Tailwind CSS 3 · Lenis（平滑滚动）。

## 体验

1. **加载页** — 酒红（`#550507`）背景，右下角粗体 `0 → 100%`，严格 3 秒走完，随后淡出进入首页。
2. **首页（滚动驱动）** — 300vh 滚动映射到 120 张预渲染帧，绘制在 sticky canvas 上（不自动播放、上滚回退、100% 时锁住不再下滚）。
   - `Portfolio` 文字（Jheri Curls，`#76F0CA`）在滚动约 10% 淡入、OPEN 出现前淡出。
   - 滚动到 90% 时门中央弹出 `OPEN` 按钮，并伴随一次门铃（`public/bell.mp3`）。

## 本地运行（任意终端 / agent 环境）

```bash
npm install      # 需要 Node >= 20.19（已附 package-lock.json，可复现）
npm run dev      # 开发服务器
npm run build    # 类型检查 + 生产构建到 dist/
npm run preview  # 预览构建产物
```

> 已锁定 `package-lock.json`，在任意装了 Node ≥ 20.19 的终端执行 `npm install && npm run dev` 即可运行。

## 序列帧（运行时资源，不入库）

首页依赖 `public/frames/0001.jpg … 0120.jpg`（约 64 MB），为可复现的大体积资源，**不纳入 git**。克隆后需自行生成：

```bash
pip install "imageio[ffmpeg]" Pillow
python scripts/extract_frames.py "<源视频>.mp4" public/frames 120 --width 2560 --quality 95
```

未生成帧时页面仍可正常构建/启动（仅滚动区域为黑底，加载页与 OPEN 交互不受影响）。

## 目录结构

```
dreamcore-loader-home/
├─ index.html
├─ vite.config.ts          # 含 @/* 别名解析
├─ tailwind.config.js      # wine / cream / jheri 等自定义主题
├─ postcss.config.js
├─ tsconfig*.json
├─ package.json / package-lock.json
├─ public/
│  ├─ bell.mp3
│  ├─ fonts/JheriCurls.ttf
│  └─ frames/              # 由脚本生成（gitignore）
├─ scripts/extract_frames.py
└─ src/
   ├─ main.tsx
   ├─ App.tsx              # Lenis + 加载页→首页编排
   ├─ App.css
   ├─ index.css
   ├─ vite-env.d.ts
   ├─ components/LoadingScreen.tsx
   ├─ sections/HomeSection.tsx
   └─ hooks/useImagePreloader.ts
```
