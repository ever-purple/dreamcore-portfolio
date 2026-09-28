/**
 * 站点级开关。
 *
 * IS_ADMIN —— 权限隔离的总开关，控制「上传框 / 删除按钮」这类编辑入口是否渲染。
 *
 * 取值优先级（从高到低）：
 *   1. URL 参数   ?admin=0 强制关（生产也认，方便给面试官一个纯只读链接）
 *                 ?admin=1 只在开发环境认，见下面 urlAdminOverride()
 *   2. 环境变量   VITE_AUTHOR_MODE=true|false（构建期决定，见 .env.example）
 *   3. 兜底默认   开发环境开、生产构建关
 *
 * ⚠️ 上线安全约定：`npm run build` 产出的是生产构建，第 3 条会自动把编辑入口关掉，
 *    所以直接把 dist/ 部署出去就是「访客只读」，无需任何额外配置。
 *    本地想在预览产物里检查编辑 UI：`npm run preview` 之后访问 `?admin=1`。
 *
 * ⚠️ 别在别的组件里再读一次 ?admin=：规则改一次要改两处，迟早不一致。
 *    要覆盖就调 urlAdminOverride()，AdminContext 已经在用它。
 */

const envAdmin = import.meta.env.VITE_AUTHOR_MODE;

/** ?admin= 到底要不要听。返回 null 表示「这轮忽略 URL，继续往下走」 */
export function urlAdminOverride(): boolean | null {
  const v = new URLSearchParams(window.location.search).get('admin');
  if (v === null) return null;
  // ?admin=1 在生产构建里一律不认 —— URL 上带个参数就能开编辑入口，等于没关
  if (v === '0') return false;
  if (v === '1') return import.meta.env.DEV ? true : null;
  return null;
}

export const IS_ADMIN: boolean =
  urlAdminOverride() ??
  (envAdmin !== undefined ? envAdmin === 'true' : import.meta.env.DEV);
