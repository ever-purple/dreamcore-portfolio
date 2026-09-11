import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
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
    ],
  },
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
