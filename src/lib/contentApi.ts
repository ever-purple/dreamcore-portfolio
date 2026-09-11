import { MOCK } from '@/data/inspiration';
import type { LinkItem, MusicItem, ProjectItem, SkillItem, VisionItem } from '@/data/inspiration';

/**
 * 内容读写边界（mock 版）。
 *
 * 设计目标：把所有「会动数据」的读写收口到这里，界面层只认 getCollection / addItem /
 * removeItem，永远不直接 import 写死的数组。以后接 Supabase / Vercel Blob / 自有 API，
 * 只要改本文件，组件一行都不用动。
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

/** 内存里的「云端数据」：初始来自 MOCK。挂到服务器后，这里换成 fetch / PATCH 的结果。 */
let store: Store = structuredClone(MOCK) as unknown as Store;

/** 读某一类数据（界面渲染用）。返回类型随 key 收窄为具体 item 数组。 */
export function getCollection<K extends CollectionKey>(key: K): Store[K] {
  return store[key];
}

export type UploadResult = { url: string; name: string };

/**
 * 上传单个文件。现在 mock：用浏览器临时 URL 占位（仅当前会话有效）。
 * 对接云端时只改这一处，例如：
 *
 *   const file = await supabase.storage
 *     .from('media')
 *     .upload(`${Date.now()}-${file.name}`, file);
 *   const { data } = supabase.storage.from('media').getPublicUrl(file.path);
 *   return { url: data.publicUrl, name: file.name };
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  // TODO(cloud): 换成真实上传，再把返回的 CDN 地址填进卡片数据
  await new Promise((r) => setTimeout(r, 400)); // 模拟网络往返
  return { url: URL.createObjectURL(file), name: file.name };
}

export type LinkMeta = { title: string; cover: string; url: string };

/** 识别链接时用的占位封面池（真实实现会换成抓回来的 og:image） */
const COVER_POOL = [
  '/frames/0001.jpg',
  '/frames/0026.jpg',
  '/frames/0051.jpg',
  '/frames/0076.jpg',
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

/**
 * 粘贴链接 → 自动识别标题与封面。
 *
 * 现在 mock：从 URL 里推断一个标题、循环取一张占位封面。
 * 对接云端时只改这一处 —— 推荐做法是让后端代拉目标页的 <title> / og:image
 * （浏览器直连会被 CORS 拦住），例如：
 *
 *   const r = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
 *   const { title, image } = await r.json();
 *   return { title, cover: image, url };
 */
export async function fetchLinkMeta(rawUrl: string): Promise<LinkMeta> {
  await new Promise((r) => setTimeout(r, 380)); // 模拟抓取
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
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
  const title = pretty ? pretty.replace(/\b\w/g, (c) => c.toUpperCase()) : host;
  // 用 URL 做稳定哈希，保证同一链接每次识别到同一张封面
  const hash = [...url].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const cover = COVER_POOL[hash % COVER_POOL.length];
  return { title, cover, url };
}

/** 新增一条（mock：写进内存 store） */
export async function addItem(key: CollectionKey, item: AnyItem): Promise<void> {
  const list = store[key] as AnyItem[];
  store = { ...store, [key]: [...list, item] as Store[typeof key] };
}

/** 按 id 删除一条（mock：从内存 store 滤掉） */
export async function removeItem(key: CollectionKey, id: string): Promise<void> {
  const list = store[key] as AnyItem[];
  store = { ...store, [key]: list.filter((x) => (x as { id: string }).id !== id) as Store[typeof key] };
}
