/**
 * 手账编辑器 —— 页面结构元素的登记
 * =============================================================================
 * 用户 2026-09-23 追加的三条需求里，第一条是：
 *   「上面的所有东西都可以移动，文本、边框、底图等等」
 *
 * 页面里的东西分两类：
 *   · 用户自己贴的（图片 / 视频 / 文字贴纸）→ 已经是自由图层，天然可移动；
 *   · 页面**自带**的结构元素（大标题、正文块、月份圈选行、手绘边框、拍立得照片、
 *     纸胶带、贴纸、思维导图…）→ 它们是**代码版式**的一部分。
 *
 * 后者不能从版式里摘出来重排（那会毁掉两栏 / 思维导图 / 月份圈选行的排版），
 * 所以走**登记 + 增量覆盖**：
 *   1. 每个结构元素用 `usePageEl(slot, label)` 登记一个**稳定 id**；
 *   2. 编辑态 `DiaryCanvas` 扫 `[data-dp-el]` 量出它们的真实盒子，
 *      在纸面上画命中框 + 选中框 + 手柄（跟图层用同一套手势）；
 *   3. 手势算出的位移/旋转/缩放写进 `PageEdit.els[slot]`，
 *      渲染时由 `elOverrideStyle()` 变成 `translate/rotate/scale` 三个独立属性。
 *
 * ⚠️ id 一旦发布就不要再改名 —— `els` 是按 id 存的，改名等于把用户挪过的位置丢掉。
 * ⚠️ id 只需要**页内唯一**（跨页重复没关系，`els` 挂在 `pages[pageId]` 上）。
 *    所以各页型可以放心用 `title` / `block0` 这类短名。
 * ⚠️ 只能登记**块级 / 已定位**的元素（div / p / h2 / section / figure / ul / li）。
 *    `display: inline` 的元素不接受 transform，登记了也动不了。
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';
import { useDiaryEditorOptional, usePageId } from '@/lib/diary-editor/context';
import { elOverrideStyle } from '@/lib/diary-editor/layout';
import type { ElImage } from '@/lib/diary-editor/types';

/** 登记出来的属性：编辑态多两个标记属性，两种状态都带覆盖样式 */
export type PageElAttrs = {
  'data-dp-el'?: string;
  'data-dp-ellabel'?: string;
  /**
   * 用户把元素拉成了非原本的宽高（有 `ElOverride.w/h`）时挂上。
   * CSS 靠它把元素内第一个 `<img>` 撑满框（见 index.css 的 `[data-dp-imgfit]`）——
   * 拍立得的 img 是写死 116×87 的，不额外处理的话"框变大、图不变"。
   */
  'data-dp-imgfit'?: string;
  /**
   * 用户把这个元素**当成一个文字框**改过长宽（有 `ElOverride.w`）时挂上。
   *
   * 用户 2026-09-23：「正文块也可以调整长宽，把文字块做成ppt那种框，可以调整对齐，
   * 可以自行换行」。版式里的正文块自带 `max-width: 40ch/62ch` 这类"自然宽度上限"，
   * 不解除的话把框拉窄了字也不折行（看起来像"改长宽没反应"）。
   * 见 index.css 的 `[data-dp-box]` 规则。
   */
  'data-dp-box'?: string;
  /**
   * 结构元素上的框样式（`ElOverride.frame` / `.tbox`）。
   *
   * 用户 2026-09-23：「放边框没反应」。根因是框样式原本只认用户贴的图层，
   * 选中页面自带的照片 / 手绘边框 / 正文块时没有任何落点。
   * ⚠️ 渲染成**属性**而不是 inline style —— 拍立得 / 纸胶带 / 双线相框这些
   *    要用 `::before` 与后代选择器（`> img`），inline style 表达不了。
   * ⚠️ 阅读态也要挂（用户口径是"保存后刷新还是编辑后的样子"）。
   */
  'data-dp-frame'?: string;
  'data-dp-tbox'?: string;
  style?: CSSProperties;
};

