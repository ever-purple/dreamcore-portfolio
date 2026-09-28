/**
 * 手账编辑器 —— 页面标识与页序
 * =============================================================================
 * 页面本来就是「代码里的 DIARY_SHEETS 摊出来的」—— 要让它可编辑，第一件事是给
 * 每一页一个**稳定 id**（不随数组下标变，否则以后往中间插一页，所有编辑都会错位）。
 *
 *   cover                封面
 *   c{篇号}-head         某篇的篇首页
 *   c{篇号}-s{板块号}    某篇的板块页
 *   c{篇号}-review       某篇的复盘页
 *   x{n}                 用户在编辑器里「加页」新建的空白页
 *
 * ## 删页 = 从页序里摘掉，**不销毁内容**（重要）
 * 用户 2026-09-23 原话：「现在的这些内容都不要删除」。
 * 所以「删页」只是把 id 从 `doc.order` 里拿掉 ——
 *   · 代码里的 DIARY_SHEETS / diary.ts 一个字都不动；
 *   · doc.pages 里那一页的编辑也留着；
 * 于是「恢复页」随时能原样放回来（见工具栏的页面管理组）。
 * 这比"二次确认后真删"更符合用户的意图，也更安全。
 */

import { DIARY_SHEETS, DIARY_ENTRIES, type DiarySheet } from '@/data/diary';
import type { DiaryDoc } from './types';

/**
 * 封底页的 id（2026-09-25 用户要求：「内页最后一页下一页回到封底」）。
 * 和封面一样是**结构页**：受保护、不可删，也不进 DIARY_SHEETS（它没有 `DiarySheet`
 * 定义，渲染层按 id 特判，见 NotebookOverlay 的 renderSheet）。
 *
 * ⚠️ 它在页序里的位置必须是**最后一位**：跨配对（left=2s-1 / right=2s）是按下标
 *    奇偶算的，把封底插在中间会让后面所有跨的左右两页整体错开一页。
 */
export const BACK_PAGE_ID = 'back';

export function sheetId(sheet: DiarySheet): string {
  switch (sheet.kind) {
    case 'cover':
      return 'cover';
    case 'chapter':
      return `c${sheet.chapterIndex}-head`;
    case 'section':
      return `c${sheet.chapterIndex}-s${sheet.sectionIndex}`;
    case 'review':
      return `c${sheet.chapterIndex}-review`;
  }
}

/** 代码里的**内容页** id（顺序 = DIARY_SHEETS 顺序）—— 不含封底 */
const SHEET_IDS: string[] = DIARY_SHEETS.map(sheetId);

/** 完整页序：内容页 + 末尾的封底 */
export const BASE_PAGE_IDS: string[] = [...SHEET_IDS, BACK_PAGE_ID];

/* ⚠️ 只拿内容页建表：封底没有对应的 DiarySheet，混进来会得到 undefined。 */
export const SHEET_BY_ID = new Map<string, DiarySheet>(SHEET_IDS.map((id, i) => [id, DIARY_SHEETS[i]]));

/** 结构页 —— 删页时自动跳过（用户：「封面与封底等结构页受保护」） */
export const PROTECTED_PAGE_IDS = new Set<string>(['cover', BACK_PAGE_ID]);

export const isExtraPage = (id: string) => id.startsWith('x');
export const isProtectedPage = (id: string) => PROTECTED_PAGE_IDS.has(id);

/** 新建一个不冲突的空白页 id */
export function newExtraId(doc: DiaryDoc): string {
  let n = 1;
  const taken = new Set([...BASE_PAGE_IDS, ...doc.extraPages, ...doc.order]);
  while (taken.has(`x${n}`)) n += 1;
  return `x${n}`;
}

/**
 * 实际页序：用户改过就用用户的，没改过就用代码里的。
 *
 * ⚠️ 2026-09-25：**必须把新加的结构页补进用户的旧页序**，否则新页永远不出现。
 *    用户在此之前已经在编辑器里动过页序（IndexedDB 里存着一份 `doc.order`），
 *    那份快照是"当时代码里的目录" —— 后来我们往代码里加了封底（`back`），
 *    可用户的存档里没有它，于是 `resolveOrder` 一直返回旧数组，封底被静默吞掉。
 *    （实测踩过：网页上翻到最后一跨只有"衬页"，因为 `back` 根本不在页序里。）
 *
 * 规则：用户页序为主，**只补结构页**（封底这种代码强制的、用户也删不掉的）。
 *   · 封底固定补在**末尾** —— 它必须最后一位（跨配对是按下标奇偶算的）；
 *   · 只补"不在页序里"的，重复调用是幂等的；
 *   · 不碰用户自己加的空白页（`x{n}`）与用户的排列顺序。
 */
export function resolveOrder(doc: DiaryDoc): string[] {
  const base = doc.order.length ? [...doc.order] : [...BASE_PAGE_IDS];
  if (!base.includes(BACK_PAGE_ID)) base.push(BACK_PAGE_ID);
  return base;
}

/**
 * **用户存档里那一份**页序（不含自动补进来的结构页）。
 * 编辑操作（加页 / 删页 / 恢复页 / 移动）必须用它 ——
 * 用 `resolveOrder` 会把自动补的封底写进 `doc.order`，
 * 于是"用户从未编辑过"这个状态被永久破坏（存档里多出一个 `back`），
 * 以后代码再怎么改页序都推不动了。
 */
export function userOrder(doc: DiaryDoc): string[] {
  return doc.order.length ? [...doc.order] : [...BASE_PAGE_IDS];
}

