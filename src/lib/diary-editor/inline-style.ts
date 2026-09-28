/**
 * 手账编辑器 —— **行内**样式的作用域与落点
 * =============================================================================
 * 用户 2026-09-23 的原话：
 *   「选中的文字变色不了，变的是没选中的文字。」
 *
 * ## 病灶
 * 改样式的落点原本只有一层：`els[elId].text`（**元素级**覆盖）。
 * 而 `core` 那种结构元素是一整块思维导图，里面包着 22 个文字槽 ——
 * 用户在其中一个槽里拖选了 4 个字、点了红色，`core` 的 22 个槽**全体变红**。
 * 作用域比用户的心理模型大了一整圈。
 *
 * ## 三层作用域（窄 → 宽），改样式时依次尝试
 *   ① **行内**（本文件）   选区里真的选中了字符 → 直接给这几个字套 `<span style>`；
 *   ② **槽级**（context） 光标停在某个槽里、没选字符 → `ElOverride.texts[slot]`；
 *   ③ **元素级**（context）选中了整个结构元素 → `ElOverride.text`。
 *
 * ## 为什么需要"记住选区"
 * 用户的操作序列是：拖选 → 点工具栏的色块。
 * 点工具栏时 contenteditable **先 blur**、原生选区被浏览器丢掉，
 * 等 `onClick` 跑起来再去读 `window.getSelection()` 已经什么都读不到了。
 * 所以选区要在 **mousedown** 那一刻（浏览器清选区之前）快照一份存着。
 * 见 `captureSelection()`，调用点：Toolbar / CtxMenu 根的 `onMouseDownCapture`。
 *
 * ## 为什么"记住焦点槽"而不是每次看 document.activeElement
 * 同理：点工具栏时焦点已经跑到按钮上了。所以槽要在 `focusin` 时登记，
 * 只有用户去点画布上的**别的地方**时才清（DiaryCanvas 的手势起手 / 选中其他对象）。
 */

import { familyOf } from './fonts';

type StylePatch = { font?: string; size?: number; color?: string };

/** 当前（最后）聚焦过的可编辑文字槽 */
let slotEl: HTMLElement | null = null;
/** 选区快照（只在 mousedown 那一刻抓） */
let savedRange: Range | null = null;
/** 上一次行内包裹造出来的那个 span —— 同一段文字连点几个颜色时复用它，不套第二层 */
let lastWrap: HTMLElement | null = null;

/** 行内包裹的标记属性（不进库：storage 的清洗只保留 style，属性会被丢掉） */
const INLINE_ATTR = 'data-dp-inline';

/** 从任意节点找出它所属的 `[data-dp-slot]` 宿主 */
function hostSlotOf(n: Node | null): HTMLElement | null {
  if (!n) return null;
  const el =
    n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : (n.parentElement as HTMLElement | null);
  return el?.closest<HTMLElement>('[data-dp-slot]') ?? null;
}

/** 找出选区两端最近的"我们自己造的行内 span"（两端必须是同一个） */
function wrapOf(r: Range): HTMLElement | null {
  const s = hostSlotOf(r.startContainer);
  const e = hostSlotOf(r.endContainer);
  if (!s || s !== e) return null;
  const a = (r.startContainer.nodeType === Node.ELEMENT_NODE
    ? (r.startContainer as HTMLElement)
    : (r.startContainer.parentElement as HTMLElement | null)
  )?.closest<HTMLElement>(`span[${INLINE_ATTR}]`);
  const b = (r.endContainer.nodeType === Node.ELEMENT_NODE
    ? (r.endContainer as HTMLElement)
    : (r.endContainer.parentElement as HTMLElement | null)
  )?.closest<HTMLElement>(`span[${INLINE_ATTR}]`);
  return a && a === b ? a : null;
}

/** 选区是否"正好是整个 span 的内容"（是 → 直接改它的 style，不新套一层） */
function rangeIsWholeWrap(r: Range, w: HTMLElement): boolean {
  return (
    r.startContainer === w &&
    r.startOffset === 0 &&
    r.endContainer === w &&
    r.endOffset === w.childNodes.length
  );
}