/**
 * 结构元素的**宿主作用域**。
 *
 * `El` 把自己的 slot 通过这个 Context 传给子树，于是里面的 `EditableText`
 * 能知道"我属于哪个结构元素" —— 用户选中这个元素、在工具栏改字体/字号/颜色时，
 * 覆盖（`ElOverride.text`）要落到它内部的**每一个**文字槽上。一个元素里常常有
 * 好几个槽（小标题 + 正文 + 高亮行），靠这个作用域才能一次性覆盖到。
 *
 * ⚠️ Provider **不产生 DOM 节点**，所以包一层是绝对安全的 —— 不会像"多包一个 div"
 *    那样把 `.dx-cols` 的两栏宽度、`.dx-mm li` 的肘形连线弄散。
 */
export const ElScopeCtx = createContext<string | null>(null);

/** 读出当前 EditableText 挂在哪个结构元素下（不通过 `El` 渲染时返回 null） */
export function useElScope(): string | null {
  return useContext(ElScopeCtx);
}

export type PageElHandle = {
  attrs: PageElAttrs;
  /** 挂到元素上的 ref：用它量一次计算样式，决定要不要补 `position: relative` */
  ref: (el: HTMLElement | null) => void;
  /** 当前元素是否被用户动过（工具栏可以据此显示"复位"） */
  moved: boolean;
  /** 这个元素里的图片被换过吗（双击相框换图，见 ElImage） */
  img: ElImage | undefined;
};

/**
 * 登记一个结构元素。
 *
 * @param slot  页内唯一 id（`title` / `block0` / `cover.tape` …）
 * @param label 给界面看的名字（提示条、HUD 用）
 * @param base  元素自己原有的内联样式（会被覆盖样式合并在后）
 */
export function usePageEl(slot: string, label: string, base?: CSSProperties): PageElHandle {
  const api = useDiaryEditorOptional();
  const scoped = usePageId();
  const editing = !!api?.editing;
  /* 用"作用域里的页 id"而不是 api.pageId：翻页时底下垫着的那一页
     （.diary-under）渲染的是**另一页**，拿 api.pageId 会把当前页的覆盖贴到它身上。 */
  const pid = scoped ?? api?.pageId ?? '';
  /* ⚠️ 阅读态**也要**读覆盖 —— 用户挪过的位置刷新后必须还在，
     这正是"保存后网站直接更新成保存后的样子"。只有标记属性才是编辑态专属。 */
  const ov = api ? api.elOf(pid, slot) : undefined;

  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    /* z-index 只作用于**定位元素**以及 flex / grid 子项。结构元素多是 static，
       而它们大多确实是 flex 子项（.diary-entry 是 flex 列），但也有例外 ——
       量一次计算样式最稳：static 的补一个 data 标记，CSS 给它 position: relative
       （relative 不带偏移时不改变任何布局，只是让它能吃 z-index）。
       ⚠️ 用 dataset 而不是 className：className 归 React 管，下次渲染会被整个重写；
       dataset 是我们自己加的、JSX 里没声明，React 不会碰它。 */
    const pos = window.getComputedStyle(el).position;
    if (pos === 'static') el.dataset.dpRel = '1';
    else delete el.dataset.dpRel;
  }, []);

  const style = elOverrideStyle(ov);
  const img = api?.elImgOf(pid, slot);
  /* 拉过边手柄（有 w 或 h）= 元素不再按自己的 CSS 定尺寸，里面的 img 必须跟着撑满 */
  const imgFit = ov?.w !== undefined || ov?.h !== undefined;
  /* 改过**宽**= 当成文字框：版式自带的 max-width 上限要让位，否则字不按新框宽折行 */
  const asBox = ov?.w !== undefined;
  /* 框样式：属性而非 inline style（见 PageElAttrs 注释）。编辑态与阅读态都要挂。 */
  const frameAttr = ov?.frame ? { 'data-dp-frame': ov.frame } : null;
  const tboxAttr = ov?.tbox ? { 'data-dp-tbox': ov.tbox } : null;
  const attrs: PageElAttrs = editing
    ? {
        'data-dp-el': slot,
        'data-dp-ellabel': label,
        ...(imgFit ? { 'data-dp-imgfit': '' } : null),
        ...(asBox ? { 'data-dp-box': '' } : null),
        ...(frameAttr ?? null),
        ...(tboxAttr ?? null),
        style: base || style ? { ...base, ...style } : undefined,
      }
    : {
        ...(imgFit ? { 'data-dp-imgfit': '' } : null),
        ...(asBox ? { 'data-dp-box': '' } : null),
        ...(frameAttr ?? null),
        ...(tboxAttr ?? null),
        style: base || style ? { ...base, ...style } : undefined,
      };

  return { attrs, ref, moved: !!style, img };
}

