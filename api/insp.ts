/**
 * 灵感收藏的「云端读写通道」—— 图片本体存 Vercel Blob，数据 JSON 存 Upstash Redis。
 * （Vercel Serverless，零 npm 依赖，用 fetch 直连 Blob / Redis 的 HTTP 接口）
 *
 * 这是让「灵感收藏里上传/粘贴的图**焊进服务器**」的关键：以前图片只能落在
 * 浏览器 IndexedDB（换设备 / 清缓存就没了），现在走这里，任何设备打开都在。
 *
 *   GET  /api/insp
 *        读整份收藏。访客也能读（不然灵感收藏谁都看不到）。
 *        → 200 { ok, savedAt, store }
 *
 *   PUT  /api/insp
 *        整份覆盖收藏数据。**只有作者**（要 ADMIN_KEY）。
 *        body: { savedAt, store }   → 写进 Redis dc:insp
 *
 *   POST /api/insp/upload?ext=jpg
 *        上传一张图 / 一段音频到 Vercel Blob，返回可长期引用的 https 地址。
 *        **只有作者**（要 ADMIN_KEY）。body 是文件二进制。
 *        → 200 { ok, url, bytes }
 *
 *   DELETE /api/insp/blob?url=<绝对地址>
 *        删除某张已上传的图（作者删条目时同步清掉 Blob，省得堆垃圾）。
 *        **只有作者**。
 *
 * ⚠️ 共享代码（Redis 客户端 / 口令校验）直接内联在本文件，不要拆回 ./_lib：
 *    Vercel 对 /api 函数按文件独立转译，跨文件 import 在部分构建管线下解析不到。
 *    要改公共逻辑请 visit / guestbook / admin / visitlog / insp 几个文件同步改。
 *
 * ⚠️ 环境变量：
 *    KV_REST_API_URL / KV_REST_API_TOKEN     —— Upstash Redis（你已配好）
 *    BLOB_READ_WRITE_TOKEN                   —— Vercel Blob（要新开，见最后部署说明）
 *    ADMIN_KEY                               —— 作者口令（你已配好）
 */

/* ---------------- Vercel 最小类型 ---------------- */
type VercelRequest = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  url?: string;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(key: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
};

/* ---------------- 环境变量 ---------------- */
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

/** 数据在 Redis 里的 key。 */
const INSP_KEY = 'dc:insp';
/** 作者 token 在 Redis 里的 key 前缀（和 api/author.ts 一致）。 */
const TOKEN_KEY = 'dc:author:token';

const storageReady = () => Boolean(KV_URL && KV_TOKEN);
const blobReady = () => Boolean(BLOB_TOKEN);

/* ---------------- Redis ---------------- */
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

/* ---------------- 鉴权 ----------------
 * 写操作要「作者已解锁」。两种凭证都认：
 *   1. 直接给 ADMIN_KEY（?key= 或 x-admin-key 头）—— 后台页 / 调试用；
 *   2. `dc_author` cookie 里的随机 token（由 /api/author 签发，存 Redis）。
 *      前端作者模式解锁后只带这个 token，不含口令；服务端回 Redis 核对。
 */
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

/** 从 cookie 头里读 dc_author 的值。 */
function readCookie(headers: VercelRequest['headers']): string {
  const raw = headers?.cookie;
  const arr = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const m = /(?:^|;\s*)dc_author=([^;]+)/.exec(arr);
  return m ? decodeURIComponent(m[1]) : '';
}

/** token 是否有效（回 Redis 核对）。 */
async function tokenValid(token: string): Promise<boolean> {
  if (!token || !KV_URL || !KV_TOKEN) return false;
  try {
    const v = await redis('get', `${TOKEN_KEY}:${token}`);
    return v === '1';
  } catch {
    return false;
  }
}

/** 写操作鉴权：有 ADMIN_KEY，或 cookie token 有效，才算作者。 */
async function isAuthor(req: VercelRequest): Promise<boolean> {
  if (hasAdminKey(req)) return true;
  const token = readCookie(req.headers);
  return token !== '' && (await tokenValid(token));
}

/* ---------------- 工具 ---------------- */
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => Number(v ?? 0) || 0;