/** 登记"文字光标进到哪个槽了"。相同槽重复调用无副作用。 */
export function rememberSlotEl(el: HTMLElement | null): void {
  if (!el) return;
  if (el === slotEl) return;
  slotEl = el;
}

/** 焦点槽（DOM 里还在的才算数 —— 换页 / 重渲染会让旧节点脱离） */
export function focusedSlotEl(): HTMLElement | null {
  return slotEl && document.contains(slotEl) ? slotEl : null;
}

/**
 * 当前焦点槽的信息。
 * `elId` 是它所属的**结构元素** id（没有则 null，比如不在 `<El>` 里的独立文字槽）。
 */
export function slotInfo(): { el: HTMLElement; slot: string; elId: string | null } | null {
  const el = focusedSlotEl();
  if (!el) return null;
  const host = el.closest<HTMLElement>('[data-dp-el]');
  return { el, slot: el.dataset.dpSlot ?? '', elId: host?.dataset.dpEl ?? null };
}

/** 用户在画布上干了别的事（选中别的对象 / 点空白）→ 丢掉文字焦点与选区快照 */
export function clearSlotFocus(): void {
  slotEl = null;
  savedRange = null;
  lastWrap = null;
}

/**
 * 抓一份选区快照。**必须在浏览器清选区之前调用** ——
 * 也就是 Toolbar / CtxMenu 根的 `onMouseDownCapture`。
 * 折叠选区（只是光标停着）也记：它代表"改样式打给这一个槽"。
 */
export function captureSelection(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  const host = hostSlotOf(r.commonAncestorContainer);
  if (!host) return;
  slotEl = host;
  savedRange = r.cloneRange();
  lastWrap = wrapOf(r);
}

/** 快照里"真的选中了字符"吗（折叠=只有一个光标，不算） */
export function hasInlineSelection(): boolean {
  const r = savedRange;
  if (!r || r.collapsed) return false;
  const el = focusedSlotEl();
  if (!el) return false;
  return el.contains(r.commonAncestorContainer);
}

function restore(r: Range): void {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * 把样式套到快照选区上（行内 `<span style>`），然后把新内容提交落库。
 *
 * @returns 是否真的动过手 —— false 表示"没有有效选区"，调用方应回落到槽级 / 元素级。
 */
export function applyInlineStyle(patch: StylePatch): boolean {
  const el = focusedSlotEl();
  const r = savedRange;
  if (!el || !r || !document.contains(r.commonAncestorContainer)) return false;
  if (r.collapsed) return false;

  let span: HTMLElement;
  if (lastWrap && document.contains(lastWrap) && rangeIsWholeWrap(r, lastWrap)) {
    /* 同一个选区连着换色：改上一次那个 span 的 style，不再套一层 */
    span = lastWrap;
  } else {
    /* ⚠️ extractContents 会按需**拆分**文本节点（"前半 / 选中 / 后半"），
       这是标准行为；拆出来的碎片塞进 span，原始内容一字不丢。 */
    const frag = r.extractContents();
    span = document.createElement('span');
    span.setAttribute(INLINE_ATTR, '1');
    span.appendChild(frag);
    r.insertNode(span);
  }

  if (patch.color) span.style.color = patch.color;
  if (patch.font) span.style.fontFamily = familyOf(patch.font);
  if (patch.size !== undefined) span.style.fontSize = `${Math.round(patch.size)}px`;

  const r2 = document.createRange();
  r2.selectNodeContents(span);

  /* 把光标还给这段文字：用户改完颜色通常还要接着打字 */
  el.focus({ preventScroll: true });
  restore(r2);

  savedRange = r2.cloneRange();
  lastWrap = span;

  /* 让 EditableText 立刻落库（它自己知道 key 与 setText 的分支判断） */
  el.dispatchEvent(new CustomEvent('dp-commit-now'));
  return true;
}