/**
 * 登记 + 渲染一把梭的轻量外壳。
 *
 * 用法：`<El slot="chapter.title" label="大标题" as="h2" className="dx-title">…</El>`
 *
 * ⚠️ 它**不额外包一层 div** —— 直接把登记属性与 ref 挂到 `as` 指定的那个标签上。
 *    包一层看似更省事，但会改变版式（`.dx-mm li` 的 ::before/::after 肘形连线、
 *    `.dx-cols` 的两栏宽度全靠父子结构），一包就散。
 */
export function El({
  slot,
  label,
  as = 'div',
  className,
  style,
  children,
  ...rest
}: {
  slot: string;
  label: string;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Record<string, unknown>) {
  const h = usePageEl(slot, label, style);
  const node = useRef<HTMLElement | null>(null);
  /** 元素**原本**的图片地址（用户还没换图时那个）。清掉换图记录时要写回去。 */
  const orig = useRef<string | null>(null);

  /* 换图：把用户选的新图写到"元素自身是 img / 元素里第一个 img"上。
     ⚠️ 只能命令式改 `src` —— 图片地址写在 JSX 里（`<El as="img" src={main} />`），
        改代码是不可能的，所以走"渲染后补一刀"。React 只在 props 变化时重写 src，
        我们改的是同一个 DOM 属性、props 没变 → 不会被冲掉。
     ⚠️ 记下原始 src：用户没有"还原图片"的入口，但清空 `imgs` 记录时能回到原图，
        比留着一个再也不会被覆盖的旧 blob 地址安全。 */
  const applyImg = useCallback(() => {
    const el = node.current;
    if (!el) return;
    const target =
      el.tagName === 'IMG' ? el : el.querySelector<HTMLImageElement>('img');
    if (!target) return;
    if (orig.current === null) orig.current = target.getAttribute('src');
    const next = h.img?.src || orig.current || '';
    if (next && target.getAttribute('src') !== next) target.setAttribute('src', next);
  }, [h.img?.src]);

  useLayoutEffect(() => {
    applyImg();
  }, [applyImg]);

  const setRef = useCallback(
    (el: HTMLElement | null) => {
      node.current = el;
      h.ref(el);
      /* ref 回调在挂载/卸载时跑，此刻 img 可能还没被 React 填上 src —— 排到本帧末尾再补 */
      if (el) queueMicrotask(applyImg);
    },
    [h, applyImg],
  );

  /* ⚠️ children 为空时**绝对不能**包 Provider。
     `<El as="img" … />` 这种自闭合元素（纸胶带贴纸、图钉）本身没有 children，
     原本 `createElement('img', attrs, undefined)` 是合法的；一旦变成
     `createElement('img', attrs, <Provider/>)`，React 会直接抛
     "img is a void element tag and must neither have children…"，
     **把整棵 React 树炸掉**（页面看起来像"所有功能全坏了"）。
     没有 children 的元素本来也不含文字槽，不需要这个作用域。 */
  const body =
    children === undefined || children === null
      ? undefined
      : createElement(ElScopeCtx.Provider, { value: slot }, children);
  return createElement(as, { ...rest, className, ...h.attrs, ref: setRef }, body);
}

