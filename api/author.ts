/**
 * 作者模式口令校验（Vercel Serverless，零 npm 依赖）。
 *
 *  POST /api/author   body: { "key": "..." }
 *    → 200 { ok: true }   口令对（= Vercel 环境变量 ADMIN_KEY）
 *    → 401 { ok: false }  口令不对
 *    → 503 { ok: false, reason: 'admin-key-not-configured' }  服务端没配口令
 *
 * 为什么有这个接口：以前口令放在 VITE_AUTHOR_KEY 里，VITE_ 前缀的变量会被
 * 打进浏览器可见的代码包，等于把口令公开给所有访客（Vercel 也会就此报警）。
 * 现在校验挪到服务端，口令永远不离开服务器；前端只发「用户输入」过来问对不对。
 *
 * 和 /admin.html 后台、/api/guestbook 的清空口令共用同一个 ADMIN_KEY ——
 * 一把钥匙管所有「只有作者能做」的事，不用记两串。
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

  // 不在这里关心时序攻击的毫秒级差异：口令错了统一 401，不区分「没配」和「错」
  if (given !== ADMIN_KEY) {
    res.status(401).json({ ok: false, reason: 'unauthorized' });
    return;
  }

  res.status(200).json({ ok: true });
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
