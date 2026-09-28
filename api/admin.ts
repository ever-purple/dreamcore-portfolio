/**
 * 后台数据接口 ——「留言」和「访客统计」放在同一个地方（零 npm 依赖）。
 *
 *  GET /api/admin?key=<你的后台口令>
 *      口令从 Vercel 环境变量 ADMIN_KEY 读，也可以放在 x-admin-key 请求头里。
 *
 * 返回 { uv, pv, guestbook: [全部留言], fetchedAt }
 *
 * ⚠️ 没配 ADMIN_KEY 时一律 503，后台页会提示去配环境变量。
 *
 * ⚠️ 共享代码直接内联在本文件里，不要拆回 ./_lib：
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

/** 调一条 Redis 命令。args 形如 ['incr', 'dc:pv'] / ['lrange', 'dc:gb', '0', '2'] */
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

/* ---------------- 接口本体 ---------------- */

type GuestEntry = {
  id: string;
  name: string;
  email: string;
  html: string;
  ts: number;
};

const GB_KEY = 'dc:gb';
const UV_KEY = 'dc:uv';
const PV_KEY = 'dc:pv';
const MAX_KEEP = 500;

const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!ADMIN_KEY) {
    res.status(503).json({ ok: false, reason: 'admin-key-not-configured' });
    return;
  }
  if (!hasAdminKey(req)) {
    res.status(401).json({ ok: false, reason: 'unauthorized' });
    return;
  }
  if (!storageReady()) {
    res.status(503).json({ ok: false, reason: 'storage-not-configured' });
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, reason: 'method-not-allowed' });
    return;
  }

  try {
    const [uvRaw, pvRaw, rawRaw] = await Promise.all([
      redis('get', UV_KEY),
      redis('get', PV_KEY),
      redis('lrange', GB_KEY, '0', String(MAX_KEEP - 1)),
    ]);

    const guestbook: GuestEntry[] = (Array.isArray(rawRaw) ? rawRaw : [])
      .map((item) => {
        try {
          const o = JSON.parse(str(item)) as Record<string, unknown>;
          if (!o || typeof o !== 'object') return null;
          return {
            id: str(o.id),
            name: str(o.name),
            email: str(o.email),
            html: str(o.html),
            ts: num(o.ts),
          } satisfies GuestEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is GuestEntry => e !== null);

    // 最新的排最前
    guestbook.sort((a, b) => b.ts - a.ts);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      uv: num(uvRaw),
      pv: num(pvRaw),
      guestbook,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    console.error('[admin]', err);
    res.status(502).json({ ok: false, reason: 'storage-error' });
  }
}
