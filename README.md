# Dreamcore Portfolio

一个以「2003 年夏天的遗落工作室」为世界观的个人作品集。网站同时提供沉浸式探索版与便于招聘方快速浏览的 Quick View，并用 L.I.S.A. 异世界系统回答与站内经历、作品和创作档案有关的问题。

## 访问地址

| 地址 | 当前用途 |
|---|---|
| [portfolio-ten-blush-61.vercel.app](https://portfolio-ten-blush-61.vercel.app/) | 审核期间使用的临时地址；部分网络环境下使用 VPN 访问更快 |
| [www.everpurple.top](https://www.everpurple.top/) | 正式域名；备案审核期间暂时停用，审核完成后恢复 |

两个地址指向同一套网站代码。访客、留言和 L.I.S.A. 问答数据按各自部署环境读取，本地管理中心可以在两个站点之间切换。

## 浏览路线

### 探索版

`Loading → Hero → OPEN → 工作室`

工作室中的物件是主要入口：

| 入口 | 内容 |
|---|---|
| 电脑 | About Me / Green OS：自我介绍、职业愿景、灵感收藏和留言 |
| 线圈本 | 实习与项目经历 |
| 旋转木马 | 策划案与完整项目详情 |
| 报刊架 | 横屏视频、竖屏视频与 AI 视频 |
| L.I.S.A. | 根据站内知识库回答访客问题 |

导航还可以直接进入作品、Creative Lab、联系页并下载简历。3D 场景和较大的媒体资源按浏览路径及悬停行为加载，避免首页与 Quick View 同时争抢带宽。

### 快速浏览版

通过首页入口或 `?quick=1` 打开。单页依次展示：

1. 关于我
2. 经历
3. 作品：策划案、视频、文案
4. 联系方式

快速版与探索版共享项目资料。策划案可从快速版进入完整详情页，返回时会回到快速版作品区域；文案直接在当前页面展示。

## L.I.S.A. 问答系统

L.I.S.A. 是工作室里的异世界系统，后端使用硅基流动的 Qwen 模型。它只根据代码中的网站知识库回答经历、作品、能力与站点浏览相关问题，不虚构网站之外的信息。

- 单次提问最长 240 字，回答最长 360 字
- 每位访客每分钟最多提问 6 次
- 问答记录最多保留 100 条
- 不保存访客 IP
- API Key 只存于部署平台或服务器环境变量，不进入前端与 GitHub

核心实现位于 `api/chat.ts`，界面位于 `src/components/LisaHud.tsx` 与 `src/components/StudioChat.tsx`。

## 数据与本地管理中心

Upstash Redis 用于保存访客数、访问记录、留言、线上灵感收藏数据和 L.I.S.A. 问答记录。访问记录支持 `?from=公司名` 来源标记，并记录浏览板块、停留时间与简历下载事件。

本地管理中心位于 `dashboard/`，仅供作者在自己的电脑上使用，不作为公开网页部署。它包含：

- 临时站点 / 正式站点切换
- L.I.S.A. 问答、访问记录与留言查看
- 带公司来源标记的专属作品集链接生成器
- 部署状态、环境变量检查与数据导出
- 作者模式说明和内容修改地图

首次使用时复制 `dashboard/config.example.json` 为 `dashboard/config.json` 并填写本地配置。`dashboard/config.json` 已被 Git 忽略，禁止提交密钥。

## 技术栈

- Vite 7、React 19、TypeScript
- GSAP、Lenis
- Three.js
- Tailwind CSS 3
- Vercel Functions / Node Server
- Upstash Redis
- 硅基流动 + Qwen

## 本地运行

需要 Node.js `>= 20.19`。

```bash
npm install
npm run dev
```

常用检查：

```bash
npm run build       # 素材检查、类型检查与生产构建
npm run test:api    # 后端接口回归测试
npm run preview     # 本地预览生产构建
```

## 环境变量

真实密钥只配置在 Vercel、服务器的 `.env.production` 或本机未提交的配置中。

| 变量 | 用途 |
|---|---|
| `ADMIN_KEY` | 作者模式与管理接口口令 |
| `SILICONFLOW_API_KEY` | L.I.S.A. 的硅基流动密钥 |
| `SILICONFLOW_MODEL` | L.I.S.A. 使用的 Qwen 模型，默认 `Qwen/Qwen2.5-7B-Instruct` |
| `KV_REST_API_URL` | Upstash Redis REST 地址 |
| `KV_REST_API_TOKEN` | Upstash Redis REST Token |
| `VITE_CONTENT_API` | 可选的线上灵感收藏接口 |
| `VITE_SITE_URL` | 构建分享卡时使用的正式站点地址 |

`UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 也受到兼容支持。参考 `.env.example`，不要提交 `.env`、`.env.production` 或任何真实 Key。

## 内容维护

| 内容 | 文件或位置 |
|---|---|
| 策划案与项目详情 | `src/data/works.ts`、`src/data/work-pages.ts` |
| 快速版项目内容 | `src/data/copyProjects.ts` |
| About Me | `src/data/about.ts` 与 About 组件 |
| 工作室物件配置 | `src/data/studio.ts` |
| 灵感收藏 | 作者模式中的网页编辑器 |
| L.I.S.A. 知识与回答规则 | `api/chat.ts` |
| Loading 文案与视觉 | `src/components/LoadingScreen.tsx` |

作者模式的线上身份由服务端校验。灵感收藏在本地开发时写入项目文件；线上配置内容接口后写入远端，否则仅保存在当前浏览器。

## 加载策略

网站不会在进入首页时一次下载全部资源：

1. 首页先加载能显示首屏与开始滚动所需的少量序列帧。
2. 首页稳定后在后台接力加载 Quick View 首屏，再准备探索版首屏和 About 轻量资源。
3. 桌面与移动端通过 `<picture>` 只下载当前设备需要的图片。
4. GLB、作品详情和大媒体文件随实际入口或悬停加载。
5. 页面内部加载统一使用薄荷绿像素呼吸提示，避免出现空白或闪屏。
6. 开启省流模式或处于慢速网络时跳过不必要的后台大文件预载。

首页 Loading 使用当前定稿的像素裂缝与交错呼吸方块方案；测试参数仅用于开发预览，不属于正式浏览流程。

## 部署

### Vercel

连接 GitHub 仓库后使用：

- Build Command：`npm run build`
- Output Directory：`dist`
- Node.js：`>= 20.19`

每次推送到部署分支后由 Vercel 自动构建。需要在项目环境变量中配置 `ADMIN_KEY`、硅基流动和 Upstash 相关变量。

### 国内服务器

项目也保留 GitHub 推送后自动部署到国内服务器的迁移方案。服务器端运行入口与部署脚本位于 `server.mjs`、`scripts/server/` 和 `.github/workflows/`；备案完成前继续使用临时 Vercel 地址。

## 项目结构

```text
api/                 Vercel Serverless 接口
dashboard/           仅本地使用的网站管理中心
docs/                部署、备案和维护文档
public/              图片、字体、音频、视频和 GLB 素材
scripts/             素材检查、压缩、字体与部署脚本
src/components/      页面、弹层、3D 与交互组件
src/data/            作品和站点内容数据
src/lib/             存储、访问记录、音频与场景工具
src/sections/        首页和工作室主场景
```

## 隐私与安全

- 不把任何 API Key、管理口令或本地 `dashboard/config.json` 提交到仓库。
- L.I.S.A. 问答记录不保存 IP。
- 访问统计用于了解作品集浏览情况，不做广告追踪。
- 作者编辑入口由服务端口令保护，生产环境默认访客只读。

