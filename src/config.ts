/**
 * 站点级开关。
 *
 * IS_ADMIN —— 权限隔离的总开关。
 *   • 本地开发默认「作者模式」(true)：能看到上传框 / 删除按钮，方便改内容。
 *   • 上线时改成从登录态 / 环境变量读取，例如 import.meta.env.VITE_AUTHOR_MODE === 'true'。
 *   • 调试用：链接加 ?admin=0 可临时切到「访客只读模式」，无需改代码。
 */
const envAdmin = import.meta.env.VITE_AUTHOR_MODE;
const urlAdmin = new URLSearchParams(window.location.search).get('admin');

export const IS_ADMIN: boolean =
  urlAdmin !== null
    ? urlAdmin !== '0'
    : envAdmin !== undefined
      ? envAdmin === 'true'
      : true;
