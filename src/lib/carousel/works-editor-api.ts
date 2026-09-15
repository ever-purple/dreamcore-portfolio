/**
 * 「站内编辑 → 写回代码」的前端通道。
 *
 * 只有 `vite dev` 里注册了 `studio-writer` 插件时这些接口才存在；
 * `probeWriter()` 探活失败（比如在看构建后的版本、或线上部署）就说明没有写入能力，
 * 调用方应当退回「只存在浏览器」的方案，并明确告诉用户。
 *
 * 约定：**绝不能把 `blob:` 地址写进代码文件** —— 那种地址只在当前页面会话有效，
 * 写进代码后刷新就变成死链。落盘前一律先用 `uploadAsset()` 换成真实文件地址。
 */

export type WriterInfo = {
  ok: boolean;
  file: string;
  uploadUrlBase: string;
};

const BASE = '/__studio';

let probe: Promise<WriterInfo | null> | null = null;

/** 探活（同一次会话只问一次，结果缓存）。 */
export function probeWriter(): Promise<WriterInfo | null> {
  probe ??= fetch(`${BASE}/ping`, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as WriterInfo;
      return data?.ok ? data : null;
    })
    .catch(() => null);
  return probe;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/** 猜扩展名：优先用文件名后缀，否则按 MIME 推断，最后兜底 jpg。 */
export function guessExt(blob: Blob & { name?: string }): string {
  const fromName = blob.name ? /\.([a-z0-9]+)$/i.exec(blob.name)?.[1]?.toLowerCase() : undefined;
  if (fromName) return fromName;
  return EXT_BY_TYPE[blob.type] ?? 'jpg';
}

/** 这个地址能不能长期引用（相对站内路径或 http(s)）。`blob:` / `data:` 都不行。 */
export function isPortableUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^(\/|\.\/|https?:)/i.test(url);
}

/** 上传封面 / PDF，返回站内可长期引用的地址；失败返回 null（调用方要当作"没写成"）。 */
export async function uploadAsset(
  slot: number,
  kind: 'cover' | 'pdf',
  blob: Blob & { name?: string },
): Promise<string | null> {
  const ext = guessExt(blob);
  const url = `${BASE}/upload?slot=${slot}&kind=${kind}&ext=${encodeURIComponent(ext)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: blob,
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string } | null;
    if (!res.ok || !data?.ok) return null;
    return isPortableUrl(data.url) ? data.url : null;
  } catch {
    return null;
  }
}

/** 把整份覆盖表写回 `src/data/works.local.ts`。失败抛错，调用方要显示原因。 */
export async function saveOverridesToDisk(
  slots: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${BASE}/save-work`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slots }),
  });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; file?: string }
    | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? '写入代码文件失败。');
}
