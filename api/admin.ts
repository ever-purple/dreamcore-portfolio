import {
  ADMIN_KEY,
  hasAdminKey,
  redis,
  storageReady,
  type GuestEntry,
  type VercelRequest,
  type VercelResponse,
} from './_lib.ts';

/**
 * 后台数据接口 ——「留言」和「访客统计」放在同一个地方。
 *
 *  GET /api/admin?key=<你的后台口令>
 *      口令从 Vercel 环境变量 ADMIN_KEY 读，也可以放在 x-admin-key 请求头里。
 *
 * 返回 { uv, pv, guestbook: [全部留言], fetchedAt }
 *
 * ⚠️ 没配 ADMIN_KEY 时一律 503，后台页会提示去配环境变量。
 */

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
