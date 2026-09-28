// 带上 .ts：ESM 下不带扩展名 Node 解析不了，带上才能本地直接跑回归测试，
// Vercel 用 esbuild 打包也不认这个后缀，两边都OK。
import { redis, storageReady, type VercelRequest, type VercelResponse } from './_lib.ts';

/**
 * GET  /api/visit          → 读当前 { count: 第几位访客(UV), pv: 浏览量 }
 * POST /api/visit          → 记一次浏览；body 里带 { unique: true } 时同时计一位新访客
 *
 * 存储未配置 → 503 { reason: 'storage-not-configured' }，前端自动退回本地计数。
 */

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
