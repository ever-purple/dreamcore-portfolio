/**
 * 手账编辑器 —— IndexedDB 持久化
 * =============================================================================
 * 用户口径（2026-09-23）：
 *   「改动经防抖后即时写入 IndexedDB，刷新保留」
 *   「保存后网站直接更新成保存后的样子，刷新后网站是我编辑后的样子，不需要自己
 *     修改代码」
 *
 * 于是这里存**两样东西**、放**两个 store**：
 *   · `doc`   —— 单条记录（id='main'），就是 DiaryDoc（纸张 / 图层 / 文字覆盖）。
 *                 小、纯 JSON、可序列化 → 直接 put。
 *   · `media` —— 用户上传的图片 / 视频 Blob。**必须跟 doc 分表**：
 *                 把 Blob 塞进 doc 会让每次改一个字都要重写整份（含几十 MB 视频），
 *                 而且结构化克隆 Blob 很贵。分表后 doc 永远轻量。
 *
 * 读回时：图层里的 `mediaId` → 换一个 `blob:` 地址挂到 `src` 上（见 `hydrateLayer`）。
 * ⚠️ blob 地址与「协议+端口」无关、但与**页面会话**绑定，所以不能存进库里，
 *    每次都现场换（同 `lib/carousel/project-storage` 的 `objectUrl` 套路）。
 */

import type { DiaryDoc, DiaryLayer, ElImage, ElOverride, ElTextStyle, FrameStyle, PageEdit, RichText, TextAlign, TextBoxStyle } from './types';
import {
  FRAME_STYLES,
  MAX_EL_SIZE,
  MAX_TEXT_SIZE,
  MIN_EL_SIZE,
  MIN_TEXT_SIZE,
  TEXT_BOX_STYLES,
  clampCrop,
  emptyDoc,
  isIdentityEl,
} from './types';

const DB_NAME = 'dreamcore-diary';
const DB_VER = 1;
const DOC_STORE = 'doc';
const MEDIA_STORE = 'media';
const DOC_KEY = 'main';

export type MediaRecord = {
  id: string;
  kind: 'image' | 'video';
  name: string;
  blob: Blob;
};

/* ============================ 连接 ============================ */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB。'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('无法打开本机日记存储（可能是浏览器的网站存储被禁用了）。'));
    req.onblocked = () => reject(new Error('日记存储被其他标签页占用，请关掉其它标签页后重试。'));
  });
  /* 失败就别把坏 promise 缓存住，否则一次隐私模式失败会永久卡死 */
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction, failMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error(failMessage));
  });
}

/* ============================ doc ============================ */

/** 结构文字样式覆盖（ElOverride.text）的清洗。
 *  逐项校验：坏项丢掉、好项留下；三项全空返回 null（调用方据此不写这条字段）。
 */
/**
 * 对齐值的合法性判断。
 * 用户 2026-09-23：「把文字块做成ppt那种框，可以调整对齐」。
 * 只认这四个值 —— 手改过的库记录里出现 `text-align: url(...)` 这种事不能放过去。
 */
function isTextAlign(v: unknown): v is TextAlign {
  return v === 'left' || v === 'center' || v === 'right' || v === 'justify';
}

/**
 * 框样式的合法性判断。
 *
 * 结构元素现在也能吃「图片框样式 / 文字框样式」（用户 2026-09-23：「放边框没反应」），
 * 所以 ElOverride 里多出 `frame` / `tbox` 两项，同样要过白名单。
 * ⚠️ 白名单直接由常量表反查，**不手抄字面量** —— 以后加新样式不会忘同步。
 */
const FRAME_IDS = new Set<string>(FRAME_STYLES.map((f) => f.id));
const TBOX_IDS = new Set<string>(TEXT_BOX_STYLES.map((b) => b.id));
function isFrameStyle(v: unknown): v is FrameStyle {
  return typeof v === 'string' && FRAME_IDS.has(v);
}
function isTextBoxStyle(v: unknown): v is TextBoxStyle {
  return typeof v === 'string' && TBOX_IDS.has(v);
}

