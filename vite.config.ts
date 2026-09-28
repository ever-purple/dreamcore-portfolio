import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { studioWriter } from "./studio-writer"

/**
 * 分享卡绝对地址的来源。
 *
 * 社交平台（Facebook / X / LinkedIn）要求 og:image 必须是**绝对地址**，
 * 但本站 base 是 './'、上线域名又由部署平台决定，没法在 index.html 里写死。
 * 于是配了 VITE_SITE_URL（如 https://www.example.com）就在构建时把
 * og:image / twitter:image 换成绝对地址，并把 og:url 指向首页；
 * 没配就保留 index.html 里的相对路径兜底（国内平台与站内 link-meta 都能自己补全）。
 */
const SITE_URL = (process.env.VITE_SITE_URL || '').replace(/\/+$/, '');

/**
 * 分享卡元信息：见 index.html 里「社交分享卡」一段。
 *
 * index.html 里已经把 og:image / og:url 硬编码成 everpurple.top 的绝对地址了
 * （微信/小红书爬虫只认 https:// 开头的绝对地址，相对路径会显示成裸链接）。
 * 这个插件只做一件事：若配置了 VITE_SITE_URL（换域名时），用它覆盖掉硬编码的域名。
 */
const shareCardPlugin = {
  name: 'share-card',
  transformIndexHtml(html: string) {
    if (!SITE_URL) return html; // 没配就用 index.html 里的绝对地址
    return html
      .replace(/https:\/\/www\.everpurple\.top/g, SITE_URL);
  },
};

// https://vite.dev/config/
export default defineConfig({
  base: './',
  // studioWriter 只在 vite dev 下生效：给「作者模式」提供写回源码文件的通道
  // （/__studio/save-work、/__studio/upload）。构建产物里不含任何写入能力。
  plugins: [react(), studioWriter(), shareCardPlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // 默认会扫描项目根下**所有** .html 作为依赖入口。本仓库根目录存在若干临时目录
    // （_edgetmp*/ 是无头浏览器 profile，里面有几百个扩展页面 html），会让扫描失败、
    // 预打包被跳过，并在开发过程中突然出现 "optimized dependencies changed. reloading"
    // —— 表现为"页面自己刷新了"。显式只认 index.html 即可免疫。
    entries: ["index.html"],
    // three 及其 addon 是懒加载的（MascotViewer 才引），不预置会在首次进入工作室时
    // 才触发一次"重新预打包 + 整页刷新"。这里提前声明，dev 启动即优化完毕。
    include: [
      "three",
      "three/addons/loaders/GLTFLoader.js",
      "three/addons/libs/meshopt_decoder.module.js",
      "three/addons/environments/RoomEnvironment.js",
      // 木马策划案用的轨道控制器（同样是懒加载，同样要提前声明）
      "three/addons/controls/OrbitControls.js",
      // 木马装饰件合并几何体用（carousel-ornaments.ts）
      "three/addons/utils/BufferGeometryUtils.js",
      // PDF 首页作为木马相框封面
      "pdfjs-dist",
    ],
  },
  // ⚠️ 端口从 PORT 环境变量读（部署沙箱 / 云平台都靠注入它指定端口）：
  //     直接在 startCmd 里写 `--port $PORT` 不稳 —— 命令不是经 shell 执行的，
  //     `$PORT` 展开成空串，vite 会报 "option `--port <port>` value is missing" 起不来。
  //     读环境变量则由 vite 自己解析，与执行方式无关。本地没设 PORT 就回退 5173。
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 4173,
    allowedHosts: true,
  },
});
