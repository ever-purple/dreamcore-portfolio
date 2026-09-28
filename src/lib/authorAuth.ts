/**
 * 作者模式的口令校验。
 *
 * 生产构建里作者模式不再「点一下就开」：要点开输入框输口令，输对才进。
 * 进了就在 cookie 里记一笔，刷新、换页都还是作者模式；关掉浏览器失效。
 *
 * 🔒 口令校验在**服务端**（/api/author，对照 Vercel 环境变量 ADMIN_KEY）：
 *    前端代码里不再有任何口令，F12 翻不出来。输入的口令只在请求体里走一次，
 *    校验通过后浏览器只留一个「已解锁」标记 cookie（不含口令本身）。
 *    注意：这道门防的仍是「访客随手把编辑界面翻出来」——真正的数据安全
 *    由各写接口（/api/admin、/api/guestbook）在服务端再校验一次来保证。
 *
 * 服务端没配 ADMIN_KEY 时（/api/author 返回 503），gateError() 会给出提示。
 */

const COOKIE = 'dc_author';
const COOKIE_DAYS = 14;
/**
 * 隐藏入口：连按同一个键触发，不显示任何按钮。
 * 3 秒内连按 4 次即可 —— 正常访客不会误触，也不占屏幕、不进截图；
 * 同时挡掉「按住不放」产生的重复 keydown 事件。
 */
export const HOTKEY_KEY = 'm';
export const HOTKEY_TIMES = 4;
export const HOTKEY_WINDOW = 3000;

/**
 * 只有「生产构建」才启用这道门。
 * 开发环境保持原来的 ?admin=1 习惯，不然自己调试还要先输口令，很烦。
 * （服务端有没有配口令，要到输口令那一刻才知道，由 gateError() 提示。）
 */
export const GATE_ENABLED = import.meta.env.PROD;

/** 最近一次校验失败的原因（空串 = 没失败过 / 就是口令不对）。供口令框展示。 */
let lastGateError = '';
export function gateError(): string {
  return lastGateError;
}

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

/** 之前输对过口令？（cookie 在，就还是作者） */
export function isUnlocked(): boolean {
  if (!GATE_ENABLED) return true;
  return readCookie(COOKIE) !== '';
}

/** 服务端确认过口令、写了解锁 cookie。token 是服务端签发的随机串（不含口令）。 */
function markUnlocked(token: string): void {
  const maxAge = COOKIE_DAYS * 24 * 60 * 60;
  const value = token || '1'; // token 为空时（Redis 没配）退化成「已解锁」占位
  document.cookie = `${COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

/**
 * 校验口令（问服务端）。返回 true = 可以进作者模式。
 * 失败时可通过 gateError() 拿到比「口令不对」更具体的原因（没配 / 网络问题）。
 */
export async function checkKey(input: string): Promise<boolean> {
  if (!GATE_ENABLED) return true;
  lastGateError = '';
  try {
    const res = await fetch('/api/author', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: input.trim() }),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { token?: string };
      markUnlocked(data.token || '');
      return true;
    }
    if (res.status === 503) {
      lastGateError = '服务端还没配 ADMIN_KEY';
      return false;
    }
    if (res.status === 401) return false; // 纯粹口令不对，不给额外提示
    lastGateError = `服务异常（${res.status}）`;
    return false;
  } catch {
    lastGateError = '网络不通，稍后再试';
    return false;
  }
}
