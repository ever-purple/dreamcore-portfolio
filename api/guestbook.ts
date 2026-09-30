/**
 * 留言板（Vercel Serverless + Upstash Redis，零 npm 依赖）
 *
 *  GET  /api/guestbook           → 公开最近 3 条（最新在前）
 *  POST /api/guestbook           → 发一条留言，写完直接回最新 3 条
 *  DELETE /api/guestbook?key=xx  → 清空全部留言（需后台口令）
 *
 * 列表键 dc:gb：最新的一条永远在 index 0，所以「最近 3 条」= LRANGE 0 2。
 * 上限 500 条，超出由 LTRIM 自动丢最老的，不用人工清理。
 *
 * ⚠️ 共享代码（Redis 客户端 / 清洗 / 口令校验）直接内联在本文件里，不要拆回 ./_lib：
 *    Vercel 对 /api 下的函数按文件独立转译，跨文件 import 在部分构建管线下
 *    解析不到（实测导致 FUNCTION_INVOCATION_FAILED，且无日志）。
 *    要改公共逻辑请 visit / guestbook / admin 三个文件同步改。
 */

/* ---------------- Vercel 最小类型（@vercel/node 不在项目依赖里，就地声明） ---------------- */
type VercelRequest = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(key: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
};

/* ---------------- Upstash Redis（REST 直连，无 SDK） ----------------
 * Vercel Storage → Marketplace → Upstash 建库会自动注入
 *   KV_REST_API_URL / KV_REST_API_TOKEN；
 * 在 Upstash 官网直连建库时的命名是
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN，这里两套都认。
 * 两个都没配时本接口返回 503，前端退回 localStorage 行为，站点不会坏。
 */
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
/** 后台口令：Vercel 环境变量 ADMIN_KEY，访问 /admin.html 时要填它 */
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const storageReady = () => Boolean(KV_URL && KV_TOKEN);

/** 调一条 Redis 命令。args 形如 ['lpush', 'dc:gb', '{...}'] */
async function redis(...args: string[]): Promise<unknown> {
  const cmdPath = args.map(encodeURIComponent).join('/');
  const r = await fetch(`${KV_URL}/${cmdPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  const j = (await r.json()) as { result?: unknown };
  return j.result;
}

/** 判断请求方是否持有效后台口令（支持 ?key= 或 x-admin-key 头） */
function hasAdminKey(req: {
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  if (!ADMIN_KEY) return false;
  const q = req.query?.key;
  const h = req.headers?.['x-admin-key'];
  const given = Array.isArray(q) ? q[0] : q;
  const givenH = Array.isArray(h) ? h[0] : h;
  return given === ADMIN_KEY || givenH === ADMIN_KEY;
}

/* ---------------- 服务端清洗（前端渲染前还会再过一遍 sanitize） ---------------- */

const DangerousTags =
  /<\s*(script|style|iframe|object|embed|link|meta|svg|math|form|input|textarea|button|base)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const DangerousSelfClosing =
  /<\s*(script|style|iframe|object|embed|link|meta|base)[^>]*\/?>/gi;
const OnAttributes = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
const JsUrls = /(href|src)\s*=\s*("|\')?\s*(javascript|vbscript|data):[^"'\s>]*/gi;

/** 去掉活动内容 + 长度封顶。返回空串表示整条内容无效。 */
function sanitizeServer(raw: unknown, maxLen: number): string {
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
const plainLength = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length;

/* ---------------- 接口本体 ---------------- */

type GuestEntry = {
  id: string;
  name: string;
  email: string;
  html: string;
  ts: number;
};

const GB_KEY = 'dc:gb';
const PUBLIC_RECENT = 3;
const MAX_KEEP = 500;
const MAX_NAME = 24;
const MAX_TEXT = 500;
const MAX_EMAIL = 64;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** 读全部条目的原始 JSON 字符串数组 */
async function readRaw(): Promise<string[]> {
  const r = await redis('lrange', GB_KEY, '0', String(MAX_KEEP - 1));
  return Array.isArray(r) ? r.map(str) : [];
}

function parseEntry(item: string): GuestEntry | null {
  try {
    const o = JSON.parse(item) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    const html = str(o.html);
    if (!html) return null;
    return {
      id: str(o.id) || `e${Math.random().toString(36).slice(2, 10)}`,
      name: str(o.name).slice(0, MAX_NAME),
      email: str(o.email).slice(0, MAX_EMAIL),
      html,
      ts: Number(o.ts) || Date.now(),
    };
  } catch {
    return null;
  }
}

/** 往列表最前面插一条，顺手裁到 MAX_KEEP 条 */
async function pushEntry(entry: GuestEntry) {
  await redis('lpush', GB_KEY, JSON.stringify(entry));
  await redis('ltrim', GB_KEY, '0', String(MAX_KEEP - 1));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!storageReady()) {
    res.status(503).json({ ok: false, reason: 'storage-not-configured' });
    return;
  }

  try {
    /* ---------- 清空（后台口令） ---------- */
    if (req.method === 'DELETE') {
      if (!hasAdminKey(req)) {
        res.status(401).json({ ok: false, reason: 'unauthorized' });
        return;
      }
      await redis('del', GB_KEY);
      res.status(200).json({ ok: true, cleared: true });
      return;
    }

    /* ---------- 读公开最近 N 条 / 带 key 读全部 ---------- */
    if (req.method === 'GET') {
      const raw = await readRaw();
      const entries = raw
        .map(parseEntry)
        .filter((e): e is GuestEntry => e !== null);
      // 带有效后台口令时返回全部（管理面板用）；否则只回最近 3 条
      if (hasAdminKey(req)) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ ok: true, list: entries, total: raw.length, all: true });
        return;
      }
      res.status(200).json({ ok: true, list: entries.slice(0, PUBLIC_RECENT), total: raw.length });
      return;
    }

    /* ---------- 写一条 ---------- */
    if (req.method === 'POST') {
      const body = ((typeof req.body === 'string' ? safeJson(req.body) : req.body) ?? {}) as Record<
        string,
        unknown
      >;

      const html = sanitizeServer(body?.html, MAX_TEXT);
      if (plainLength(html) < 1) {
        res.status(400).json({ ok: false, reason: 'empty' });
        return;
      }
      const name = (sanitizeServer(body?.name, MAX_NAME * 2) || '').trim().slice(0, MAX_NAME);
      const email = (sanitizeServer(body?.email, MAX_EMAIL * 2) || '').trim().slice(0, MAX_EMAIL);

      const entry: GuestEntry = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        name: name || '匿名',
        email,
        html,
        ts: Date.now(),
      };
      await pushEntry(entry);

      // 直接回最新 3 条，前端不用再发一次请求
      const raw = await readRaw();
      const list = raw
        .map(parseEntry)
        .filter((e): e is GuestEntry => e !== null)
        .slice(0, PUBLIC_RECENT);

      res.status(200).json({ ok: true, mine: entry, list, total: raw.length });
      return;
    }

    res.status(405).json({ ok: false, reason: 'method-not-allowed' });
  } catch (err) {
    console.error('[guestbook]', err);
    res.status(502).json({ ok: false, reason: 'storage-error' });
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}
