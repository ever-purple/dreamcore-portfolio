/**
 * 云函数共享层（Vercel Serverless Functions，零 npm 依赖）。
 *
 * 存储：Upstash Redis（REST 接口，用 fetch 直连，不需要任何 SDK）。
 * 在 Vercel 里通过 Storage → Marketplace → Upstash Redis 创建后，
 * 环境变量 KV_REST_API_URL / KV_REST_API_TOKEN 会自动注入；
 * 也兼容 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN（直连建库时的命名）。
 *
 * ⚠️ 两个变量都没配时，所有接口返回 503 + storage-not-configured，
 *    前端收到后自动退回 localStorage 行为（站点不会坏，只是没有全局数据）。
 */

/**
 * Vercel 给的两个类型 (@vercel/node) 不在项目依赖里 —— 云函数只用得到其中一小部分，
 * 就地写一份最小的，省得为一个类型装一个包。
 * 字段与官方定义对齐，将来真装了包也不会冲突。
 */
export type VercelRequest = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
};

export type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(key: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
};

export const KV_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
export const KV_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
/** 后台口令：Vercel 环境变量 ADMIN_KEY，访问 /admin.html 时要填它 */
export const ADMIN_KEY = process.env.ADMIN_KEY || '';

export const storageReady = () => Boolean(KV_URL && KV_TOKEN);

/** 调一条 Redis 命令。args 形如 ['incr', 'dc:pv'] / ['lrange', 'dc:gb', '0', '2'] */
export async function redis(...args: string[]): Promise<unknown> {
  const path = args.map(encodeURIComponent).join('/');
  const r = await fetch(`${KV_URL}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  const j = (await r.json()) as { result?: unknown };
  return j.result;
}

/* ------------------------------------------------------------------ */
/* 服务端清洗：前端那套 DOMParser 白名单在 Node 里没有，这里做黑名单兜底。  */
/* 真正渲染前前端还会再清洗一遍（AboutGuestbook 渲染时过 sanitize），      */
/* 所以这里只需要保证「进库的数据不带活动内容」。                          */
/* ------------------------------------------------------------------ */

const DangerousTags =
  /<\s*(script|style|iframe|object|embed|link|meta|svg|math|form|input|textarea|button|base)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const DangerousSelfClosing =
  /<\s*(script|style|iframe|object|embed|link|meta|base)[^>]*\/?>/gi;
const OnAttributes = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
const JsUrls = /(href|src)\s*=\s*("|\')?\s*(javascript|vbscript|data):[^"'\s>]*/gi;

/** 去掉活动内容 + 长度封顶。返回空串表示整条内容无效。 */
export function sanitizeServer(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, Math.min(raw.length, maxLen * 4 + 256));
  s = s.replace(DangerousTags, '').replace(DangerousSelfClosing, '');
  s = s.replace(OnAttributes, '').replace(JsUrls, '$1=""');
  // 去掉不可见控制字符
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

/** 纯文本长度（服务端复算字数，别信客户端） */
export const plainLength = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length;

export type GuestEntry = {
  id: string;
  name: string;
  email: string;
  html: string;
  ts: number;
};

/** 判断请求方是否持有效后台口令（支持 ?key= 或 x-admin-key 头） */
export function hasAdminKey(req: {
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  if (!ADMIN_KEY) return false;
  const q = req.query?.key;
  const h = req.headers?.['x-admin-key'];
  const given = Array.isArray(q) ? q[0] : q;
  const givenH = Array.isArray(h) ? h[0] : h;
  return (given === ADMIN_KEY) || (givenH === ADMIN_KEY);
}
