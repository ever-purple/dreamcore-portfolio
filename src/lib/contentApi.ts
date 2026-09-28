import { MOCK } from '@/data/inspiration';
import { putBlob, getBlobURL, isIdbRef } from '@/lib/blobStore';
import {
  fetchLocalLinkMeta,
  probeInspWriter,
  saveInspToDisk,
  uploadInspAsset,
} from '@/lib/inspWriter';
import type { LinkItem, MusicItem, ProjectItem, SkillItem, VisionItem } from '@/data/inspiration';

/**
 * 内容读写边界。
 *
 * 设计目标：把所有「会动数据」的读写收口到这里，界面层只认 getCollection / addItem /
 * removeItem / updateItem，永远不直接 import 写死的数组。**换后端只改本文件**，
 * 组件一行都不用动。
 *
 * ---------------------------------------------------------------------------
 * 存储后端三选一（自动探测，作者不需要改代码）：
 *
 *  ① 远端 API  —— 配了 VITE_CONTENT_API 就走它。上线后想在「后端」改内容就用这条：
 *                 GET/PUT {base} 读写整份 JSON，POST {base}/upload 上传文件。
 *  ② 项目文件  —— 跑在 `vite dev` 下时，写进 public/insp/data.json + public/insp/media/。
 *                 选 public/ 而不是 src/ 是因为 src 下改文件会触发 Vite HMR 整页刷新，
 *                 作者每存一条收藏页面就重载一次，没法连续录入；public/ 不进模块图，
 *                 而且 `npm run build` 会原样拷进 dist/，构建产物同样带着这份数据。
 *  ③ 浏览器本地 —— localStorage + IndexedDB 兜底（看构建产物、或线上没有后端时）。
 *
 * 读取优先级：远端 > 项目文件（比本地新才覆盖）> localStorage > 种子 MOCK。
 * 每次改动都会尽量往「更持久的那层」写，写不进去也不影响本次会话。
 * ---------------------------------------------------------------------------
 */

export type CollectionKey = 'vision' | 'music' | 'projects' | 'skills' | 'cases' | 'knowledge';
export type AnyItem = VisionItem | MusicItem | ProjectItem | SkillItem | LinkItem;

/** 每类数据各自的精确形状，保证 getCollection(key) 返回的是具体 item 类型而非 AnyItem[] */
type Store = {
  vision: VisionItem[];
  music: MusicItem[];
  projects: ProjectItem[];
  skills: SkillItem[];
  cases: LinkItem[];
  knowledge: LinkItem[];
};

export const COLLECTION_KEYS: CollectionKey[] = [
  'vision',
  'music',
  'projects',
  'skills',
  'cases',
  'knowledge',
];

/** 当前生效的存储后端，界面上会显示（作者要知道改动落在哪、能不能带走） */
export type StorageMode = 'remote' | 'project' | 'browser';

const LS_KEY = 'dreamcore:insp-store-v2';
/** 旧版本（v1）存的是裸 store，读得到就迁移过来，避免老数据丢失 */
const LS_KEY_V1 = 'dreamcore:insp-store-v1';

/** 远端后端地址。留空 = 用站内 /api/insp（Vercel Serverless 云端通道）。 */
const REMOTE = (import.meta.env.VITE_CONTENT_API as string | undefined)?.trim() || '/api/insp';

/** 线上（生产）默认走云端；dev 下仍走项目文件（/__studio 写回源码）。 */
const USE_REMOTE = import.meta.env.PROD || Boolean((import.meta.env.VITE_CONTENT_API as string | undefined)?.trim());

/* ------------------------------------------------------------------ */
/* 载入                                                                */
/* ------------------------------------------------------------------ */

const freshStore = (): Store => structuredClone(MOCK) as unknown as Store;

