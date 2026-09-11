/// <reference types="vite/client" />

/**
 * 自定义环境变量（构建期由 Vite 注入，见根目录 .env.example）。
 * 只声明实际用到的键，避免 import.meta.env.XXX 退化成 any。
 */
interface ImportMetaEnv {
  /** 'true' 开启作者模式（访客可见上传/删除入口）。生产构建默认关闭，详见 src/config.ts */
  readonly VITE_AUTHOR_MODE?: string;
}
