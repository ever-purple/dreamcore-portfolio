/**
 * 提交的项目存在浏览器 IndexedDB 里 —— 与 carousel-lamp 的 photo-storage 同一套路。
 *
 * PDF 与封面以 Blob 保存，刷新后仍在；读取时用 `objectUrl()` 换成一个可播放的
 * 临时地址（旧地址会被回收，不会一直堆在内存里）。
 */

export type SavedProject = {
  /** 相框序号（0 起） */
  slot: number;
  code: string;
  title: string;
  /** 项目角色 */
  role?: string;
  client?: string;
  year?: string;
  /** 项目阐述 */
  summary: string;
  /** 空格分隔的标签，如 "#TVC #品牌" */
  tags: string;
  /** 高光图（上传的图片），比 PDF 更轻、更适合做封面 */
  image: Blob | null;
  /** 可选完整 PDF（仅下载用，不再内嵌查看器） */
  pdf: Blob | null;
  pdfName: string;
  /** 结构化展示文案 */
  sections: { key: string; heading: string; body: string }[];
  /** 已填过内容 = true（用于区分"空槽位"和"已提交"） */
  filled: boolean;
};

const DB_NAME = 'dreamcore-carousel-projects';
const STORE = 'projects';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'slot' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('无法打开本机项目存储，请检查浏览器的网站存储设置。'));
    request.onblocked = () =>
      reject(new Error('项目存储暂时被其他页面占用，请关闭其他页面后重试。'));
  });
}

export async function readSavedProjects(): Promise<SavedProject[]> {
  let db: IDBDatabase;
  try {
    db = await openStore();
  } catch {
    return [];
  }
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      tx.oncomplete = () => resolve(request.result as SavedProject[]);
      tx.onerror = tx.onabort = () => reject(new Error('读取失败'));
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function saveProjectLocally(project: SavedProject): Promise<void> {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
      try {
        tx.objectStore(STORE).put(project);
      } catch {
        tx.abort();
        reject(new Error('项目未能保存，内容没有改变。'));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(new Error('项目未能保存到本机，可能存储空间不足。请释放空间后重试。'));
    });
  } finally {
    db.close();
  }
}

export async function clearProjectLocally(slot: number): Promise<void> {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('清空没有成功，请重试。'));
    });
  } finally {
    db.close();
  }
}

/* ---------- Blob → 可用的临时地址 ---------- */

const urls = new Map<string, string>();

/** 同一个 key 重复调用会回收上一次的地址，避免内存泄漏。 */
export function objectUrl(key: string, blob: Blob | null): string | null {
  const previous = urls.get(key);
  if (previous) {
    URL.revokeObjectURL(previous);
    urls.delete(key);
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

export function revokeAllUrls() {
  urls.forEach((url) => URL.revokeObjectURL(url));
  urls.clear();
}