/** 被摘掉的页（可恢复）—— 按代码顺序给出，保证恢复时位置可预期 */
export function removedPages(doc: DiaryDoc): string[] {
  if (!doc.order.length) return [];
  const inOrder = new Set(doc.order);
  const base = BASE_PAGE_IDS.filter((id) => !inOrder.has(id));
  const extras = doc.extraPages.filter((id) => !inOrder.has(id));
  return [...base, ...extras];
}

/** 页眉/胶囊里显示的名字 */
export function pageLabel(id: string): string {
  if (id === 'cover') return '封面';
  if (isExtraPage(id)) return '空白页';
  const sheet = SHEET_BY_ID.get(id);
  if (!sheet || sheet.kind === 'cover') return '未知页';
  const entry = DIARY_ENTRIES[sheet.chapterIndex];
  const who = entry ? entry.short : `篇${sheet.chapterIndex + 1}`;
  if (sheet.kind === 'section') return `${who} · ${sheet.section.title}`;
  if (sheet.kind === 'chapter') return `${who} · 篇首`;
  return `${who} · 复盘`;
}

/**
 * 结构化的文字路径 key。
 * 统一 `${pageId}:${slot}` 的形式，slot 用点号分层，例：
 *   c0-head:title
 *   c0-s1:block2.sub
 *   c0-review:text1
 *   cover:title
 * 只要 DiaryPage 里渲染的 slot 名不变，覆盖值就一直对得上（往中间插板块页也不会串）。
 */
export function textKey(pageId: string, slot: string): string {
  return `${pageId}:${slot}`;
}

/* ===================== 对开（spread）配对 =====================
   **2026-09-25 重排：两端各一个「合着的单页跨」** ——
     用户原话：「翻到最后一页是书合上只看到封底的样子，只有左边单页的封底」。
     旧版把封底当成"末跨的左页"（`left=total-1, right=null`），于是到末页时
     本子仍是**摊开**的：左叶是封底、右叶铺一张衬页 —— 用户不接受那个形态。

   现在的口径（`total` 含封面与封底）：
     · s = 0                「封面跨」：**合着**，只有一页 = 封面(page 0)
     · s = 1 .. LAST-1      「内容跨」：**摊开**，左 = 2s-1、右 = 2s
     · s = LAST             「封底跨」：**合着**，只有一页 = 封底(page total-1)
   两端这两跨都由 `--di-open = 0` 收窄成"一张纸那么宽"，视觉上就是本子合上了 ——
   封面朝上 / 封底朝上，只不过封面那跨显示封面、封底那跨显示封底。

   ⚠️ 内容跨的页号公式**没变**（左 2s-1 / 右 2s）—— 只把"最后那一跨"从
      "内容跨 + 右页为 null" 改判成"独立的封底跨"。于是：
        · total=20 → 封面(1) + 内容(ceil(18/2)=9) + 封底(1) = **11 跨**（与旧版同数）；
        · 内容跨最后一跨 s=9 → 左 17 / 右 18，正好是最后两页内容；
        　封底 page 19 单独占 s=10。
   ⚠️ 别再退回"左=total-1、右=null"的写法 —— 那正是用户否掉的对开形态。
   ⚠️ 页序体系（pageOrder / pageId / pageIndex）**原样不动**，这里只改"怎么配对"。 */
export interface Spread {
  /** 封面跨（s=0）：合着、显示封面 */
  isCover: boolean;
  /** 封底跨（s=LAST）：合着、显示封底 */
  isBackCover: boolean;
  /** 合着的跨（封面 / 封底）—— 渲染层靠它决定 `--di-open` 该是 0 还是 1 */
  isClosed: boolean;
  left: number | null;
  right: number | null;
}
/** 对开总数：封面 1 屏 + 内容页（去掉两端封面/封底后）上取整(/2) + 封底 1 屏 */
export function spreadCount(total: number): number {
  const inner = Math.max(0, total - 2);
  return 1 + Math.ceil(inner / 2) + 1;
}
/**
 * 取第 s 个对开的两页（s 从 0 起）。
 * ⚠️ 返回的 `left/right` 是 **pageOrder 下标**；封面跨 / 封底跨只有一页有效，
 *    另一侧恒为 null（渲染层据此把那一叶收起，本子才是"合着"的样子）。
 */
export function spreadPages(s: number, total: number): Spread {
  const last = spreadCount(total) - 1;
  if (s <= 0) {
    return { isCover: true, isBackCover: false, isClosed: true, left: null, right: 0 };
  }
  if (s >= last) {
    /* 封底跨：合着、只有一页 —— 而且必须和封面跨一样把它放在 **right**。
       ⚠️⚠️ 2026-09-25 踩过一次：一开始写的是 `left = total-1, right = null`，
          看着"和封面跨对称"，其实是错的 —— 几何是 `--di-open = 0` **把左叶收成 0 宽、
          右叶铺满整本**（见 .diary-leaf.is-left 的 width / .is-right 的 flex）。
          把封底放在 left 的话，收起左叶就把它一起收没了，右叶铺满显示的却是
          `pageOrder[null] ?? 'cover'` 兜底出来的**封面**。
         两端要复用的是**同一套"合着"几何**（右叶铺满），所以封底的 page 必须放 right。 */
    return {
      isCover: false,
      isBackCover: true,
      isClosed: true,
      left: null,
      right: total - 1,
    };
  }
  const left = 2 * s - 1;
  const right = 2 * s;
  return {
    isCover: false,
    isBackCover: false,
    isClosed: false,
    left: left >= 0 && left < total ? left : null,
    right: right >= 0 && right < total ? right : null,
  };
}
/** 当前单页索引 → 所在对开。封面页 0 → 0；其余按内容跨公式，末页(封底)归到最后一跨。 */
export function spreadOfPage(page: number, total: number): number {
  if (page <= 0) return 0;
  if (page >= total - 1) return spreadCount(total) - 1;
  return Math.ceil(page / 2);
}
