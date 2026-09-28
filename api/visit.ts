/**
 * 访客统计（Vercel Serverless + Upstash Redis，零 npm 依赖）
 *
 *  GET  /api/visit → 读当前 { count: 第几位访客(UV), pv: 浏览量 }
 *  POST /api/visit → 记一次浏览；body 里带 { unique: true } 时同时计一位新访客
 *
 * 存储未配置 → 503 { reason: 'storage-not-configured' }，前端自动退回本地计数。
 *
 * ⚠️ 共享代码（Redis 客户端 / 类型）直接内联在本文件里，不要拆回 ./_lib：
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

const storageReady = () => Boolean(KV_URL && KV_TOKEN);

/** 调一条 Redis 命令。args 形如 ['incr', 'dc:pv'] / ['get', 'dc:uv'] */
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

/* ---------------- 接口本体 ---------------- */

const UV_KEY = 'dc:uv';
const PV_KEY = 'dc:pv';

const num = (v: unknown) => Number(v ?? 0) || 0;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!storageReady()) {
    res.status(503).json({ ok: false, reason: 'storage-not-configured' });
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = ((typeof req.body === 'string' ? safeJson(req.body) : req.body) ?? {}) as {
        unique?: boolean;
      };
      const pv = num(await redis('incr', PV_KEY));
      const uv = body.unique ? num(await redis('incr', UV_KEY)) : num(await redis('get', UV_KEY));
      res.status(200).json({ ok: true, count: uv, pv });
      return;
    }

    const [uv, pv] = await Promise.all([redis('get', UV_KEY), redis('get', PV_KEY)]);
    res.status(200).json({ ok: true, count: num(uv), pv: num(pv) });
  } catch (err) {
    console.error('[visit]', err);
    res.status(502).json({ ok: false, reason: 'storage-error' });
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
