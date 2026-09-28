/**
 * 上传文件的本地落盘（IndexedDB）。
 *
 * 背景：uploadFile 之前返回 URL.createObjectURL() —— 那是「会话临时地址」，
 * 刷新即失效，卡片就变裂图 / 歌放不出来。现在把文件实体存进 IndexedDB，
 * 数据里只落一个稳定引用 `idb:<key>`，渲染时再换回临时的 object URL。
 *
 * 约定：数据（localStorage `dreamcore:insp-store-v1`）里永远存 `idb:` 引用；
 * 引用换 URL 只发生在视图层（refresh 时 resolveIdbRefs），绝不写回数据。
 */

const DB_NAME = 'dreamcore-insp-blobs';
const STORE = 'files';
const VERSION = 1;

/** 内存缓存：key → objectURL，避免同一 blob 反复创建 URL */
const urlCache = new Map<string, string>();

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

/** 是否为本模块的落盘引用 */
export function isIdbRef(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('idb:');
}

/**
 * 存入一个文件，返回稳定引用 `idb:<key>`。
 * key 可省略（自动生成）；失败时抛错，调用方自行决定降级。
 */
export async function putBlob(blob: Blob, key?: string): Promise<string> {
  const k = key ?? `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
  });
  db.close();
  return `idb:${k}`;
}

/** 引用 → 可直接喂给 <img>/<audio> 的 object URL（带缓存；取不到回 null）。 */
export async function getBlobURL(ref: string): Promise<string | null> {
  const key = ref.slice(4);
  const hit = urlCache.get(key);
  if (hit) return hit;
  try {
    const db = await openDB();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
    });
    db.close();
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * 批量解析一组条目里指定字段的 `idb:` 引用（原地字段的浅拷贝替换）。
 * 例：resolveIdbRefs(music, ['src', 'cover'])
 */
export async function resolveIdbRefs<T extends object>(items: T[], fields: Array<keyof T>): Promise<T[]> {
  if (!items.some((it) => fields.some((f) => isIdbRef(it[f])))) return items;
  const out: T[] = [];
  for (const it of items) {
    let cur = it;
    for (const f of fields) {
      const v = cur[f];
      if (!isIdbRef(v)) continue;
      const url = await getBlobURL(v);
      if (url) {
        cur = cur === it ? { ...it } : cur;
        (cur as Record<string, unknown>)[f as string] = url;
      }
    }
    out.push(cur);
  }
  return out;
}
