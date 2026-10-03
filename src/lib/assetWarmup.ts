const fileWarmups = new Map<string, Promise<void>>();

/**
 * 完整读取资源并复用同一条进行中的请求，让随后使用相同 URL 的模型加载器命中缓存。
 */
export function warmFile(src: string, init?: RequestInit): Promise<void> {
  const existing = fileWarmups.get(src);
  if (existing) return existing;

  const request = fetch(src, { cache: 'force-cache', ...init })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Warmup failed: ${response.status}`);
      await response.arrayBuffer();
    })
    .catch(() => {});

  fileWarmups.set(src, request);
  return request;
}