/** 只保留白名单里的六个集合键，坏数据一律丢弃，不让界面炸掉 */
function sanitizeStore(input: unknown): Store | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const base = freshStore();
  const src = input as Record<string, unknown>;
  const out = {} as Record<CollectionKey, unknown>;
  let hit = false;
  for (const k of COLLECTION_KEYS) {
    const v = src[k];
    if (Array.isArray(v)) {
      out[k] = v;
      hit = true;
    } else {
      out[k] = base[k];
    }
  }
  return hit ? (out as unknown as Store) : null;
}

type Envelope = { savedAt: number; store: Store };

/** 同步基线：localStorage（有就读，没有就用种子）。远端 / 项目文件在 hydrate 里覆盖。 */
function loadLocal(): Envelope {
  const base = freshStore();
  if (typeof window === 'undefined') return { savedAt: 0, store: base };
  for (const [key, legacy] of [
    [LS_KEY, false],
    [LS_KEY_V1, true],
  ] as const) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      // v1 是裸 store；v2 是 { savedAt, store }
      const store = legacy ? sanitizeStore(parsed) : sanitizeStore((parsed as Envelope)?.store);
      if (store) {
        return {
          savedAt: legacy ? 0 : Number((parsed as Envelope)?.savedAt) || 0,
          store,
        };
      }
    } catch {
      /* JSON 损坏 / 隐私模式：当没存过 */
    }
  }
  return { savedAt: 0, store: base };
}

let current: Envelope = loadLocal();
let hydrated = false;
let diskReady: boolean | null = null;
let lastError = '';

/** 读某一类数据（界面渲染用）。返回类型随 key 收窄为具体 item 数组。 */
export function getCollection<K extends CollectionKey>(key: K): Store[K] {
  return current.store[key];
}

/** 当前存储后端（作者面板显示用） */
export function storageMode(): StorageMode {
  if (USE_REMOTE) return 'remote';
  if (diskReady) return 'project';
  return 'browser';
}

/** 最近一次持久化失败的原因（空串 = 都成功）。 */
export function lastPersistError(): string {
  return lastError;
}

/** 是否已经能写项目文件（dev 下才有） */
export async function ensureProjectWriter(): Promise<boolean> {
  if (USE_REMOTE) return false;
  if (diskReady === null) diskReady = (await probeInspWriter()) !== null;
  return diskReady;
}

