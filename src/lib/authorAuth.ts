/**
 * 作者模式的口令校验。
 *
 * 生产构建里作者模式不再「点一下就开」：要点开输入框输口令，输对才进。
 * 进了就在 cookie 里记一笔，刷新、换页都还是作者模式；关掉浏览器失效。
 *
 * ⚠️ 说清楚一件事：口令写在前端代码里，懂行的人打开 F12 能翻出来。
 *    这道门防的是「访客随手一点把编辑界面翻出来」，不是防破解。
 *    以后哪天有「只有作者能写」的接口，那边必须再校验一次，别指望前端。
 */

const COOKIE = 'dc_author';
const COOKIE_DAYS = 14;

/** 口令来自 Vercel 环境变量 VITE_AUTHOR_KEY（构建时写进包里） */
export const AUTHOR_KEY = String(import.meta.env.VITE_AUTHOR_KEY ?? '');

/**
 * 隐藏入口：连按同一个键触发，不显示任何按钮。
 * 1.5 秒内连按 5 次 —— 正常访客不会误触，也不占屏幕、不进截图。
 */
export const HOTKEY_KEY = 'm';
export const HOTKEY_TIMES = 5;
export const HOTKEY_WINDOW = 1500;

/**
 * 只有「生产构建 + 配了口令」才启用这道门。
 * 开发环境保持原来的 ?admin=1 习惯，不然自己调试还要先输口令，很烦。
 */
export const GATE_ENABLED = import.meta.env.PROD && AUTHOR_KEY.length > 0;

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

/** 之前输对过口令？（cookie 在，就还是作者） */
export function isUnlocked(): boolean {
  if (!GATE_ENABLED) return true;
  return readCookie(COOKIE) === '1';
}

/** 校验口令，对了就把 cookie 写上。返回 true = 可以进作者模式 */
export function checkKey(input: string): boolean {
  if (!GATE_ENABLED) return true;
  if (AUTHOR_KEY.length === 0 || input.trim() !== AUTHOR_KEY) return false;
  const maxAge = COOKIE_DAYS * 24 * 60 * 60;
  document.cookie = `${COOKIE}=1; path=/; max-age=${maxAge}; samesite=lax`;
  return true;
}