function normElText(raw: unknown): ElTextStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as ElTextStyle;
  const out: ElTextStyle = {};
  if (typeof t.font === 'string' && t.font) out.font = t.font;
  const size = Number(t.size);
  if (Number.isFinite(size) && size > 0) {
    out.size = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(size)));
  }
  if (typeof t.color === 'string' && t.color.trim()) out.color = t.color.trim();
  if (isTextAlign(t.align)) out.align = t.align;
  return Object.keys(out).length ? out : null;
}

/** 槽级文字覆盖表（ElOverride.texts）的清洗：逐个槽过 normElText，空项丢掉 */
function normElTexts(raw: unknown): Record<string, ElTextStyle> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, ElTextStyle> = {};
  for (const [slot, v] of Object.entries(raw as Record<string, unknown>)) {
    const one = normElText(v);
    if (one) out[slot] = one;
  }
  return Object.keys(out).length ? out : null;
}

/* ============================ 富文本槽内容的白名单清洗 ============================ */

/**
 * 允许保留的行内标签。
 * 用户改局部的颜色 / 字号 / 字体之后，槽内容里会出现这些小标记。
 * **只留这几个**：`<img onerror>`、`<svg>`、`<iframe>`、`<a href="javascript:">`
 * 这类一律剥掉 —— 这份 HTML 是要走 `dangerouslySetInnerHTML` 的。
 */
const RICH_TAGS = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'FONT', 'SUP', 'SUB', 'BR']);
/** 允许保留的 CSS 声明（只留样式相关的这几个，值再由下面的值过滤把关） */
const RICH_PROPS = new Set(['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-decoration']);

function safeCssValue(v: string): boolean {
  if (/url\s*\(|expression\s*\(|javascript:|[<>]/i.test(v)) return false;
  /* 只允许"颜色 / 长度 / 字体名 / 关键字"这几种字符 */
  return /^[#0-9a-zA-Z\s,.%()\-'"、。\u4e00-\u9fa5]+$/.test(v);
}

/**
 * 把用户编辑产生的 HTML 洗成"只有行内样式标记"的安全子集。
 * 用 DOM 解析（不渲染）而不是正则：`<span style="color:red" onclick=x>` 这种
 * 属性里的花活正则很难写对，交给解析器最稳。
 */
export function sanitizeRichHtml(raw: string): string {
  const host = document.createElement('div');
  host.innerHTML = raw;
  const walk = (node: Node, into: HTMLElement) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        into.appendChild(document.createTextNode(child.nodeValue ?? ''));
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as HTMLElement;
      if (!RICH_TAGS.has(el.tagName)) {
        /* 不认识的标签：**只保留里面的文字**，标签本身丢掉（don't 让 <img> 溜进去） */
        walk(el, into);
        return;
      }
      const next = document.createElement(el.tagName === 'FONT' ? 'span' : el.tagName.toLowerCase());
      el.style?.cssText
        ?.split(';')
        .forEach((decl) => {
          const i = decl.indexOf(':');
          if (i < 0) return;
          const k = decl.slice(0, i).trim().toLowerCase();
          const v = decl.slice(i + 1).trim();
          if (RICH_PROPS.has(k) && safeCssValue(v)) next.style.setProperty(k, v);
        });
      walk(el, next);
      into.appendChild(next);
    });
  };
  const out = document.createElement('div');
  walk(host, out);
  return out.innerHTML;
}

/** 槽内容清洗：纯文本原样（但要限长）；`{html}` 过一遍白名单 */
function normSlotText(raw: unknown): string | RichText | null {
  if (typeof raw === 'string') return raw.slice(0, 20000);
  if (raw && typeof raw === 'object' && typeof (raw as RichText).html === 'string') {
    const html = sanitizeRichHtml((raw as RichText).html).slice(0, 40000);
    /* 洗完只剩纯文字 → 退回字符串形状（下一层判断、渲染路径都更简单） */
    if (!/<[a-z]/i.test(html)) return html;
    return { html };
  }
  return null;
}