/** 磁盘上的那份 JSON。不存在（还没存过）返回 null。 */
async function loadFromProjectFile(): Promise<Envelope | null> {
  try {
    const res = await fetch(`/insp/data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    const store = sanitizeStore((parsed as Envelope)?.store);
    if (!store) return null;
    return { savedAt: Number((parsed as Envelope)?.savedAt) || 0, store };
  } catch {
    return null;
  }
}

async function loadFromRemote(): Promise<Envelope | null> {
  try {
    const res = await fetch(REMOTE, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    const store = sanitizeStore((parsed as Envelope)?.store ?? parsed);
    if (!store) return null;
    return { savedAt: Number((parsed as Envelope)?.savedAt) || 0, store };
  } catch {
    return null;
  }
}

/**
 * 补齐持久化数据：远端 > 项目文件（比浏览器本地新才覆盖）。
 * 组件挂载时调一次即可；在此之前 getCollection 已经能返回 localStorage 的快照。
 */
export async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (USE_REMOTE) {
    const got = await loadFromRemote();
    if (got) current = got;
    return;
  }
  const disk = await loadFromProjectFile();
  if (disk && disk.savedAt >= current.savedAt) current = disk;
}

/**
 * 把当前浏览器本地那份数据推上云端（作者解锁成功后调用一次）。
 * 用于「旧数据迁移」：作者以前在旧版里录的数据躺在 localStorage / IndexedDB，
 * 现在改走云端后，解锁那一刻把它们一次性焊进服务器。
 *
 * 迁移时会顺带把 `idb:` 引用的图片本体也上传到 Vercel Blob，并把引用换成
 * https 地址 —— 否则 idb: 引用到了别的设备读不到（IndexedDB 是本机的）。
 *
 * 云端已有更新或相同时间的数据时不动（避免旧数据盖掉新数据）。
 */
export async function migrateLocalToRemote(): Promise<boolean> {
  if (!USE_REMOTE) return false;
  const remote = await loadFromRemote();
  if (remote && remote.savedAt >= current.savedAt) return false;
  if (current.savedAt <= 0) return false;

  try {
    // 先把 store 里的 idb: 引用替换成 Blob 地址
    await liftIdbRefs();
    await saveRemote();
    return true;
  } catch {
    return false;
  }
}

/** MIME → 扩展名（迁移 idb: 图片时用）。 */
function mimeToExt(mime: string): string | null {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
  };
  return map[mime] ?? null;
}

/**
 * 把 store 里所有 `idb:` 引用对应的图片，上传到 Vercel Blob，替换成 https 地址。
 * 遍历六个集合，找 src/cover/icon 字段里的 idb: 引用。
 */
async function liftIdbRefs(): Promise<void> {
  const fields = ['src', 'cover', 'icon'] as const;
  const store = current.store as Record<string, unknown>;
  let changed = false;

  for (const key of COLLECTION_KEYS) {
    const list = store[key];
    if (!Array.isArray(list)) continue;
    const newList: unknown[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') {
        newList.push(item);
        continue;
      }
      const rec = { ...(item as Record<string, unknown>) };
      let itemChanged = false;
      for (const f of fields) {
        const v = rec[f];
        if (!isIdbRef(v)) continue;
        const blobUrl = await getBlobURL(v);
        if (!blobUrl) continue;
        // 从 objectURL 取回 blob，再上传到远端
        try {
          const blobRes = await fetch(blobUrl);
          if (!blobRes.ok) continue;
          const blob = await blobRes.blob();
          // 按 blob 的真实 MIME 推断扩展名，避免无扩展名导致服务端拒收
          const ext = mimeToExt(blob.type);
          if (!ext) continue;
          const file = new File([blob], `migrated-${String(v).slice(4)}.${ext}`, { type: blob.type });
          const remoteUrl = await uploadRemote(file);
          if (remoteUrl) {
            rec[f] = remoteUrl;
            itemChanged = true;
            changed = true;
          }
        } catch {
          /* 这张传不上去就保留 idb: 引用（至少本机还能看） */
        }
      }
      newList.push(itemChanged ? rec : item);
    }
    if (changed) store[key] = newList;
  }

  if (changed) {
    current = { ...current, store: store as Store };
    saveLocal();
  }
}

/* ------------------------------------------------------------------ */
/* 落盘                                                                */
/* ------------------------------------------------------------------ */

function saveLocal() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(current));
  } catch {
    /* 容量满 / 隐私模式时静默失败，会话内依旧可用 */
  }
}

async function saveRemote(): Promise<void> {
  const res = await fetch(REMOTE, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(current),
  });
  if (!res.ok) throw new Error(`远端返回 ${res.status}`);
}

/** 每次改动都走这里：先更新内存 → 写 localStorage → 再往更持久的那层写。 */
async function persist(): Promise<void> {
  current = { savedAt: Date.now(), store: current.store };
  saveLocal();
  try {
    if (USE_REMOTE) await saveRemote();
    else if (await ensureProjectWriter()) await saveInspToDisk(current);
    lastError = '';
  } catch (err) {
    lastError = err instanceof Error ? err.message : '持久化失败';
  }
}

/* ------------------------------------------------------------------ */
/* 上传                                                                */
/* ------------------------------------------------------------------ */

export type UploadResult = { url: string; name: string };

async function uploadRemote(file: File): Promise<string | null> {
  const ext = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
  const kind: 'image' | 'audio' = file.type.startsWith('audio') ? 'audio' : 'image';
  // 二进制转 base64 塞进 JSON body（服务端 /api/insp/upload 按 JSON 解析，最稳）
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
  const b64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  const qs = new URLSearchParams({ action: 'upload', ext, kind, name: file.name });
  const res = await fetch(`${REMOTE.replace(/\/$/, '')}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: b64 }),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { url?: string } | null;
  return data?.url ?? null;
}

