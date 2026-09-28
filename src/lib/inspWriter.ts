/**
 * 「灵感收藏」的**落盘通道**前端部分（对应 `studio-writer.ts` 的 /__studio/* 路由）。
 *
 * 三件事：
 *  1. `probeInspWriter()` —— 探活，判断当前是不是跑在 `vite dev` 下（有写入能力）；
 *  2. `uploadInspAsset()` —— 上传图片 / 音频，返回 `/insp/media/xxx.jpg` 这种**长期有效**的地址；
 *  3. `saveInspToDisk()` —— 把整份收藏写进 `public/insp/data.json`。
 *
 * 为什么落 `public/insp/` 而不是 `src/data/*.ts`：src 下改文件会被 Vite 纳进模块图，
 * 触发 HMR 整页刷新 —— 作者每存一条收藏页面就重载一次，没法连续录入。
 * public/ 是纯静态目录，写完立刻能 fetch 到，也不惊动模块图；`npm run build`
 * 还会原样拷进 dist/，所以构建产物同样带着这份数据。
 *
 * 探活失败（看的是构建产物 / 线上）时调用方要退回 localStorage + IndexedDB。
 */

const BASE = '/__studio';

export type InspWriterInfo = {
  ok: boolean;
  file: string;
  uploadUrlBase: string;
};

let probe: Promise<InspWriterInfo | null> | null = null;

/** 探活（同一次会话只问一次，结果缓存）。 */
export function probeInspWriter(): Promise<InspWriterInfo | null> {
  probe ??= fetch(`${BASE}/ping`, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { ok?: boolean; insp?: Partial<InspWriterInfo> };
      // 只要有落盘目录就认为通道可用（`ok` 字段是给老接口做兼容的，不强依赖它）
      if (!data?.ok || !data.insp?.uploadUrlBase) return null;
      return { ok: true, file: data.insp.file ?? '', uploadUrlBase: data.insp.uploadUrlBase };
    })
    .catch(() => null);
  return probe;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
};

/**
 * 猜扩展名：优先用文件名后缀（用户改过名的奇葩后缀也认），否则按 MIME 推断。
 * 服务端只接受白名单扩展名，猜不出来就返回 null 让调用方走别的通道。
 */
export function guessInspExt(file: File): string | null {
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (fromName && /^(jpe?g|png|webp|avif|gif|mp3|m4a|flac|wav|ogg|aac)$/.test(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  return EXT_BY_MIME[file.type] ?? null;
}

/** 服务端落盘后的地址能不能长期引用（站内绝对路径或 http(s)）。`blob:` 一律不行。 */
export function isPortableUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^(\/|\.\/|https?:)/i.test(url);
}

/** 上传一张图 / 一段音频到 public/insp/media，失败返回 null。 */
export async function uploadInspAsset(file: File, kind: 'image' | 'audio'): Promise<string | null> {
  const ext = guessInspExt(file);
  if (!ext) return null;
  const qs = new URLSearchParams({ ext, kind, name: file.name });
  try {
    const res = await fetch(`${BASE}/insp-upload?${qs.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string } | null;
    if (!res.ok || !data?.ok) return null;
    return isPortableUrl(data.url) ? data.url : null;
  } catch {
    return null;
  }
}

/** 把整份收藏写进 public/insp/data.json。失败抛错，调用方要显示原因。 */
export async function saveInspToDisk(payload: {
  savedAt: number;
  store: unknown;
}): Promise<void> {
  const res = await fetch(`${BASE}/save-insp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string }
    | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? '写入数据文件失败。');
}

/* ------------------------------------------------------------------ */
/* 服务端链接识别（本地 dev 才有的强力通道，不受 CORS 限制）               */
/* ------------------------------------------------------------------ */

export type RemoteLinkMeta = {
  url: string;
  title: string;
  cover: string;
  desc?: string;
  site?: string;
  platform?: string;
  /** 可 iframe 嵌入的播放器地址（音乐类才有） */
  embed?: string;
  extra?: Record<string, unknown>;
};

/** 返回 null = 本地没有这个通道（生产构建），调用方应回退到公开识别服务。 */
export async function fetchLocalLinkMeta(rawUrl: string): Promise<RemoteLinkMeta | null> {
  try {
    const res = await fetch(`${BASE}/link-meta?url=${encodeURIComponent(rawUrl)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; meta?: RemoteLinkMeta };
    return data?.ok && data.meta ? data.meta : null;
  } catch {
    return null;
  }
}