/** 缺字段的旧记录用默认值补齐 —— 以后加字段不用写迁移脚本。 */
function normalizeDoc(raw: unknown): DiaryDoc {
  const base = emptyDoc();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<DiaryDoc>;
  const pages: Record<string, PageEdit> = {};
  /* 逐页过一遍：结构元素的覆盖（els）与组（groups）是 2026-09-23 新加的字段，
     旧的库记录里没有、也可能因为手改过 JSON 而不合法 —— 这里做一次轻量清洗，
     坏数据直接丢掉而不是让它把整页渲染弄崩。 */
  if (r.pages && typeof r.pages === 'object') {
    for (const [id, p] of Object.entries(r.pages as Record<string, PageEdit>)) {
      if (!p || typeof p !== 'object') continue;
      const page: PageEdit = { ...p, layers: Array.isArray(p.layers) ? p.layers : [] };
      /* 文字覆盖：值可能是纯文本，也可能是"局部改过样式"的 {html}（见 RichText）——
         后者要过白名单，不然一份被手改过的库记录就能往页面里塞任意 HTML。 */
      if (p.text && typeof p.text === 'object') {
        const txt: Record<string, string | RichText> = {};
        for (const [k, v] of Object.entries(p.text)) {
          const clean = normSlotText(v);
          if (clean !== null) txt[k] = clean;
        }
        if (Object.keys(txt).length) page.text = txt;
        else delete page.text;
      }
      if (p.els && typeof p.els === 'object') {
        const els: Record<string, ElOverride> = {};
        for (const [k, v] of Object.entries(p.els)) {
          if (!v || typeof v !== 'object') continue;
          const num = (x: unknown, d: number) => (x === undefined || x === null ? d : Number(x));
          const n = num(v.dx, 0);
          const m = num(v.dy, 0);
          const rot = num(v.rot, 0);
          const sc = num(v.sc, 1);
          if (![n, m, rot, sc].every(Number.isFinite)) continue;
          const text = normElText(v.text);
          const texts = normElTexts(v.texts);
          const z = Number.isFinite(Number(v.z)) ? { z: Number(v.z) } : null;
          /* 自由长宽（2026-09-23 新加）：坏值当作"没设过"，不要拿 NaN 去写 CSS */
          const size = (x: unknown) => {
            const q = Number(x);
            if (!Number.isFinite(q) || q <= 0) return null;
            return Math.min(MAX_EL_SIZE, Math.max(MIN_EL_SIZE, q));
          };
          const ew = size(v.w);
          const eh = size(v.h);
          /* 结构元素上的框样式（见 types.ts 的 ElOverride.frame / tbox） */
          const frame = isFrameStyle(v.frame) ? v.frame : null;
          const tbox = isTextBoxStyle(v.tbox) ? v.tbox : null;
          const draft: ElOverride = {
            dx: n,
            dy: m,
            rot,
            sc,
            ...(ew !== null ? { w: ew } : null),
            ...(eh !== null ? { h: eh } : null),
            ...(z ?? null),
            ...(text ? { text } : null),
            ...(texts ? { texts } : null),
            ...(frame ? { frame } : null),
            ...(tbox ? { tbox } : null),
          };
          if (isIdentityEl(draft)) continue;
          els[k] = draft;
        }
        if (Object.keys(els).length) page.els = els;
        else delete page.els;
      }
      /* 结构元素里换过的图片：只认"有 mediaId"的记录（src 是会话内的 blob 地址，
         刷新后必须由 hydrateDoc 重新换出来，所以这里不校验它） */
      if (p.imgs && typeof p.imgs === 'object') {
        const imgs: Record<string, ElImage> = {};
        for (const [k, v] of Object.entries(p.imgs)) {
          if (!v || typeof v !== 'object' || typeof v.mediaId !== 'string' || !v.mediaId) continue;
          imgs[k] = {
            mediaId: v.mediaId,
            src: typeof v.src === 'string' ? v.src : '',
            nw: Number.isFinite(Number(v.nw)) ? Number(v.nw) : 1,
            nh: Number.isFinite(Number(v.nh)) ? Number(v.nh) : 1,
          };
        }
        if (Object.keys(imgs).length) page.imgs = imgs;
        else delete page.imgs;
      }
      if (Array.isArray(p.groups)) {
        const groups = p.groups.filter(
          (g) => g && typeof g.id === 'string' && Array.isArray(g.members) && g.members.length >= 2,
        );
        if (groups.length) page.groups = groups;
        else delete page.groups;
      }
      pages[id] = page;
    }
  }
  return {
    v: 1,
    order: Array.isArray(r.order) ? r.order.filter((x): x is string => typeof x === 'string') : [],
    extraPages: Array.isArray(r.extraPages)
      ? r.extraPages.filter((x): x is string => typeof x === 'string')
      : [],
    pages,
  };
}

