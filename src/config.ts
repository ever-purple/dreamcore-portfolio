/**
 * 站点级开关。
 *
 * IS_ADMIN —— 权限隔离的总开关，控制「上传框 / 删除按钮」这类编辑入口是否渲染。
 *
 * 取值优先级（从高到低）：
 *   1. URL 参数   ?admin=1 强制开 / ?admin=0 强制关
 *                 —— 不改代码就能切模式，方便自己调试，也方便给面试官一个纯只读链接
 *   2. 环境变量   VITE_AUTHOR_MODE=true|false（构建期决定，见 .env.example）
 *   3. 兜底默认   开发环境开、生产构建关
 *
 * ⚠️ 上线安全约定：`npm run build` 产出的是生产构建，第 3 条会自动把编辑入口关掉，
 *    所以直接把 dist/ 部署出去就是「访客只读」，无需任何额外配置。
 *    本地想在预览产物里检查编辑 UI：`npm run preview` 之后访问 `?admin=1`。
 */
const envAdmin = import.meta.env.VITE_AUTHOR_MODE;
const urlAdmin = new URLSearchParams(window.location.search).get('admin');

export const IS_ADMIN: boolean =
  urlAdmin !== null
    ? urlAdmin !== '0'
    : envAdmin !== undefined
      ? envAdmin === 'true'
      : import.meta.env.DEV;