/** 灵感收藏的六个集合键（白名单，防止往数据里塞奇怪的东西） */
const COLLECTION_KEYS = ['vision', 'music', 'projects', 'skills', 'cases', 'knowledge'];

/** 允许上传的扩展名（图片 + 音频）。 */
const ALLOWED_EXT = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif',
  'mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac',
]);

/** 上传大小上限：20MB（作品集单图 / 单曲够用）。 */
const MAX_BODY = 20 * 1024 * 1024;

/** 把 req.body 从可能的字符串 / Buffer 形态统一成 Buffer。 */
function bodyAsBuffer(body: unknown): Buffer | null {
  if (body === null || body === undefined) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'binary');
  return null;
}

/**
 * 把 req.body 统一解析成「普通对象」。兼容三种形态：
 *  · 已经是对象（Vercel 对 application/json 会直接解析好）→ 原样返回
 *  · 字符串（JSON 文本）→ JSON.parse
 *  · Buffer / Uint8Array → toString 后 JSON.parse
 * 失败返回 null。
 */
function normalizeBodyObject(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object' && !Array.isArray(body) && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    return body as Record<string, unknown>;
  }
  const buf = bodyAsBuffer(body);
  if (!buf) return null;
  try {
    const parsed: unknown = JSON.parse(buf.toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/** 清洗上传文件名（只留 ASCII 字母数字和 . _ -，中文换 _，防路径穿越/二次编码死链）。 */
function safeStem(raw: string): string {
  const base = raw
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 40);
  return base || 'file';
}

/**
 * 上传二进制到 Vercel Blob，返回公开 URL。
 * 用 @vercel/blob 的 REST 端点：PUT https://blob.vercel-storage.com/<storeId>/<path>
 * 需要 BLOB_READ_WRITE_TOKEN 带在 Authorization 头。
 */
async function putBlob(buf: Buffer, pathname: string): Promise<string> {
  // 通过官方 Blob 客户端 API 的端点，pathname 形如 "insp/xxx.jpg"
  const url = `https://blob.vercel-storage.com/${pathname}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'X-Add-Random-Suffix': 'false',
      'Access': 'public',
    },
    body: new Uint8Array(buf),
  });
  if (!r.ok) throw new Error(`blob ${r.status}`);
  const j = (await r.json()) as { url?: string };
  if (!j.url) throw new Error('blob 没返回 url');
  return j.url;
}

/** 从 Blob 的公开 URL 里解析出 pathname，用于删除。 */
function blobPathOf(url: string): string | null {
  const m = /^https:\/\/[^/]+\/([^?#]+)/.exec(url);
  return m ? m[1] : null;
}

/** 删除一张 Blob 图。删不掉（404 等）不算致命错误，返回 bool。 */
async function deleteBlob(url: string): Promise<boolean> {
  const pathname = blobPathOf(url);
  if (!pathname) return false;
  try {
    const r = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${BLOB_TOKEN}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

/* ---------------- 接口本体 ---------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  // 用 query 参数区分动作，而不是子路径 —— Vercel 只把 /api/insp 精确路由到本文件，
  // /api/insp/upload 这种子路径匹配不到任何文件会 404。
  const action = str(req.query?.action);
  const isUpload = action === 'upload';
  const isBlobDel = action === 'blob';

  /* ---- 读：公开，访客也能读 ---- */
  if (req.method === 'GET') {
    if (!storageReady()) {
      res.status(503).json({ ok: false, reason: 'storage-not-configured' });
      return;
    }
    try {
      const raw = await redis('get', INSP_KEY);
      const parsed = safeParse(str(raw));
      if (!parsed) {
        res.status(200).json({ ok: true, savedAt: 0, store: null });
        return;
      }
      res.status(200).json({ ok: true, savedAt: num(parsed.savedAt), store: parsed.store });
    } catch (err) {
      console.error('[insp:read]', err);
      res.status(502).json({ ok: false, reason: 'storage-error' });
    }
    return;
  }

  /* ---- 以下都是写操作，要作者口令或 token ---- */
  if (!(await isAuthor(req))) {
    res.status(401).json({ ok: false, reason: 'unauthorized' });
    return;
  }
  if (!storageReady()) {
    res.status(503).json({ ok: false, reason: 'storage-not-configured' });
    return;
  }

  /* ---- 写整份数据 ---- */
  if (req.method === 'PUT') {
    try {
      const parsed = normalizeBodyObject(req.body);
      if (!parsed) {
        res.status(400).json({ ok: false, reason: 'empty-body' });
        return;
      }
      const env = parsed as { savedAt?: unknown; store?: unknown };
      const store = env.store;
      if (!store || typeof store !== 'object' || Array.isArray(store)) {
        res.status(400).json({ ok: false, reason: 'missing-store' });
        return;
      }
      // 只收白名单集合键
      const cleanStore: Record<string, unknown> = {};
      for (const k of COLLECTION_KEYS) {
        const v = (store as Record<string, unknown>)[k];
        if (Array.isArray(v)) cleanStore[k] = v;
      }
      const payload = {
        savedAt: typeof env.savedAt === 'number' ? env.savedAt : Date.now(),
        store: cleanStore,
      };
      await redis('set', INSP_KEY, JSON.stringify(payload));
      res.status(200).json({ ok: true, savedAt: payload.savedAt });
    } catch (err) {
      console.error('[insp:write]', err);
      res.status(400).json({ ok: false, reason: 'invalid-body' });
    }
    return;
  }

  /* ---- 上传图片 / 音频 ----
   * 注意：文件二进制用 base64 塞在 JSON body 里传，而不是 raw octet-stream。
   * 原因：Vercel 对 api/*.ts 默认走 JSON body 解析，raw 二进制在部分构建管线下
   * 会被当 JSON 解析失败 / 损坏。base64 复用同一套 JSON 解析路径，最稳。
   * 前端（contentApi.uploadFile）负责把 File 转 base64 后 POST 过来。
   */
  if (req.method === 'POST' && isUpload) {
    if (!blobReady()) {
      res.status(503).json({ ok: false, reason: 'blob-not-configured' });
      return;
    }
    const ext = str(req.query?.ext).toLowerCase().replace(/^\./, '');
    const kind = str(req.query?.kind) === 'audio' ? 'audio' : 'image';
    const name = str(req.query?.name);
    if (!ALLOWED_EXT.has(ext)) {
      res.status(400).json({ ok: false, reason: `unsupported-ext:${ext}` });
      return;
    }
    const parsed = normalizeBodyObject(req.body);
    if (!parsed) {
      res.status(400).json({ ok: false, reason: 'empty-body' });
      return;
    }
    const data = parsed as { data?: unknown };
    const b64 = str(data.data);
    if (!b64) {
      res.status(400).json({ ok: false, reason: 'missing-data' });
      return;
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      res.status(400).json({ ok: false, reason: 'bad-base64' });
      return;
    }
    if (buf.length === 0) {
      res.status(400).json({ ok: false, reason: 'empty-file' });
      return;
    }
    if (buf.length > MAX_BODY) {
      res.status(413).json({ ok: false, reason: 'too-large' });
      return;
    }
    try {
      const file = `${kind}-${safeStem(name)}-${Date.now().toString(36)}.${ext}`;
      const url = await putBlob(buf, `insp/${file}`);
      res.status(200).json({ ok: true, url, bytes: buf.length });
    } catch (err) {
      console.error('[insp:upload]', err);
      res.status(502).json({ ok: false, reason: 'blob-error' });
    }
    return;
  }

  /* ---- 删除某张 Blob 图 ---- */
  if (req.method === 'DELETE' && isBlobDel) {
    if (!blobReady()) {
      res.status(503).json({ ok: false, reason: 'blob-not-configured' });
      return;
    }
    const url = str(req.query?.url);
    if (!/^https:\/\//i.test(url)) {
      res.status(400).json({ ok: false, reason: 'bad-url' });
      return;
    }
    try {
      const deleted = await deleteBlob(url);
      res.status(200).json({ ok: true, deleted });
    } catch (err) {
      console.error('[insp:delete-blob]', err);
      res.status(502).json({ ok: false, reason: 'blob-error' });
    }
    return;
  }

  res.status(404).json({ ok: false, reason: 'not-found' });
}

function safeParse(s: string): { savedAt?: unknown; store?: unknown } | null {
  try {
    const j = JSON.parse(s);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    return null;
  } catch {
    return null;
  }
}