export async function loadDoc(): Promise<DiaryDoc> {
  try {
    const db = await openDb();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, 'readonly');
      const req = tx.objectStore(DOC_STORE).get(DOC_KEY);
      req.onsuccess = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(new Error('读取日记失败。'));
    });
    return normalizeDoc(raw);
  } catch {
    /* 读不到（首次访问 / 隐私模式 / 存储被禁）就当空文档，页面照常可用 */
    return emptyDoc();
  }
}

export async function saveDoc(doc: DiaryDoc): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DOC_STORE, 'readwrite', { durability: 'relaxed' });
  tx.objectStore(DOC_STORE).put({ id: DOC_KEY, ...doc });
  await txDone(tx, '日记没能保存到本机（可能存储空间不足）。');
}

export async function clearDoc(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DOC_STORE, 'readwrite');
  tx.objectStore(DOC_STORE).delete(DOC_KEY);
  await txDone(tx, '清空失败。');
}

/* ============================ media ============================ */

export async function putMedia(rec: MediaRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(MEDIA_STORE, 'readwrite', { durability: 'relaxed' });
  tx.objectStore(MEDIA_STORE).put(rec);
  await txDone(tx, '素材没能存到本机（文件可能太大）。');
}

export async function getMedia(id: string): Promise<MediaRecord | null> {
  try {
    const db = await openDb();
    return await new Promise<MediaRecord | null>((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const req = tx.objectStore(MEDIA_STORE).get(id);
      req.onsuccess = () => resolve((req.result as MediaRecord) ?? null);
      tx.onerror = tx.onabort = () => reject(new Error('读取素材失败。'));
    });
  } catch {
    return null;
  }
}

export async function listMediaIds(): Promise<string[]> {
  try {
    const db = await openDb();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const req = tx.objectStore(MEDIA_STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      tx.onerror = tx.onabort = () => reject(new Error('读取素材列表失败。'));
    });
  } catch {
    return [];
  }
}

export async function deleteMedia(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    tx.objectStore(MEDIA_STORE).delete(id);
    await txDone(tx, '删除素材失败。');
  } catch {
    /* 忽略：媒体删不掉不影响文档可用性 */
  }
}

/* ============================ blob 地址登记 ============================ */

const urls = new Map<string, string>();

