import {
  hasAdminKey,
  plainLength,
  redis,
  sanitizeServer,
  storageReady,
  type GuestEntry,
  type VercelRequest,
  type VercelResponse,
} from './_lib.ts';

/**
 * 留言板（Vercel Serverless + Upstash Redis，零 npm 依赖）
 *
 *  GET  /api/guestbook           → 公开最近 3 条（最新在前）
 *  POST /api/guestbook           → 发一条留言，写完直接回最新 3 条
 *  DELETE /api/guestbook?key=xx  → 清空全部留言（需后台口令）
 *
 * 列表键 dc:gb：最新的一条永远在 index 0，所以「最近 3 条」= LRANGE 0 2。
 * 上限 500 条，超出由 LTRIM 自动丢最老的，不用人工清理。
 */

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

    /* ---------- 读公开最近 N 条 ---------- */
    if (req.method === 'GET') {
      const raw = await readRaw();
      const entries = raw
        .map(parseEntry)
        .filter((e): e is GuestEntry => e !== null)
        .slice(0, PUBLIC_RECENT);
      res.status(200).json({ ok: true, list: entries, total: raw.length });
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
