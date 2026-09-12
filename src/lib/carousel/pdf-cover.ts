/**
 * 把 PDF 的某一页渲染成 <img>，用于木马相框封面 / 详情页高光图。
 * 「封面就用 PDF 首页」 —— 上传一个 PDF，相框正反面都长同一张图，
 * 用户在右侧看的就是它，再也不用单独传封面图。
 *
 * source 既可以是 Blob（上传的文件），也可以是 asset URL（种子项目的 deck）。
 */
import * as pdfjsLib from 'pdfjs-dist';
// pdfjs 在浏览器里需要 worker，告诉它去哪找
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();
// 图片（Blob / asset 路径）直接转成可用的 <img> 地址，无需 pdfjs 解码
const urlCache = new Map<string, string>();
const urlPending = new Map<string, Promise<string | null>>();

/** source 是图片（上传的图或图片 asset）时直接走这里，不交给 pdfjs 解析。 */
function isImageSource(source: Blob | string): boolean {
  if (source instanceof Blob) return source.type.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(source);
}

async function renderPage(
  source: Blob | string,
  cacheKey: string,
  page: number,
): Promise<HTMLImageElement | null> {
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const inflight = pending.get(cacheKey);
  if (inflight) return inflight;

  const task = (async () => {
    let buf: ArrayBuffer;
    if (typeof source === 'string') {
      const res = await fetch(source);
      buf = await res.arrayBuffer();
    } else {
      buf = await source.arrayBuffer();
    }
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const pageNum = Math.min(Math.max(page, 1), doc.numPages);
    const pg = await doc.getPage(pageNum);
    const baseViewport = pg.getViewport({ scale: 1 });
    const scale = Math.max(440 / baseViewport.width, 520 / baseViewport.height);
    const viewport = pg.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await pg.render({ canvasContext: ctx, viewport, canvas }).promise;
    pg.cleanup();
    const img = new Image();
    img.src = canvas.toDataURL('image/jpeg', 0.86);
    await img.decode();
    cache.set(cacheKey, img);
    return img;
  })().catch(() => null);

  pending.set(cacheKey, task);
  return task;
}

export async function pdfFirstPage(
  source: Blob | string,
  cacheKey: string,
  page = 1,
): Promise<HTMLImageElement | null> {
  return renderPage(source, cacheKey, page);
}

/**
 * 给缩略图条 / 详情页右侧高光图用的：把 PDF 指定页渲染成一张 <img> 的 data URL。
 * 缩略图是 <img>，不能直接吃 PDF 的 blob URL（会裂），所以这里返回能直接塞进 src 的图。
 * 走和相框同一份缓存（同一 cacheKey），不会重复解码。
 */
export async function pdfThumbUrl(
  source: Blob | string,
  cacheKey: string,
  page = 1,
): Promise<string | null> {
  // 图片源：Blob 直接造 objectURL（按 cacheKey 去重），图片路径直接返回
  if (isImageSource(source)) {
    const hit = urlCache.get(cacheKey);
    if (hit) return hit;
    const inflight = urlPending.get(cacheKey);
    if (inflight) return inflight;
    const task = (async () => {
      if (source instanceof Blob) {
        const url = URL.createObjectURL(source);
        urlCache.set(cacheKey, url);
        return url;
      }
      return source as string;
    })();
    urlPending.set(cacheKey, task);
    return task;
  }
  const img = await pdfFirstPage(source, cacheKey, page);
  return img ? img.src : null;
}

/** 拿不到 PDF 指定页时画一张 "PDF" 文件图标占位 */
export function pdfFallbackImage(
  code: string,
  title: string,
): HTMLImageElement {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 640;
  const c = cv.getContext('2d')!;
  // 米色卡
  c.fillStyle = '#efe6d6';
  c.fillRect(0, 0, 512, 640);
  // 折角
  c.fillStyle = '#d6c8aa';
  c.beginPath();
  c.moveTo(420, 80);
  c.lineTo(460, 120);
  c.lineTo(460, 640);
  c.lineTo(420, 640);
  c.closePath();
  c.fill();
  c.fillStyle = '#c6b79c';
  c.beginPath();
  c.moveTo(420, 80);
  c.lineTo(460, 120);
  c.lineTo(420, 120);
  c.closePath();
  c.fill();
  // PDF 字样
  c.fillStyle = '#a07c4d';
  c.font =
    'bold 64px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('PDF', 220, 380);
  // 档案编号
  c.fillStyle = '#7d8f72';
  c.font = '22px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  c.fillText(code, 220, 430);
  // 标题（换行）
  c.fillStyle = '#5d6e57';
  c.font = '24px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const lines = wrapText(c, title || '未命名项目', 360);
  lines.slice(0, 3).forEach((line, i) => c.fillText(line, 220, 470 + i * 30));
  const img = new Image();
  img.src = cv.toDataURL();
  return img;
}

function wrapText(
  c: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (c.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}