/** mediaId → 可用的 blob: 地址；同一 id 重复调用会回收上一次的。 */
export function mediaUrl(id: string, blob: Blob): string {
  const prev = urls.get(id);
  if (prev) URL.revokeObjectURL(prev);
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export function forgetMediaUrl(id: string) {
  const prev = urls.get(id);
  if (prev) {
    URL.revokeObjectURL(prev);
    urls.delete(id);
  }
}

/**
 * 把 doc 里所有 `mediaId` 的图层换成可用地址。
 * 读不到（媒体被清 / 换了浏览器）就**保留图层、src 留空** —— 图会显示成占位框，
 * 但用户在编辑器里能看见"这里原本有东西"并删掉它，比静默丢内容好。
 */
export async function hydrateLayers(layers: DiaryLayer[]): Promise<DiaryLayer[]> {
  return Promise.all(
    layers.map(async (l) => {
      if (l.type === 'text' || !l.mediaId) return l;
      const rec = await getMedia(l.mediaId);
      if (!rec) return { ...l, src: '' };
      const url = mediaUrl(l.mediaId, rec.blob);
      const base = { ...l, src: url, nw: l.nw || 1, nh: l.nh || 1 };
      if (l.type !== 'image') return base;
      /* 四格相框里**单独换过**的格子也有自己的 mediaId —— 同样要现场换地址。
         读不到的格子把 src 留空：那一格显示占位蓝底，其余格子不受影响。 */
      if (Array.isArray(l.quadCells) && l.quadCells.some((c) => c?.mediaId)) {
        const cells = await Promise.all(
          l.quadCells.map(async (c) => {
            if (!c?.mediaId) return c ?? null;
            const m = await getMedia(c.mediaId);
            return m ? { ...c, src: mediaUrl(c.mediaId, m.blob) } : { ...c, src: '' };
          }),
        );
        return { ...base, quadCells: cells, crop: clampCrop(l.crop) };
      }
      return { ...base, crop: clampCrop(l.crop) };
    }),
  );
}

/**
 * 结构元素里换过的图：`mediaId` → 现场 `blob:` 地址。
 * 和图层一样，读不到（素材被清 / 换浏览器）就把 `src` 留空 —— 元素会显示成占位框，
 * 但用户在编辑器里能看见"这里本来有图"并重新换一张，比静默丢内容好。
 */
async function hydrateElImages(imgs: Record<string, ElImage> | undefined): Promise<Record<string, ElImage> | undefined> {
  if (!imgs) return undefined;
  const entries = await Promise.all(
    Object.entries(imgs).map(async ([id, rec]) => {
      const m = await getMedia(rec.mediaId);
      if (!m) return [id, { ...rec, src: '' }] as const;
      return [id, { ...rec, src: mediaUrl(rec.mediaId, m.blob), nw: rec.nw || 1, nh: rec.nh || 1 }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function hydrateDoc(doc: DiaryDoc): Promise<DiaryDoc> {
  const entries = await Promise.all(
    Object.entries(doc.pages).map(
      async ([id, page]) =>
        [
          id,
          {
            ...page,
            layers: await hydrateLayers(page.layers ?? []),
            imgs: await hydrateElImages(page.imgs),
            els: migrateSplitBlocks(page.els),
          },
        ] as const,
    ),
  );
  return { ...doc, pages: Object.fromEntries(entries) };
}

/**
 * 一次性迁移：小标题 / 正文从**同一个结构元素**拆成两个（2026-09-24）。
 *
 * 用户诉求：「小标题和正文没有分开，想调整小标题和正文之间的间距都没法调，
 * 他俩还是一起移动的」—— 原来每段是 `<El slot="blockN">`（h3 小标题 + p 正文），
 * 拆分后变成 `blockN`（小标题）+ `blockNt`（正文）两个平级元素。
 *
 * ⚠️ 用户之前对旧 `blockN` 做过的**所有覆盖**必须跟着搬家，否则拆分一上线
 *    之前调的字体 / 字号 / 位移全部错位：
 *    · 变换字段（dx/dy/rot/sc/w/h/z）与元素级 text / frame / tbox → **两边都复制**，
 *      拆分瞬间两块还叠在原块的位置上，视觉与拆分前一致，之后用户自己分开拖；
 *    · 槽级 `texts['blockN.text']`（正文的字体字号）→ 归正文 `blockNt`；
 *    · 槽级 `texts['blockN.sub']`（小标题的）→ 原地留在 `blockN`。
 *
 * 幂等：`blockNt` 已存在（新数据 / 迁移过）就跳过；`blockN` 上没有任何
 * 有效覆盖时也不凭空造记录。顺便清掉拆分后变 identity 的空壳记录。
 */
export function migrateSplitBlocks(
  els?: Record<string, ElOverride>,
): Record<string, ElOverride> | undefined {
  if (!els) return undefined;
  let changed = false;
  const next: Record<string, ElOverride> = { ...els };
  for (const [key, ov] of Object.entries(els)) {
    if (!/^block\d+$/.test(key)) continue;
    const tKey = `${key}t`;
    if (next[tKey]) continue;
    const bodySlot = `${key}.text`;
    const bodyOv = ov.texts?.[bodySlot];
    const hasBody = !!bodyOv;
    const hasText = !!ov.text && Object.keys(ov.text).length > 0;
    const hasTransform =
      !!ov.dx ||
      !!ov.dy ||
      !!ov.rot ||
      (ov.sc !== undefined && ov.sc !== 1) ||
      ov.w !== undefined ||
      ov.h !== undefined ||
      ov.z !== undefined;
    if (!hasBody && !hasText && !hasTransform) continue;
    const t: ElOverride = {
      ...ov,
      texts: hasBody ? { [bodySlot]: { ...bodyOv } } : undefined,
    };
    next[tKey] = t;
    if (hasBody) {
      const texts = { ...(ov.texts ?? {}) };
      delete texts[bodySlot];
      next[key] = { ...ov, texts: Object.keys(texts).length ? texts : undefined };
    }
    if (isIdentityEl(next[key])) delete next[key];
    changed = true;
  }
  return changed ? next : els;
}

/* ============================ 防抖保存 ============================ */

/**
 * 防抖保存器：改动来了先攒 400ms，期间只保留最后一份。
 * 用户原话「改动经防抖后即时写入 IndexedDB」—— 400ms 是"停手即落盘"的手感，
 * 同时拖动过程中不会每帧写库。
 */
export function createSaver(delay = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: DiaryDoc | null = null;
  let inflight: Promise<void> = Promise.resolve();
  const listeners = new Set<(state: SaveState) => void>();

  const emit = (state: SaveState) => listeners.forEach((fn) => fn(state));

  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return inflight;
    const doc = pending;
    pending = null;
    emit('saving');
    inflight = inflight
      .then(() => saveDoc(doc))
      .then(() => emit('saved'))
      .catch((err: unknown) => emit({ error: err instanceof Error ? err.message : '保存失败' }));
    return inflight;
  }

  return {
    push(doc: DiaryDoc) {
      pending = doc;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
      emit('dirty');
    },
    flush,
    onState(fn: (state: SaveState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type SaveState = 'dirty' | 'saving' | 'saved' | { error: string };

/* ============================ 工具：量素材尺寸 ============================ */

/** 读图片原始像素尺寸（上传后算图层高度用）。 */
export function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = src;
  });
}

/**
 * 视频：读尺寸 + 抽一帧当封面。
 * 抽帧是**必须的**：翻页层把一页渲染 12 份，真 `<video>` ×12 太重；
 * 静态态一律渲染 poster（见 LayerView 的注释）。
 */
export function videoProbe(src: string): Promise<{ w: number; h: number; poster?: string }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const done = (out: { w: number; h: number; poster?: string }) => resolve(out);
    v.onloadeddata = () => {
      const w = v.videoWidth || 1;
      const h = v.videoHeight || 1;
      try {
        v.currentTime = Math.min(0.1, (v.duration || 1) * 0.1);
      } catch {
        done({ w, h });
      }
      v.onseeked = () => {
        try {
          const c = document.createElement('canvas');
          const scale = Math.min(1, 720 / Math.max(w, h));
          c.width = Math.max(1, Math.round(w * scale));
          c.height = Math.max(1, Math.round(h * scale));
          const ctx = c.getContext('2d');
          if (!ctx) return done({ w, h });
          ctx.drawImage(v, 0, 0, c.width, c.height);
          done({ w, h, poster: c.toDataURL('image/jpeg', 0.72) });
        } catch {
          done({ w, h });
        }
      };
    };
    v.onerror = () => done({ w: 1, h: 1 });
    /* 兜底：某些编码抽帧事件不齐，3s 后直接给尺寸 */
    setTimeout(() => done({ w: v.videoWidth || 1, h: v.videoHeight || 1 }), 3000);
    v.src = src;
  });
}
