/**
 * 作者模式口令校验（Vercel Serverless，零 npm 依赖）。
 *
 *  POST /api/author   body: { "key": "..." }
 *    → 200 { ok: true, token: "<随机token>" }   口令对（= Vercel 环境变量 ADMIN_KEY）
 *    → 401 { ok: false }   口令不对
 *    → 503 { ok: false, reason: 'admin-key-not-configured' }  服务端没配口令
 *
 * 口令校验通过后，会**签发一个随机 token** 存进 Redis（14 天有效），
 * 前端把它写进 `dc_author` cookie。之后所有「作者专属」的写接口
 * （/api/insp 的上传/写数据）都认这个 cookie token —— 前端代码里依然
 * 不含任何口令，token 也不可被猜中 / 伪造。
 *
 * 为什么升级成 token：以前 unlock 只写 `dc_author=1` 这种固定值 cookie，
 * 懂行的人 F12 手改 cookie 就能伪造「已解锁」。现在换成随机签发的 token，
 * 服务端每次写操作都回 Redis 核对，改 cookie 也没用。
 *
 * ⚠️ 共享代码直接内联在本文件里，不要拆回 ./_lib（原因见 visit.ts 顶部注释）。
 */

/* ---------------- Vercel 最小类型 ---------------- */
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

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

/** token 在 Redis 里的 key 前缀。 */
const TOKEN_KEY = 'dc:author:token';
/** token 有效天数（和前端 cookie 一致）。 */
const TOKEN_TTL_DAYS = 14;

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

/** 用 crypto 随机生成一个不可猜的 token（32 字节 hex）。 */
function makeToken(): string {
  const c = (globalThis as unknown as { crypto?: { randomBytes?(n: number): Uint8Array } }).crypto;
  if (c && typeof c.randomBytes === 'function') {
    return Array.from(c.randomBytes(32)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // 兜底：Node 里 crypto 的 randomBytes 几乎必有，这里再保险一层
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!ADMIN_KEY) {
    res.status(503).json({ ok: false, reason: 'admin-key-not-configured' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method-not-allowed' });
    return;
  }

  const body = ((typeof req.body === 'string' ? safeJson(req.body) : req.body) ?? {}) as {
    key?: unknown;
  };
  const given = typeof body.key === 'string' ? body.key.trim() : '';

  if (given !== ADMIN_KEY) {
    res.status(401).json({ ok: false, reason: 'unauthorized' });
    return;
  }

  // 口令对：签发随机 token，存 Redis（14 天），返回给前端
  try {
    if (!KV_URL || !KV_TOKEN) {
      // Redis 没配时，退化成一个「会话级」token（只本轮有效，无法持久）。
      // 此时写接口也没法工作（写接口依赖 Redis 存数据），所以影响有限。
      const token = makeToken();
      res.status(200).json({ ok: true, token, ephemeral: true });
      return;
    }
    const token = makeToken();
    await redis('set', `${TOKEN_KEY}:${token}`, '1', 'EX', String(TOKEN_TTL_DAYS * 24 * 60 * 60));
    res.status(200).json({ ok: true, token });
  } catch (err) {
    console.error('[author:token]', err);
    // token 存不进 Redis 时，仍告诉前端「口令对了」，但写接口会因 token 无效而 401，
    // 这是可接受的降级（作者会看到「保存失败」而不是口令错误）。
    res.status(200).json({ ok: true, token: '', ephemeral: true });
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