/**
 * 上传单个文件，返回**可长期引用**的地址。
 * 优先级：远端后端（线上，图存 Vercel Blob）> 项目 public/insp/media（dev 下）> IndexedDB（兜底）。
 * 只有 IndexedDB 兜底时返回的是 `idb:` 引用，视图层要用 resolveIdbRefs 换回 object URL。
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  const kind: 'image' | 'audio' = file.type.startsWith('audio') ? 'audio' : 'image';
  if (USE_REMOTE) {
    const url = await uploadRemote(file).catch(() => null);
    if (url) return { url, name: file.name };
  } else if (await ensureProjectWriter()) {
    const url = await uploadInspAsset(file, kind).catch(() => null);
    if (url) return { url, name: file.name };
  }
  const ref = await putBlob(file);
  return { url: ref, name: file.name };
}

/**
 * 标签切分。作者输入习惯很随意，`#TVC #电商`、`#TVC#电商`、`TVC,电商`、`TVC、电商`
 * 都应该是两个标签，所以分隔符里带上 `#` 本身，切完再统一补回 `#`。
 */
export function parseTags(raw: string, max = 6): string[] {
  const out: string[] = [];
  for (const t of raw.split(/[\s,，、;；/#]+/)) {
    const v = t.trim();
    if (!v) continue;
    const tag = `#${v}`;
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 链接识别                                                            */
/* ------------------------------------------------------------------ */

export type LinkMeta = {
  title: string;
  cover: string;
  url: string;
  desc?: string;
  site?: string;
  /** netease / qqmusic / spotify / apple / github / bilibili … */
  platform?: string;
  /** 可 iframe 嵌入的播放器地址（音乐类才有） */
  embed?: string;
  /** 平台结构化信息：歌手、仓库 topics、star 数等 */
  extra?: Record<string, unknown>;
};

/** 识别失败 / 目标页没给封面时的占位封面池（同一链接稳定命中同一张）。
 *  2026-09-28：原指向 `/frames/000N.jpg`（2560×1443 的序列帧原图，单张 350~600KB）。
 *  那批 JPEG 已经换成 WebP 并从 public/ 清掉了，这里改指 `frames-sm` 的 WebP 变体 ——
 *  它本来就是"缩到 1440 宽"的小图，当一张卡片封面既够清晰又只有 ~27KB。 */
const COVER_POOL = [
  '/frames-sm/0001.webp',
  '/frames-sm/0026.webp',
  '/frames-sm/0051.webp',
  '/frames-sm/0076.webp',
  '/about/banner-visual.jpeg',
  '/about/bg-pattern.webp',
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || 'link';
  }
};

const normalizeUrl = (rawUrl: string) =>
  /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

/** URL 推断标题（兜底用）：取最后一段 slug，去连字符、去扩展名、转 Title Case */
function slugTitle(url: string): string {
  const host = hostOf(url);
  let slug = '';
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    slug = segs.length ? decodeURIComponent(segs[segs.length - 1]) : '';
  } catch {
    /* ignore */
  }
  const pretty = (slug || host)
    .replace(/[-_]+/g, ' ')
    .replace(/\.(html?|php|aspx?)$/i, '')
    .trim();
  return pretty ? pretty.replace(/\b\w/g, (c) => c.toUpperCase()) : host;
}

/** 用 URL 做稳定哈希，保证同一链接每次兜底到同一张占位封面 */
const coverFor = (url: string) => {
  const hash = [...url].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return COVER_POOL[hash % COVER_POOL.length];
};

/** 带超时的 fetch（识别服务卡住时不让界面干等） */
async function timedFetch(url: string, ms = 9000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 从抓回来的 HTML 里抠 og:title / og:image（twitter 卡片也认） */
function parseHtmlMeta(html: string, pageUrl: string): { title?: string; cover?: string } {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = (sel: string) =>
      doc.querySelector(sel)?.getAttribute('content')?.trim() || undefined;
    const title =
      meta('meta[property="og:title"]') ??
      meta('meta[name="og:title"]') ??
      doc.querySelector('title')?.textContent ??
      undefined;
    let cover =
      meta('meta[property="og:image"]') ??
      meta('meta[name="og:image"]') ??
      meta('meta[property="twitter:image"]') ??
      meta('meta[name="twitter:image"]') ??
      undefined;
    if (cover?.startsWith('//')) cover = `https:${cover}`;
    if (cover?.startsWith('/')) {
      try {
        cover = new URL(cover, pageUrl).href;
      } catch {
        /* 相对路径拼不出来就放弃 */
        cover = undefined;
      }
    }
    return { title: title || undefined, cover: cover || undefined };
  } catch {
    return {};
  }
}

/**
 * 粘贴链接 → 自动识别标题与封面（音乐还能拿到外链播放器地址）。
 *
 * 四级回退，尽量别让作者手填：
 *   1. 本地 dev 的服务端通道 /__studio/link-meta —— 不受 CORS 限制，成功率最高，
 *      还能走网易云 / QQ音乐 / GitHub 官方接口（比 og 标签准得多）；
 *   2. microlink.io —— 结构化数据（线上没有本地通道时最省事）；
 *   3. allorigins 代理抓 HTML，本地 DOMParser 抠 og: 标签；
 *   4. 都失败 → 从 URL 推断标题 + 稳定占位封面。
 * 无论哪级成功，界面都允许手动改标题 / 封面。
 */
export async function fetchLinkMeta(rawUrl: string): Promise<LinkMeta> {
  const url = normalizeUrl(rawUrl);
  const enc = encodeURIComponent(url);

  // 1) 本地服务端通道（vite dev 才有）
  const local = await fetchLocalLinkMeta(url);
  if (local && (local.title || local.cover || local.embed)) {
    return {
      title: local.title || slugTitle(url),
      cover: local.cover || coverFor(url),
      url: local.url || url,
      desc: local.desc,
      site: local.site,
      platform: local.platform,
      embed: local.embed,
      extra: local.extra,
    };
  }

  // 2) microlink：免费额度内最省事，返回 title / image / logo
  try {
    const r = await timedFetch(`https://api.microlink.io/?url=${enc}`);
    if (r.ok) {
      const j: unknown = await r.json();
      const d = (j as { data?: { title?: string; image?: { url?: string }; logo?: { url?: string } } })
        ?.data;
      const cover = d?.image?.url || d?.logo?.url || '';
      const title = (d?.title || '').trim();
      if (title || cover) {
        return { title: title || slugTitle(url), cover: cover || coverFor(url), url };
      }
    }
  } catch {
    /* 掉到下一级 */
  }

  // 3) allorigins 代理拉 HTML，自己解析 og 标签
  try {
    const r = await timedFetch(`https://api.allorigins.win/raw?url=${enc}`);
    if (r.ok) {
      const html = await r.text();
      const m = parseHtmlMeta(html, url);
      if (m.title || m.cover) {
        return {
          title: m.title || slugTitle(url),
          cover: m.cover || coverFor(url),
          url,
        };
      }
    }
  } catch {
    /* 掉到兜底 */
  }

  // 4) 兜底：URL 推断 + 稳定占位封面
  return { title: slugTitle(url), cover: coverFor(url), url };
}

/* ------------------------------------------------------------------ */
/* 增删改                                                              */
/* ------------------------------------------------------------------ */

/** 新增一条 */
export async function addItem(key: CollectionKey, item: AnyItem): Promise<void> {
  const list = current.store[key] as AnyItem[];
  current.store = { ...current.store, [key]: [...list, item] } as Store;
  await persist();
}

/** 删除一条远端 Blob 图（作者删条目时同步清掉，省得云上堆垃圾）。 */
async function deleteRemoteBlob(url: unknown): Promise<void> {
  if (typeof url !== 'string') return;
  // 只删 Vercel Blob 的地址（https://xxx.blob.vercel-storage.com/...），
  // 不动 idb: 引用、也不动站内 /insp/media 路径。
  if (!/^https:\/\/[^/]+\.blob\.vercel-storage\.com\//i.test(url)) return;
  try {
    await fetch(`${REMOTE.replace(/\/$/, '')}?action=blob&url=${encodeURIComponent(url)}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
  } catch {
    /* 删不掉就算了，不阻塞删除操作本身 */
  }
}

/** 按 id 删除一条 */
export async function removeItem(key: CollectionKey, id: string): Promise<void> {
  const list = current.store[key] as AnyItem[];
  const target = list.find((x) => (x as { id: string }).id === id);
  current.store = {
    ...current.store,
    [key]: list.filter((x) => (x as { id: string }).id !== id),
  } as Store;
  await persist();
  // 删除条目后，尽力同步清掉它引用的云端图片（异步，不阻塞）
  if (target && USE_REMOTE) {
    const t = target as { cover?: unknown; src?: unknown; icon?: unknown };
    void deleteRemoteBlob(t.cover ?? t.src ?? t.icon);
  }
}

/** 按 id 修改一条。只合并传入的字段，其余保持原样。 */
export async function updateItem(
  key: CollectionKey,
  id: string,
  patch: Partial<AnyItem>,
): Promise<void> {
  const list = current.store[key] as AnyItem[];
  current.store = {
    ...current.store,
    [key]: list.map((x) => ((x as { id: string }).id === id ? { ...x, ...patch } : x)),
  } as Store;
  await persist();
}

/** 调整顺序（作者面板的「上移 / 下移」）。 */
export async function moveItem(key: CollectionKey, id: string, dir: -1 | 1): Promise<void> {
  const list = [...(current.store[key] as AnyItem[])] as Array<{ id: string }>;
  const idx = list.findIndex((x) => x.id === id);
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= list.length) return;
  [list[idx], list[next]] = [list[next], list[idx]];
  current.store = { ...current.store, [key]: list } as Store;
  await persist();
}

/* ------------------------------------------------------------------ */
/* 整份导入 / 导出 / 重置                                              */
/* ------------------------------------------------------------------ */

/** 导出整份收藏（作者可以拿去备份，或贴到远端后端）。 */
export function exportStore(): string {
  return JSON.stringify(current, null, 2);
}

/** 导入一份 JSON（导出出来的那种，或 { store: {...} } 裸结构也认）。 */
export async function importStore(text: string): Promise<boolean> {
  const parsed: unknown = JSON.parse(text);
  const store = sanitizeStore((parsed as Envelope)?.store ?? parsed);
  if (!store) return false;
  current = { savedAt: Date.now(), store };
  await persist();
  return true;
}

/**
 * 恢复默认数据。
 *
 * 「默认」的来源优先级：
 *   1. `/insp/data.json` —— 网站发布的那份（改内容推上线后，作者在这里一键同步回来）；
 *   2. 编译进 bundle 的种子 MOCK —— data.json 拉不到时兜底。
 *
 * ⚠️ 之前只恢复 MOCK 有个坑：种子和 data.json 是两份数据，只更新 data.json 时
 * 作者点「恢复默认」拿不到新内容（还会被本地快照的 savedAt 永久遮蔽）。
 * 现在以 data.json 为准，两边就咬合上了。
 */
export async function resetStore(): Promise<void> {
  const disk = await loadFromProjectFile();
  current = disk
    ? { savedAt: Date.now(), store: disk.store }
    : { savedAt: Date.now(), store: freshStore() };
  await persist();
}

/**
 * 六类全清空。换真实内容时的第一步 —— 种子里那些占位条目一条条删太累了，
 * 一键清空后再逐条录入。
 */
export async function clearStore(): Promise<void> {
  const empty = {} as Store;
  for (const k of COLLECTION_KEYS) empty[k] = [];
  current = { savedAt: Date.now(), store: empty };
  await persist();
}
