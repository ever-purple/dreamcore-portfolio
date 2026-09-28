/**
 * 手账编辑器 —— 编辑态画布（图层 + 结构元素 + 选中框 + 手柄 + 框选 + 坐标 HUD）
 * =============================================================================
 * 用户要求（2026-09-23）：
 *   「各区块显示拖拽手柄与旋转手柄」
 *   「图片作为贴纸插入当前页，之后可拖动、缩放、旋转、裁切」
 *   「编辑时可以看到位置的坐标，字号的大小」
 *   「上面的所有东西都可以移动，文本、边框、底图等等」      ← 第二轮
 *   「可以建组，整组移动。所有的功能与 PowerPoint 的功能一样，快捷键也是」
 *
 * ## 可选对象有两类，走同一套交互
 *   · **图层**（`layer`）—— 用户贴的图片 / 视频 / 文字贴纸；
 *   · **结构元素**（`el`）—— 页面自带的标题、正文块、手绘边框、拍立得照片、纸胶带…
 *     它们由 `usePageEl` 登记 `data-dp-el`，编辑态被本组件扫出来量尺寸，
 *     于是"版式里的东西"也能被点选、拖动、缩放、旋转、成组。
 *
 * ## 点一次 = 选中/拖动，点两次 = 改字（PowerPoint 的模型）
 * 两类对象都被**透明的命中框**盖住，单击只能选中或拖动 —— 否则想拖它却把光标点进了字里。
 * 双击才进文字编辑（结构元素 = 直接 focus 它内部的 `[data-dp-slot]`；图层 = 弹一个原地
 * 编辑器）。正在编辑的那个元素的命中框会自动让开（`.is-muted`），
 * 于是在字里点一下是移动光标而不是重新拖动 —— 和 PowerPoint 的手感一致。
 *
 * ## 手势统一走**指针捕获**
 * 起手时把 pointerId 捕获到画布根节点上，之后的 move/up 一律回投到根节点 ——
 * 这样指针移出手柄、移到别的图层上都不断线，也不用给每个手柄各挂一套 move 监听。
 *
 * ## 几何：一切以**实测盒子**为准
 * `offsetLeft/offsetTop/offsetWidth/offsetHeight` 是**布局值，不含 transform** ——
 * 这正好是我们要的"原始盒子"：位移/旋转/缩放是我们自己叠上去的 transform，
 * 量出来的仍是没动过的那个盒子，选中框再按覆盖值把它摆到视觉位置。
 * `getBoundingClientRect` 反而不能用：元素一旦旋转，它返回的是外接矩形（会虚胖）。
 *
 * ## 多选与成组
 *   · Shift / Ctrl 点选加减成员；空白处拖拽 = 框选；Ctrl+A 全选；Tab 轮换；
 *   · 选中集合里有多个对象、或主选中对象属于某个组时，手柄作用在**包围盒**上，
 *     缩放/旋转绕包围盒中心 —— 这就是"整组移动 / 整组缩放"。
 *   · 换算走 layout.ts 的 rotateAbout / scaleAbout（等比空间），
 *     否则纸不是正方形，转 90° 会把轨迹拉歪。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { DiaryLayer, ElOverride, LayerImage, LayerText, ProBox, SelRef } from '@/lib/diary-editor/types';
import {
  IDENTITY_EL,
  MAX_EL_SIZE,
  MAX_LAYER_W,
  MIN_EL_SIZE,
  MIN_LAYER_W,
  REF_W,
  clampCrop,
  sameRef,
} from '@/lib/diary-editor/types';

/** 拖边手柄时高度的上下限（占纸面高的比例）—— 再小抓不住，再大就跑到纸外去了 */
const MIN_EDGE_H = 0.03;
const MAX_EDGE_H = 3;
import { displayAspect, boxHit, layerBox, textFontSize, TEXT_LINE_HEIGHT } from '@/lib/diary-editor/layout';
import { familyOf, labelOf } from '@/lib/diary-editor/fonts';
import { useDiaryEditor, type CanvasBridge, type ElStyleInfo } from '@/lib/diary-editor/context';
import { clearSlotFocus, rememberSlotEl } from '@/lib/diary-editor/inline-style';
import { createPortal } from 'react-dom';
import { LayerView } from './LayerView';
import { CtxMenu, type CtxItem } from './CtxMenu';

/** 裁切至少留 10% 图幅，否则会把图裁没 */
const MIN_CROP = 0.1;

/** 实测盒子（px，相对纸面宿主）。不含 transform。 */
type PxBox = { left: number; top: number; w: number; h: number };
/** 视觉盒子 = 实测盒子叠加覆盖变换后的样子（选中框/手柄就画在它上面） */
type VisBox = PxBox & { rot: number };
/** 框选手势（实时值放 ref，渲染用的放 state） */
type Marquee = { x0: number; y0: number; x1: number; y1: number; add: boolean };

type Gesture =
  | { kind: 'move'; sx: number; sy: number; appliedX: number; appliedY: number }
  | { kind: 'scale'; sx: number; sy: number; appliedK: number }
  | { kind: 'rotate'; cx: number; cy: number; a0: number; appliedDeg: number }
  /**
   * 拖四条边 = **自由改长宽**（不保持比例）。
   *
   * 用户 2026-09-23：「相框可以自由调整长宽」「像这样可以调整底图的长宽」
   * 「图片相框也要自由调整长宽」。角手柄仍是等比缩放，边手柄改单边 ——
   * 与 PowerPoint / 可画 一致。
   * ⚠️ 与裁切手势（kind:'crop'）是两件事：裁切改的是"图在框里的取景范围"，
   *    这个改的是"框本身多大"。所以裁切模式下手柄归裁切，平时归这个。
   * `target` 区分两类对象：`layer` 写 w/h/cx/cy（中心定位的自由图层），
   * `el` 写 w/h + dx/dy（留在原版式上的结构元素，尺寸是新增的覆盖字段）。
   */
  | {
      kind: 'edge';
      target: 'layer' | 'el';
      id: string;
      edge: 'n' | 's' | 'e' | 'w';
      sx: number;
      sy: number;
      /** 起始几何（比例空间，**未叠加覆盖**的原始尺寸） */
      w0: number;
      h0: number;
      cx0: number;
      cy0: number;
      /** 结构元素：手势开始时已有的位移覆盖（图层恒 0） */
      dx0: number;
      dy0: number;
      rot: number;
      /** 纸面**视觉**像素尺寸（指针位移是视口 px，比例 ↔ 像素换算用它） */
      pw: number;
      ph: number;
      /**
       * 结构元素是**文字块**（不是图片）—— 此时只写"用户真正拖的那一个方向"的尺寸。
       *
       * 用户 2026-09-23：「正文块也可以调整长宽…可以自行换行」。
       * 为什么文字块不能像相框那样 w/h 都写：
       *   · 图片块靠 `width + height` 把图撑满框，两个都得写；
       *   · 文字块的高度是**内容撑出来的**。横着拉宽时如果把当前内容高度也冻进 `h`，
       *     之后换个字号 / 多打一行，字就会溢出在一个高度不对的框里。
       * 所以横向拖只写 `w`（高度继续跟着内容走），纵向拖只写 `h`。
       */
      elText?: boolean;
    }
  | {
      kind: 'crop';
      id: string;
      edge: 'l' | 'r' | 't' | 'b';
      layer: LayerImage;
      sx: number;
      sy: number;
      boxW: number;
      boxH: number;
      left: number;
      top: number;
    };

/** 把页面空间的位移投影到「框的本地轴」（框旋转了 rot 度） */
function toLocal(dx: number, dy: number, rotDeg: number) {
  const a = (-rotDeg * Math.PI) / 180;
  return { dx: dx * Math.cos(a) - dy * Math.sin(a), dy: dx * Math.sin(a) + dy * Math.cos(a) };
}

/** 实测盒子 → 比例盒子（context 侧的对齐 / 层级重排要它） */
function toPro(b: PxBox, hostW: number, hostH: number): ProBox {
  return {
    cx: (b.left + b.w / 2) / hostW,
    cy: (b.top + b.h / 2) / hostH,
    w: b.w / hostW,
    h: b.h / hostH,
  };
}

function sameBoxes(a: Record<string, PxBox>, b: Record<string, PxBox>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const x = a[k];
    const y = b[k];
    if (!y || x.left !== y.left || x.top !== y.top || x.w !== y.w || x.h !== y.h) return false;
  }
  return true;
}

/**
 * 量出宿主里所有 `[data-dp-el]` 的**原始盒子**。
 *
 * 用 `offsetLeft/offsetTop` 沿 offsetParent 链累加到宿主 —— 这条链是**布局坐标**，
 * 完全不受 transform 影响，所以量到的是"没被用户挪过"的那个位置；
 * 位移/旋转/缩放是我们自己叠上去的，选中框再按覆盖值摆到视觉位置即可。
 *
 * ⚠️ 还要减掉 `.diary-sheet` 的 scrollTop/scrollLeft：纸面内容溢出时 sheet 会滚，
 *    而覆盖层是宿主的直接子元素、不跟着滚，不减的话命中框会和文字错位。
 */
function measureEls(host: HTMLElement): Record<string, PxBox> {
  const sheet = host.querySelector<HTMLElement>('.diary-sheet');
  const out: Record<string, PxBox> = {};
  if (!sheet) return out;
  const sl = sheet.scrollLeft;
  const st = sheet.scrollTop;
  sheet.querySelectorAll<HTMLElement>('[data-dp-el]').forEach((el) => {
    const id = el.dataset.dpEl;
    if (!id) return;
    let x = 0;
    let y = 0;
    let n: HTMLElement | null = el;
    let guard = 0;
    while (n && n !== host && guard++ < 60) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    out[id] = { left: x - sl, top: y - st, w: el.offsetWidth, h: el.offsetHeight };
  });
  return out;
}

/**
 * 量出每个结构元素里**文字槽的实测样式**（字体 / 字号 / 颜色）。
 *
 * 为什么必须实测：页面自带的标题、正文用的是 index.css 里的字体栈与字号，
 * 状态中枢完全不知道。用户 2026-09-23 要求「选中文字…字体字号颜色样式也会在下方
 * 显示出来」，所以选中某个结构元素时，工具栏要显示它的**真实**样式 ——
 * 只能从 DOM 的 computed style 拿。
 *
 * ⚠️ 取**第一个**文字槽作为代表：一个元素里常有多个槽（小标题 + 正文），
 *    全部报出来工具栏也放不下；`slots` 字段告诉界面"这里面还有别的文字块"。
 * ⚠️ 字号是屏幕 px（结构元素的 CSS 就是这么写的），与 ElTextStyle.size 同一单位，
 *    所以工具栏显示的数字与用户改完生效的数字是同一个。
 */
function measureElStyles(host: HTMLElement): Record<string, ElStyleInfo> {
  const out: Record<string, ElStyleInfo> = {};
  const scope = host.querySelector<HTMLElement>('.diary-sheet') ?? host;
  scope.querySelectorAll<HTMLElement>('[data-dp-el]').forEach((el) => {
    const id = el.dataset.dpEl;
    if (!id) return;
    const slots = el.querySelectorAll<HTMLElement>('[data-dp-slot]');
    if (!slots.length) {
      out[id] = { fontFamily: '', fontSize: 0, color: '', textAlign: 'left', hasText: false, slots: 0 };
      return;
    }
    const cs = window.getComputedStyle(slots[0]);
    const px = parseFloat(cs.fontSize);
    /* 对齐回显：浏览器给的是 `start` / `-webkit-center` 这类写法，归一到四个值，
       否则工具栏的对齐控件会认不出来（会显示成"没选"）。 */
    const rawAlign = (cs.textAlign || 'left').toLowerCase();
    const textAlign = rawAlign.includes('justify')
      ? 'justify'
      : rawAlign.includes('center')
        ? 'center'
        : rawAlign.includes('right') || rawAlign.includes('end')
          ? 'right'
          : 'left';
    out[id] = {
      fontFamily: cs.fontFamily,
      fontSize: Number.isFinite(px) ? Math.round(px * 10) / 10 : 0,
      color: cs.color,
      textAlign,
      hasText: true,
      slots: slots.length,
    };
  });
  return out;
}

/**
 * 量出画布里所有 `.dp-layer` 的原始盒子（它们用 translate(-50%,-50%) 居中，要还原）。
 *
 * ⚠️ 「沉到页面内容下面」的图层（`layer.under`）**不在 `.dp-canvas` 里** ——
 *    它们被 portal 到 `.dp-under-slot`（z-index 0、排在 `.diary-sheet` 之前）。
 *    所以选择器必须同时认这两个宿主，否则那些图层量不到盒子 ⇒ 选中框/手柄画不出来、
 *    框选也扫不到（用户会觉得"沉下去以后就再也选不回来了"）。
 */
function measureLayers(host: HTMLElement): Record<string, PxBox> {
  const out: Record<string, PxBox> = {};
  const sel = '.dp-canvas .dp-layer[data-dp-layer], .dp-under-slot .dp-layer[data-dp-layer]';
  host.querySelectorAll<HTMLElement>(sel).forEach((el) => {
    const id = el.dataset.dpLayer;
    if (!id) return;
    out[id] = {
      left: el.offsetLeft - el.offsetWidth / 2,
      top: el.offsetTop - el.offsetHeight / 2,
      w: el.offsetWidth,
      h: el.offsetHeight,
    };
  });
  return out;
}

/**
 * 量出哪些结构元素是「图片类」—— 自身是 `<img>`、内含 `<img>`、或背后有背景图。
 *
 * 用途（用户 2026-09-23）：
 *   「像这样可以调整底图的长宽」「图片相框也要自由调整长宽」
 *   「双击相框里的图片可以替换图片」
 * 这两件事只对图片类元素开放（见 canEdge 注释）：
 *   · 文字块不放开 —— 把标题/正文块拖窄会当场折行，看着像版式坏了；
 *   · 图片类放开 —— 相框、贴纸、底图想拉多长拉多长，这是用户明确要的。
 *
 * ⚠️ 背景图要排除 `none` 与 `linear-gradient(...)` 这类**生成式**底色：
 *    `.dx-block` 那一类装饰面都是渐变，它们不是"图片"，拉长没有意义。
 */
function measureElMedia(host: HTMLElement): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const scope = host.querySelector<HTMLElement>('.diary-sheet') ?? host;
  scope.querySelectorAll<HTMLElement>('[data-dp-el]').forEach((el) => {
    const id = el.dataset.dpEl;
    if (!id) return;
    let media = el.tagName === 'IMG' || !!el.querySelector('img');
    if (!media) {
      const bg = window.getComputedStyle(el).backgroundImage;
      media = !!bg && bg !== 'none' && !/gradient/i.test(bg);
    }
    out[id] = media;
  });
  return out;
}


/**
 * 原地编辑文字贴纸（双击进入）。
 *
 * 为什么不让贴纸本身常驻 contenteditable：那样**拖拽和改字会抢同一个指针事件**——
 * 想拖它却把光标点进了字里。所以走"单击=选中可拖、双击=进文字编辑"的分工，
 * 编辑态用一个覆盖在同一个位置的临时编辑器，退出时把 textContent 写回 doc。
 *
 * 同样用「挂载时写一次 textContent、之后不再碰」的写法避免光标跳动（见 EditableText）。
 */
function InlineTextEditor({
  layer,
  style,
  onCommit,
  onClose,
}: {
  layer: LayerText;
  style: CSSProperties;
  onCommit: (text: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = layer.text;
    el.focus();
    /* 光标落到末尾（否则会停在开头，改字要先按 End） */
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    } catch {
      /* 选不了就算了，不影响输入 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id]);

  return (
    <div
      className={`dp-layer dp-textlayer is-${layer.box}${layer.bold ? ' is-bold' : ''}${layer.italic ? ' is-italic' : ''} dp-textedit`}
      style={style}
    >
      <div
        ref={ref}
        className="dp-text"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        style={{
          fontFamily: familyOf(layer.font),
          fontSize: textFontSize(layer.size),
          lineHeight: TEXT_LINE_HEIGHT,
          color: layer.color,
          /* 原地改字时也要跟着对齐 —— 否则"点了居中、框里还是左对齐"，
             退了焦才对上，看着像卡了一下 */
          ...(layer.align ? { textAlign: layer.align } : null),
        }}
        onPointerDown={(ev) => ev.stopPropagation()}
        onBlur={() => {
          onCommit((ref.current?.textContent ?? '').replace(/\u00a0/g, ' '));
          onClose();
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            (ev.target as HTMLElement).blur();
          }
        }}
      />
    </div>
  );
}

/* ============================ 画布 ============================ */

export function DiaryCanvas({
  pageId,
  hostRef,
  cropping,
  underSlotRef,
}: {
  pageId: string;
  hostRef: RefObject<HTMLElement | null>;
  cropping: boolean;
  /**
   * 「沉到页面内容下面」的图层宿主（`.dp-under-slot`，由 NotebookOverlay 提供）。
   *
   * 为什么必须借别人的宿主画：编辑态的 `under` 图层要**视觉上沉到 `.diary-sheet` 之下**，
   * 而画布 `.dp-canvas` 自己 z-index 60 整体压在正文之上 —— 在它内部怎么调 z 都没用。
   * 所以那些图层用 portal 搬到 `.dp-under-slot`（z=0，且排在 `.diary-sheet` 之前，
   * 同档定位元素按树序绘制 ⇒ 纸 → 它们 → 正文）。
   *
   * 但**交互仍然归画布管**：portal 只改 DOM 落点，React 树里它们依旧是本组件的子节点，
   * 指针事件照旧冒泡到 `.dp-canvas` 的那几个 handler（拖动、指针捕获都在那边）。
   */
  underSlotRef?: RefObject<HTMLDivElement | null>;
}) {
  const e = useDiaryEditor();
  const layers = e.layersOf(pageId);
  const els = e.elsOf(pageId);

  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * portal 的落点。ref 要到 DOM 挂载后才非空，且 `.dp-under-slot` 会随
   * 换页 / 进出编辑态重建，所以用 state 存一份（layout effect 里同步）。
   */
  const [underHost, setUnderHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setUnderHost(underSlotRef?.current ?? null);
  });
  /** 分两档渲染：普通图层进画布（在上），`under` 图层 portal 到宿主（在下） */
  const topLayers = layers.filter((l) => !l.under);
  const sunkLayers = layers.filter((l) => !!l.under);
  const gesture = useRef<Gesture | null>(null);
  const [busy, setBusy] = useState(false);
  const [hud, setHud] = useState<{ text: string; x: number; y: number } | null>(null);
  /** 正在原地改字的文字贴纸（双击进入，见 InlineTextEditor 注释） */
  const [textEditId, setTextEditId] = useState<string | null>(null);
  /** 结构元素里正在被点改的那个 —— 它的命中框要让开，否则在字里点不进去 */
  const [focusEl, setFocusEl] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const mqRef = useRef<Marquee | null>(null);
  /** 实测盒子（渲染用 state + 真实来源） */
  const [boxes, setBoxes] = useState<Record<string, PxBox>>({});
  const [layerBoxes, setLayerBoxes] = useState<Record<string, PxBox>>({});

  const selection = e.selection;
  const primary: SelRef | null = selection.length ? selection[selection.length - 1] : null;
  const selectedLayer = useMemo(
    () => (primary?.kind === 'layer' ? layers.find((l) => l.id === primary.id) ?? null : null),
    [primary, layers],
  );
  const isImage = selectedLayer?.type === 'image';

  const rectOf = useCallback(() => hostRef.current?.getBoundingClientRect() ?? null, [hostRef]);
  const hostSize = useCallback(() => {
    const host = hostRef.current;
    const W = host?.clientWidth || 1;
    const H = host?.clientHeight || 1;
    return { W, H, ar: W / H };
  }, [hostRef]);

  /**
   * 编辑态的**整体缩放比**（视觉 px ÷ 布局 px）。
   *
   * 为了让"编辑时的纸面与阅读时逐像素一致"（用户：「编辑的时候页面不要变动」
   * 「排版不能变」），编辑态不再压矮本子，而是用 `transform: scale()` 整体缩小
   * 给底部工具栏腾位置（见 index.css 的 `.is-editing`）。
   *
   * 代价：`getBoundingClientRect()` 返回的是**缩放后**的视觉尺寸，而
   * `clientWidth` 是**布局**尺寸，两者不再相等。于是：
   *   · 元素的盒子、命中框、手柄 —— 全是布局 px（`.dp-canvas` 同在缩放容器里，
   *     会跟着一起被缩放，所以照旧对齐）→ 用 hostSize()；
   *   · **指针位移**（clientX/Y 是视口 px）→ 必须除以视觉尺寸，否则拖动会"跟不上鼠标"。
   * 这里就是那把尺子。
   */
  const viewK = useCallback(() => {
    const host = hostRef.current;
    if (!host) return 1;
    const w = host.clientWidth || 1;
    const rw = host.getBoundingClientRect().width || w;
    return rw / w || 1;
  }, [hostRef]);

  /* ---------------- 量尺寸 ----------------
     什么时候需要重量：
       · 换页 / 进出编辑态 → 元素整批换掉；
       · doc 变了 → 文字改了会 reflow、贴纸挪了位置也变；
       · 窗口 resize、字体加载完成 → 全站字号/换行都会变。
     量的是 offset*，一次十来个元素，代价可以忽略。
     ⚠️ 只有"真的变了"才 setState —— 否则 量尺寸 → setState → 重渲染 → 再量 会自锁。 */
  const measure = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const next = measureEls(host);
    const nextL = measureLayers(host);
    setBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
    setLayerBoxes((prev) => (sameBoxes(prev, nextL) ? prev : nextL));

    /* 顺手把比例盒子写进"画布桥" —— context 的成组缩放 / 对齐 / 层级重排要用，
       而那几处拿不到 DOM。 */
    const { W, H } = { W: host.clientWidth || 1, H: host.clientHeight || 1 };
    const proBoxes: Record<string, ProBox> = {};
    const labels: Record<string, string> = {};
    host.querySelectorAll<HTMLElement>('[data-dp-el]').forEach((el) => {
      const id = el.dataset.dpEl;
      if (!id || !next[id]) return;
      proBoxes[id] = toPro(next[id], W, H);
      labels[id] = el.dataset.dpEllabel || id;
    });
    const prev = e.bridge.current;
    e.bridge.current = {
      elBoxes: proBoxes,
      elLabels: labels,
      /* 结构元素里文字的实测样式 —— 工具栏"选中回显"要用（见 ElStyleInfo） */
      elStyles: measureElStyles(host),
      /* 哪些结构元素是"图片类"（相框 / 贴纸 / 底图）—— 决定给不给四边手柄与双击换图 */
      elMedia: measureElMedia(host),
      focusText: prev?.focusText ?? (() => false),
      snapshot: prev?.snapshot ?? (() => []),
      orderedBoxes: prev?.orderedBoxes ?? (() => []),
    };
  }, [e.bridge, hostRef]);

  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, e.editing, layers, els, measure, underHost]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const on = () => measure();
    window.addEventListener('resize', on);
    const ro = new ResizeObserver(on);
    ro.observe(host);
    /* 网络字体（中文手写体那些）落地后换行会变，量出来的盒子会偏 —— 等它一下再量 */
    if (document.fonts?.ready) void document.fonts.ready.then(() => measure());
    /* ⚠️ 图片是**解码完才有尺寸**的，而 `measureEls` 读的是 `offsetHeight`。
       第一次量的时候图还没落地 → 量出 h:0，于是贴纸/相框的**命中框高度是 0**，
       点都点不到（2026-09-23 实测：`.dp-elhit` 的 title「贴纸 · 右上」h=0，
       所以"页面自带的图片选不中"）。`load` 不冒泡，所以在宿主上用**捕获阶段**兜住
       所有 `<img>` 的落地；换图也走这条路（命令式改完 src 会再触发一次 load）。 */
    const onAsset = () => measure();
    host.addEventListener('load', onAsset, true);
    host.addEventListener('error', onAsset, true);
    return () => {
      window.removeEventListener('resize', on);
      ro.disconnect();
      host.removeEventListener('load', onAsset, true);
      host.removeEventListener('error', onAsset, true);
    };
  }, [measure, hostRef]);

  /* 正在点改的结构元素 → 它的命中框让开（在字里点一下应该是移动光标） */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () =>
      (document.activeElement as HTMLElement | null)?.closest?.('[data-dp-el]') as HTMLElement | null;
    const onFocusIn = (ev: Event) => {
      const wrap = (ev.target as HTMLElement | null)?.closest?.('[data-dp-el]') as HTMLElement | null;
      setFocusEl(wrap?.dataset.dpEl ?? null);
    };
    const onFocusOut = () => {
      /* 焦点转移是"先 out 再 in"，等一拍再读，否则会误判成"没有焦点" */
      window.setTimeout(() => setFocusEl(read()?.dataset.dpEl ?? null), 0);
    };
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
    return () => {
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
    };
  }, [hostRef]);

  /* ---------------- 画布桥的三个能力（都要 DOM） ---------------- */

  /** 让某个对象进入文字编辑态：图层 = 原地编辑器；结构元素 = focus 它内部的 contenteditable */
  const focusText = useCallback<CanvasBridge['focusText']>(
    (ref, at) => {
      if (ref.kind === 'layer') {
        const l = layers.find((x) => x.id === ref.id);
        if (!l || l.type !== 'text') return false;
        setTextEditId(l.id);
        return true;
      }
      const host = hostRef.current;
      if (!host) return false;
      const wrap = host.querySelector<HTMLElement>(`[data-dp-el="${ref.id}"]`);
      if (!wrap) return false;
      const slots = Array.from(wrap.querySelectorAll<HTMLElement>('[data-dp-slot]'));
      if (!slots.length) return false;
      /* 一个元素里可能有好几个可点改的槽位（小标题 + 正文）：优先给离双击点最近的那个 */
      let target = slots[0];
      if (at) {
        let best = Infinity;
        for (const s of slots) {
          const r = s.getBoundingClientRect();
          const dx = Math.max(r.left - at.x, 0, at.x - r.right);
          const dy = Math.max(r.top - at.y, 0, at.y - r.bottom);
          const d = dx * dx + dy * dy;
          if (d < best) {
            best = d;
            target = s;
          }
        }
      }
      /* preventScroll：让浏览器别自作主张滚容器 —— 滚动会让我们随后按点击坐标
         落下的光标偏掉。只在真的看不见时才手动滚一次（溢出的长页才会走到）。 */
      target.focus({ preventScroll: true });
      /* ⚠️ 不能只依赖 `onFocus` 去登记：节点**已经**是 activeElement 时再 focus()
         不会派发 focus 事件（"双击进文字 → 点画布别处 → 再点回来"就是这条路），
         于是工具栏会以为光标不在任何一段里。这里显式登记一次，幂等。 */
      rememberSlotEl(target);
      const hr = host.getBoundingClientRect();
      const sr = target.getBoundingClientRect();
      if (sr.top < hr.top || sr.bottom > hr.bottom) {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      return true;
    },
    [hostRef, layers],
  );

  /**
   * 把结构元素抓成"文字图层"快照 —— 复制 / 再制结构文字时用。
   * 结构元素本身复制不了（它来自页面版式，全本只有一份），所以这里把它**读出来**
   * 变成一张同位置、同字号、同颜色的文字贴纸，粘出去就是可移动的副本。
   */
  const snapshot = useCallback<CanvasBridge['snapshot']>(
    (_pid, refs) => {
      const host = hostRef.current;
      if (!host) return [];
      const { W, H } = hostSize();
      const scale = W / REF_W;
      const out: DiaryLayer[] = [];
      for (const r of refs) {
        if (r.kind !== 'el') continue;
        const wrap = host.querySelector<HTMLElement>(`[data-dp-el="${r.id}"]`);
        const base = boxes[r.id];
        if (!wrap || !base) continue;
        const text = (wrap.innerText || wrap.textContent || '').trim();
        if (!text) continue;
        const ov = els[r.id] ?? IDENTITY_EL;
        const first = wrap.querySelector<HTMLElement>('[data-dp-slot]') ?? wrap;
        const cs = window.getComputedStyle(first);
        const fsPx = parseFloat(cs.fontSize) || 16;
        /* 计算样式里的字号是"屏幕上"的 px，而图层字号按 REF_W 基准记 —— 要除回去，
           再对齐到 2px 档位（编辑器的字号是 10 档的，随便给个 17.3 会显得莫名其妙） */
        const raw = fsPx / (scale || 1);
        const size = Math.min(48, Math.max(12, Math.round(raw / 2) * 2));
        out.push({
          id: `t-snap-${r.id}-${Date.now().toString(36)}`,
          type: 'text',
          text: text.replace(/\s*\n\s*/g, ' '),
          font: guessFont(cs.fontFamily),
          size,
          color: cssColor(cs.color) || '#3a2e23',
          box: 'none',
          cx: (base.left + base.w / 2) / W + ov.dx,
          cy: (base.top + base.h / 2) / H + ov.dy,
          w: Math.min(1.4, Math.max(0.08, (base.w * ov.sc) / W)),
          rot: ov.rot,
          z: 0,
        });
      }
      return out;
    },
    [boxes, els, hostRef, hostSize],
  );

  /** 当前页所有可选对象，按"从下到上"（图层按 z、结构元素按 DOM 顺序） */
  const orderedBoxes = useCallback<CanvasBridge['orderedBoxes']>(() => {
    const { W, H } = hostSize();
    const out: { ref: SelRef; box: ProBox }[] = [];
    for (const oid of Object.keys(boxes)) {
      const b = boxes[oid];
      const ov = els[oid] ?? IDENTITY_EL;
      out.push({
        ref: { kind: 'el', id: oid },
        box: {
          cx: (b.left + b.w / 2) / W + ov.dx,
          cy: (b.top + b.h / 2) / H + ov.dy,
          w: (b.w * ov.sc) / W,
          h: (b.h * ov.sc) / H,
        },
      });
    }
    for (const l of [...layers].sort((a, b) => a.z - b.z)) {
      const pb = layerBoxes[l.id];
      out.push({
        ref: { kind: 'layer', id: l.id },
        box: pb
          ? toPro(pb, W, H)
          : { cx: l.cx, cy: l.cy, w: l.w, h: l.w / (displayAspect(l) || 1) },
      });
    }
    return out;
  }, [boxes, els, hostSize, layerBoxes, layers]);

  /* 桥是个可变 ref，三个能力每帧都在变 —— 每次提交后同步一次（幂等、很便宜） */
  useLayoutEffect(() => {
    const cur = e.bridge.current;
    if (!cur) return;
    cur.focusText = focusText;
    cur.snapshot = snapshot;
    cur.orderedBoxes = orderedBoxes;
  });

  /* ---------------- 几何：实测盒 → 视觉盒 ---------------- */

  /** 某个对象的视觉盒子（叠加了位移 / 缩放 / 旋转）。还没有实测数据就返回 null。 */
  const visualBox = useCallback(
    (r: SelRef): VisBox | null => {
      const { W, H } = hostSize();
      if (r.kind === 'layer') {
        const b = layerBoxes[r.id];
        if (!b) return null;
        const l = layers.find((x) => x.id === r.id);
        return { ...b, rot: l?.rot ?? 0 };
      }
      const b = boxes[r.id];
      if (!b) return null;
      const ov = els[r.id] ?? IDENTITY_EL;
      const w = b.w * ov.sc;
      const h = b.h * ov.sc;
      /* `scale` 绕元素自身中心 → 盒子往中心收；位移是纸面比例 */
      return {
        left: b.left + ov.dx * W + (b.w - w) / 2,
        top: b.top + ov.dy * H + (b.h - h) / 2,
        w,
        h,
        rot: ov.rot,
      };
    },
    [boxes, els, hostSize, layerBoxes, layers],
  );

  /** 实际要动的对象集合（组会自动展开）——「可建组、整组移动」的落点 */
  const expanded = e.expandRefs(pageId, selection);

  /** 手柄作用的盒子：单选一个 = 它自己；多选或属于组 = 整批的包围盒 */
  const activeBox = useMemo<VisBox | null>(() => {
    if (!expanded.length) return null;
    if (expanded.length === 1) return visualBox(expanded[0]);
    const vis = expanded.map(visualBox).filter(Boolean) as VisBox[];
    if (!vis.length) return null;
    if (vis.length === 1) return vis[0];
    const x0 = Math.min(...vis.map((b) => b.left));
    const y0 = Math.min(...vis.map((b) => b.top));
    const x1 = Math.max(...vis.map((b) => b.left + b.w));
    const y1 = Math.max(...vis.map((b) => b.top + b.h));
    return { left: x0, top: y0, w: x1 - x0, h: y1 - y0, rot: 0 };
  }, [expanded, visualBox]);

  /**
   * 「拖四条边自由改长宽」的目标：
   *   · 单选一个图片 / 视频**图层**（用户自己贴上去的）—— 用户 2026-09-23：「相框可以自由调整长宽」；
   *   · 单选一个**图片类结构元素**（页面自带的拍立得相框 / 贴纸 / 底图）——
   *     用户 2026-09-23 第三轮：「像这样可以调整底图的长宽」「图片相框也要自由调整长宽」；
   *   · 单选一个**文字类结构元素**（标题 / 正文块 / 思维导图）——
   *     用户 2026-09-23 第四轮：「正文块也可以调整长宽，把文字块做成ppt那种框，
   *     可以调整对齐，可以自行换行」。
   *     ⚠️ 早先这里是**排除**文字块的（理由：拖窄会当场折行，看着像版式坏了）。
   *        现在专门补了配套：拖过宽的元素挂 `data-dp-box`，CSS 解除版式自带的
   *        `max-width: 40ch` 上限并放开折行 —— 折行正是用户要的"可以自行换行"。
   * 不给的对象：
   *   · 多选 / 成组 —— "整组的长宽"含义不明确，给了很容易误操作；
   *   · 圆形裁切框 —— 强制正方，拉成长方形会把圆裁成椭圆。
   */
  const edgeLayer =
    expanded.length === 1 && primary?.kind === 'layer'
      ? (layers.find((l) => l.id === primary.id) ?? null)
      : null;
  const edgeLayerOk =
    !!edgeLayer &&
    (edgeLayer.type === 'image' || edgeLayer.type === 'video') &&
    edgeLayer.frame !== 'circle';
  /**
   * 单选的那个结构元素 id（图片类**或文字类**都能改长宽）。
   * `hasText` 由 DiaryCanvas 量出来（见 bridge.elStyles），没有文字也没有图片的元素
   * （纯装饰线条之类）不给 —— 拉了也没有视觉反馈，只会让人以为坏了。
   */
  const edgeEl = (() => {
    if (expanded.length !== 1 || primary?.kind !== 'el') return null;
    const b = e.bridge.current;
    if (b?.elMedia?.[primary.id]) return primary.id;
    if (b?.elStyles?.[primary.id]?.hasText) return primary.id;
    return null;
  })();
  const canEdge = edgeLayerOk || !!edgeEl;

  /* 选中的不是图片了就别停在裁切态 */
  useEffect(() => {
    if (!isImage && cropping) setBusy(false);
  }, [isImage, cropping]);

  /* 正在改字的那张被删掉 / 换页清空选中时，退出原地编辑 */
  useEffect(() => {
    if (textEditId && !layers.some((l) => l.id === textEditId)) setTextEditId(null);
  }, [layers, textEditId]);

  const editingLayer = useMemo(
    () =>
      textEditId
        ? ((layers.find((l) => l.id === textEditId && l.type === 'text') as LayerText | undefined) ?? null)
        : null,
    [layers, textEditId],
  );

  /* ---------------- HUD 读数 ---------------- */

  const hudTextOf = useCallback(
    (r: SelRef) => {
      const { W, H } = hostSize();
      const c = visualBox(r);
      const pos = c
        ? `x ${(((c.left + c.w / 2) / W) * 100).toFixed(1)}% · y ${(((c.top + c.h / 2) / H) * 100).toFixed(1)}%`
        : '';
      if (r.kind === 'el') {
        const ov = els[r.id] ?? IDENTITY_EL;
        const name = e.bridge.current?.elLabels[r.id] ?? '元素';
        return `${name} · ${pos} · 缩放 ${(ov.sc * 100).toFixed(0)}% · 旋转 ${ov.rot.toFixed(1)}°`;
      }
      const l = layers.find((x) => x.id === r.id);
      if (!l) return '';
      const extra =
        l.type === 'text'
          ? `字号 ${l.size}px · ${(labelOf(l.font).split('·').pop() ?? '').trim()}`
          : `宽 ${(l.w * 100).toFixed(1)}%`;
      return `${pos} · ${extra} · 旋转 ${l.rot.toFixed(1)}°`;
    },
    [els, hostSize, layers, visualBox],
  );

  /**
   * 显示跟随指针的读数（坐标 / 字号）。
   * ⚠️ 传进来的是**视口坐标**（clientX/Y），而 `.dp-hud` 是 `.dp-canvas` 的子元素、
   *    住在编辑态的缩放容器里 —— 所以先减宿主原点、再除以 viewK 换成布局 px，
   *    否则读数会整体偏移（缩得越小偏得越远）。
   */
  const showHud = useCallback(
    (r: SelRef, x: number, y: number) => {
      const host = hostRef.current;
      const rect = host?.getBoundingClientRect();
      const k = rect && host ? rect.width / (host.clientWidth || 1) || 1 : 1;
      setHud({
        text: hudTextOf(r),
        x: (x - (rect?.left ?? 0)) / k,
        y: (y - (rect?.top ?? 0)) / k,
      });
    },
    [hudTextOf, hostRef],
  );

  /* ---------------- 手势 ---------------- */

  const begin = (ev: React.PointerEvent, g: Gesture, ref?: SelRef | null) => {
    ev.stopPropagation();
    /* ⚠️ `preventDefault` 是必须的，不是可选优化 —— 实测（2026-09-23）：
       不拦的话，从手柄往**下方**拖会触发浏览器的默认动作（在可滚动祖先里起拖/
       在图片上起原生拖放），浏览器随即发一个 **`pointercancel`** 把手势掐掉。
       症状极具迷惑性：**水平方向能拖、竖直方向只能动一格**（事件序列实测
       `pointerdown → gotpointercapture → pointermove → pointercancel`，
       位移只累积了 1/8）。而 `.diary-sheet` 在编辑态正好是 `overflow-y: auto`,
       竖直拖拽天然落在它的滚动轴上。
       拦掉默认行为后我们全程自己接管指针（setPointerCapture 已经在下面）。 */
    ev.preventDefault();
    rootRef.current?.setPointerCapture(ev.pointerId);
    gesture.current = g;
    setBusy(true);
    /* 在画布上按下了 → 上一次的"文字光标在某一段里"作废。
       否则用户改完某段颜色、又去点一张图片改框样式时，工具栏会以为光标还在那段里。
       双击进文字编辑不受影响：那是在 **pointerup** 里重新聚焦并登记的。 */
    clearSlotFocus();
    if (ref) showHud(ref, ev.clientX, ev.clientY);
  };

  /**
   * 「单击 = 直接点改」与「按住拖动 = 整块移动」怎么共存 —— 用**位移阈值**分：
   *   · pointerdown 不聚焦，只记下"想改这个元素的字"；
   *   · 松手时如果指针几乎没动（< 4px）→ 判定为单击 → 把光标放到点击处、直接开打；
   *   · 动过 → 判定为拖动 → 整块挪走，不碰文字。
   * 这条规则是必须的：用户前后提过两个要求 —— 早先「页面所有可编辑文字变为可直接点改」，
   * 现在又要求「文本、边框、底图等等都可以移动」。只做其中一个都会让另一个失效。
   */
  const clickRef = useRef<{ ref: SelRef; x: number; y: number; moved: boolean } | null>(null);

  /* ---------------- 换图（双击图片 / 右键「替换图片」） ----------------
     用户 2026-09-23：「点击图片可以替换图片」「双击相框里的图片可以替换图片」。
     图片贴纸是 passive 的（不接管指针，拖拽统一由画布处理），所以它上面不会产生
     原生 dblclick —— 双击只能在 end() 里按"同一对象 + 420ms 内两次未位移的点击"判定。
     文件通道用画布自带的隐藏 input，避免为每张贴纸挂一个。
     ⚠️ 2026-09-23 第三轮：目标不只有**图层**，还包括页面自带的**图片类结构元素**
        （拍立得相框、贴纸、底图）—— 所以这里存的是 SelRef 而不是 layerId。 */
  const replaceInput = useRef<HTMLInputElement>(null);
  /** quad = 四格相框的格子号（0..3 = 左上/右上/左下/右下）；缺省 = 换主图 */
  const replaceRef = useRef<{ ref: SelRef; quad?: number } | null>(null);
  const lastClick = useRef<{ ref: SelRef; t: number } | null>(null);
  const openReplace = useCallback((ref: SelRef, quad?: number) => {
    replaceRef.current = { ref, quad };
    replaceInput.current?.click();
  }, []);

  /**
   * 双击点落在四格相框的**哪一格**（0..3 = 左上/右上/左下/右下）。
   *
   * 双击在 `end()` 里判定（见 lastClick 注释），那时只有 clientX/Y —— 要换算：
   *   ① 视口 px ÷ viewK → **布局 px**（编辑态整体 scale，见 viewK 注释）；
   *   ② 减 visualBox 的中心 → 盒子本地坐标；
   *   ③ 旋转过的相框用 toLocal 转回**未旋转轴**再判象限。
   * 不是 quad 图片图层 → 返回 undefined（走"换主图"）。
   */
  const quadIndexOf = useCallback(
    (ref: SelRef, vx: number, vy: number): number | undefined => {
      if (ref.kind !== 'layer') return undefined;
      const l = layers.find((x) => x.id === ref.id);
      if (!l || l.type !== 'image' || l.frame !== 'quad') return undefined;
      const b = visualBox(ref);
      const host = hostRef.current;
      if (!b || !host) return undefined;
      const r = host.getBoundingClientRect();
      const k = viewK();
      const lx = (vx - r.left) / k - b.left - b.w / 2;
      const ly = (vy - r.top) / k - b.top - b.h / 2;
      const loc = toLocal(lx, ly, b.rot);
      const col = loc.dx >= 0 ? 1 : 0;
      const row = loc.dy >= 0 ? 1 : 0;
      return row * 2 + col;
    },
    [layers, visualBox, hostRef, viewK],
  );

  /** 这个对象能不能换图：图片图层，或者"图片类"的结构元素（相框 / 贴纸 / 底图） */
  const canReplace = useCallback(
    (ref: SelRef | null | undefined): boolean => {
      if (!ref) return false;
      if (ref.kind === 'layer') {
        return layers.some((l) => l.id === ref.id && l.type === 'image');
      }
      return !!e.bridge.current?.elMedia?.[ref.id];
    },
    [layers, e.bridge],
  );

  const onMove = (ev: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const { W, H, ar } = hostSize();

    if (g.kind === 'move') {
      /* ⚠️ 除以**视觉**尺寸（rect.width）而不是布局尺寸（W）：编辑态为了不改排版
         做了整体 scale，两者不再相等 —— 用 W 会让贴纸"跟不上鼠标"（拖 100px
         只动 100×k px）。见 viewK 的注释。 */
      const dx = (ev.clientX - g.sx) / (rect.width || W);
      const dy = (ev.clientY - g.sy) / (rect.height || H);
      /* 超过 4px 才算"拖动"，否则这次按下会被当成单击（→ 点改文字），见 clickRef 注释。
         没到门槛就**什么都不写** —— 否则"点一下"也会往库里推一条改动记录。 */
      const c = clickRef.current;
      if (c && !c.moved) {
        if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) <= 4) return;
        c.moved = true;
      }
      if (dx === g.appliedX && dy === g.appliedY) return;
      e.moveRefs(pageId, expanded, dx - g.appliedX, dy - g.appliedY, 'move');
      g.appliedX = dx;
      g.appliedY = dy;
      if (primary) showHud(primary, ev.clientX, ev.clientY);
      return;
    }

    /* 缩放与旋转都绕 activeBox 的中心 —— 单选时它就是那个对象自己的中心
       （与旧实现逐像素一致），多选/成组时就是整组的中心。 */
    const center = activeBox
      ? { x: (activeBox.left + activeBox.w / 2) / W, y: (activeBox.top + activeBox.h / 2) / H }
      : null;

    if (g.kind === 'scale') {
      if (!activeBox || !center) return;
      /* activeBox 是**布局** px，要乘 viewK 才是视口坐标（缩放后），
         否则缩放圆心会偏，鼠标一转贴纸就"跑偏"。 */
      const k = viewK();
      const cxPx = rect.left + (activeBox.left + activeBox.w / 2) * k;
      const cyPx = rect.top + (activeBox.top + activeBox.h / 2) * k;
      const d0 = Math.hypot(g.sx - cxPx, g.sy - cyPx) || 1;
      const d1 = Math.hypot(ev.clientX - cxPx, ev.clientY - cyPx);
      const kTotal = Math.max(0.05, d1 / d0);
      e.scaleRefs(pageId, expanded, kTotal / (g.appliedK || 1), center, ar, 'scale');
      g.appliedK = kTotal;
      if (primary) showHud(primary, ev.clientX, ev.clientY);
      return;
    }

    if (g.kind === 'rotate') {
      if (!center) return;
      const a1 = (Math.atan2(ev.clientY - g.cy, ev.clientX - g.cx) * 180) / Math.PI;
      let total = a1 - g.a0;
      if (ev.shiftKey) total = Math.round(total / 15) * 15;
      e.rotateRefs(pageId, expanded, total - g.appliedDeg, center, ar, 'rotate');
      g.appliedDeg = total;
      if (primary) showHud(primary, ev.clientX, ev.clientY);
      return;
    }

    /* ---------------- 拖边手柄：自由改长宽（不保持比例） ----------------
       用户 2026-09-23：「相框可以自由调整长宽」。
       做法（与 PowerPoint / 可画 的手感一致）：**对边固定、被拖的那条边跟着走**。
       指针位移先投影到贴纸的**本地轴**（贴纸可能旋转过），得到宽/高要变多少像素；
       再把中心沿本地轴平移"变化量的一半" —— 于是看起来就是那一条边在动，
       对面那条边纹丝不动。
       ⚠️ 全程在**像素空间**算，最后才折回比例存库：比例空间 x 按纸宽归一、y 按纸高
          归一，两者量纲不同，直接在里面算会把位移拉歪（纸不是正方形）。 */
    if (g.kind === 'edge') {
      const rad = (g.rot * Math.PI) / 180;
      const ex = { x: Math.cos(rad), y: Math.sin(rad) }; /* 本地 X 轴（屏幕方向） */
      const ey = { x: -Math.sin(rad), y: Math.cos(rad) }; /* 本地 Y 轴 */
      const dxs = ev.clientX - g.sx;
      const dys = ev.clientY - g.sy;
      const alongX = dxs * ex.x + dys * ex.y;
      const alongY = dxs * ey.x + dys * ey.y;
      /* 再小也要留一丢丢，否则会把贴纸拖成 0 宽然后再也抓不住 */
      const MINPX = 26;
      let wPx = g.w0 * g.pw;
      let hPx = g.h0 * g.ph;
      let shiftX = 0; /* 中心沿本地 X 轴的位移（像素） */
      let shiftY = 0;
      if (g.edge === 'e') {
        const n = Math.max(MINPX, wPx + alongX);
        shiftX = (n - wPx) / 2;
        wPx = n;
      } else if (g.edge === 'w') {
        const n = Math.max(MINPX, wPx - alongX);
        shiftX = -(n - wPx) / 2;
        wPx = n;
      } else if (g.edge === 's') {
        const n = Math.max(MINPX, hPx + alongY);
        shiftY = (n - hPx) / 2;
        hPx = n;
      } else {
        const n = Math.max(MINPX, hPx - alongY);
        shiftY = -(n - hPx) / 2;
        hPx = n;
      }
      const cxp = g.cx0 * g.pw + shiftX * ex.x + shiftY * ey.x;
      const cyp = g.cy0 * g.ph + shiftX * ex.y + shiftY * ey.y;
      if (g.target === 'layer') {
        e.updateLayer(
          pageId,
          g.id,
          {
            w: Math.min(MAX_LAYER_W, Math.max(MIN_LAYER_W, wPx / g.pw)),
            h: Math.min(MAX_EDGE_H, Math.max(MIN_EDGE_H, hPx / g.ph)),
            cx: Math.min(1, Math.max(0, cxp / g.pw)),
            cy: Math.min(1, Math.max(0, cyp / g.ph)),
          } as never,
          `edge:${g.id}`,
        );
      } else {
        /* 结构元素：尺寸是**新增的覆盖字段**（w/h），位置靠 dx/dy 平移 ——
           元素留在原版式流里，所以"对边固定"的效果由"尺寸的一半 + 位移的一半"
           一起给出来（与图层同构，只是量的名字不同）。
           ⚠️ 文字块只写**拖的那个方向**：横拉只写 w，高度继续由内容撑
              （否则会把当前内容高度冻进 h，之后多打一行就溢出）。
              见 Gesture 的 `elText` 注释。 */
        const patch: Partial<ElOverride> = {
          dx: g.dx0 + shiftX / g.pw,
          dy: g.dy0 + shiftY / g.ph,
        };
        if (!g.elText || g.edge === 'e' || g.edge === 'w') {
          patch.w = Math.min(MAX_EL_SIZE, Math.max(MIN_EL_SIZE, wPx / g.pw));
        }
        if (!g.elText || g.edge === 'n' || g.edge === 's') {
          patch.h = Math.min(MAX_EL_SIZE, Math.max(MIN_EL_SIZE, hPx / g.ph));
        }
        e.updateEl(pageId, g.id, patch, `eledge:${g.id}`);
      }
      if (primary) showHud(primary, ev.clientX, ev.clientY);
      return;
    }

    /* ---------------- 裁切 ---------------- */
    const l = g.layer;
    const { dx: ldx, dy: ldy } = toLocal(ev.clientX - g.sx, ev.clientY - g.sy, l.rot);
    const crop = l.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const fullW = g.boxW / crop.w;
    const fullH = g.boxH / crop.h;
    const nw = l.nw || 1;
    const nh = l.nh || 1;

    let { x, y, w, h } = crop;
    if (g.edge === 'r') w = crop.w + ldx / fullW;
    else if (g.edge === 'l') {
      const d = ldx / fullW;
      x = crop.x + d;
      w = crop.w - d;
    } else if (g.edge === 'b') h = crop.h + ldy / fullH;
    else {
      const d = ldy / fullH;
      y = crop.y + d;
      h = crop.h - d;
    }
    /* 先夹住尺寸，再由尺寸反推 x/y，保证「裁到边界就停住」而不是把图推出框 */
    w = Math.max(MIN_CROP, Math.min(1, w));
    h = Math.max(MIN_CROP, Math.min(1, h));
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));

    const aspect = (nw * w) / (nh * h);
    let boxW = g.boxW;
    let boxH = g.boxH;
    let left = g.left;
    let top = g.top;
    if (g.edge === 'r') {
      boxW = g.boxW + ldx;
      boxH = boxW / aspect;
    } else if (g.edge === 'l') {
      boxW = g.boxW - ldx;
      boxH = boxW / aspect;
      left = g.left + ldx;
    } else if (g.edge === 'b') {
      boxH = g.boxH + ldy;
      boxW = boxH * aspect;
    } else {
      boxH = g.boxH - ldy;
      boxW = boxH * aspect;
      top = g.top + ldy;
    }
    boxW = Math.max(16, boxW);
    boxH = Math.max(16, boxH);

    /* 这里的 boxW / left / top 全是**视口 px**（裁切手势按 getBoundingClientRect 算的），
       所以除的必须是视觉宽高 —— 编辑态为了不改排版做了整体 scale，
       W/H 是布局值，用它们换算比例会偏 1/k 倍（裁完尺寸对不上）。 */
    const pw = rect.width || W;
    const ph = rect.height || H;
    const patch: Partial<DiaryLayer> = {
      w: boxW / pw,
      cx: (left - rect.left + boxW / 2) / pw,
      cy: (top - rect.top + boxH / 2) / ph,
      crop: clampCrop({ x, y, w, h }),
    } as Partial<DiaryLayer>;
    e.updateLayer(pageId, l.id, patch, `crop:${l.id}`);
    showHud({ kind: 'layer', id: l.id }, ev.clientX, ev.clientY);
  };

  const end = (ev: React.PointerEvent) => {
    rootRef.current?.releasePointerCapture?.(ev.pointerId);
    gesture.current = null;
    setBusy(false);
    setHud(null);
    /* 单击（没拖动过）→ 直接开打：把光标落到点击处。见 clickRef 的注释。
       ⚠️ 例外：**双击一张图片 = 换图**（用户：「点击图片可以替换图片」）。
          图片贴纸是 passive 的（不接管指针），双击它浏览器不会给任何原生事件，
          所以只能在"松手未位移"这条路径上自己做双击判定。 */
    const c = clickRef.current;
    clickRef.current = null;
    if (!c || c.moved) return;
    const prev = lastClick.current;
    lastClick.current = { ref: c.ref, t: Date.now() };
    if (canReplace(c.ref) && prev && sameRef(prev.ref, c.ref) && Date.now() - prev.t < 420) {
      lastClick.current = null;
      /* 四格相框：按双击点算格子号 —— 双击哪格换哪格；别的框 = 换主图 */
      openReplace(c.ref, quadIndexOf(c.ref, c.x, c.y));
      return;
    }
    focusTextAt(c.ref, c.x, c.y);
  };

  /**
   * 把光标放到"点击的位置"上。
   * 因为 pointerdown 被画布捕获了（原生事件没走到文字节点），浏览器不会自己放光标，
   * 所以用 `caretRangeFromPoint` 反查点击处的文本位置，再手动落 range ——
   * 这样"点哪改哪"的手感和没拦截事件时完全一样。
   *
   * ⚠️ 实测踩到的坑（症状很隐蔽）：`caretRangeFromPoint` 会被**命中框**挡住。
   *    `.dp-elhit` 是盖在文字上的一层透明 div（pointer-events: auto、没有文本），
   *    浏览器算出来的 caret 会落在**画布容器**上（实测 anchorNode = `DIV.dp-canvas`）。
   *    于是：焦点确实在标题上、`document.activeElement` 也对，
   *    但 selection 不在任何可编辑节点里 → 打字屏幕键盘没反应、`insertText` 返回
   *    false → **"点了能选、就是打不进字"**（回归脚本那条"封面改字写入 IndexedDB"
   *    失败的真因）。
   *    解法：查 caret 之前把覆盖层临时 `display:none`（`display:none` 的元素必然
   *    不参与 caret 计算），查完**在同一个同步块里**立刻恢复 —— 不 paint，所以
   *    看不到闪烁。再兜一层：万一拿到的位置仍不在文字槽里，退到"离点击横坐标
   *    最近的字符"（见 nearestOffsetIn）。
   */
  const focusTextAt = useCallback(
    (ref: SelRef, x: number, y: number) => {
      if (ref.kind !== 'el') return;
      const host = hostRef.current;
      if (!host) return;
      const wrap = host.querySelector<HTMLElement>(`[data-dp-el="${ref.id}"]`);
      if (!wrap || !wrap.querySelector('[data-dp-slot]')) return;
      if (!focusText(ref, { x, y })) return;

      const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      };

      /* 1) 临时藏掉覆盖层，让 caret 能真正落到文字上 */
      const overlays = Array.from(
        host.querySelectorAll<HTMLElement>('.dp-elhit, .dp-sel, .dp-selm, .dp-selmark, .dp-handle'),
      );
      const saved = overlays.map((o) => o.style.display);
      overlays.forEach((o) => {
        o.style.display = 'none';
      });
      let hit: { node: Node; off: number } | null = null;
      try {
        const r = doc.caretRangeFromPoint?.(x, y) ?? null;
        if (r) hit = { node: r.startContainer, off: r.startOffset };
        else {
          const p = doc.caretPositionFromPoint?.(x, y) ?? null;
          if (p) hit = { node: p.offsetNode, off: p.offset };
        }
      } catch {
        /* 拿不到就走下面的兜底 */
      } finally {
        overlays.forEach((o, i) => {
          o.style.display = saved[i];
        });
      }

      /* 2) 必须落在**正在编辑的那个文字槽**里才算数 */
      const active = document.activeElement as HTMLElement | null;
      const slot =
        active && active.hasAttribute?.('data-dp-slot')
          ? active
          : wrap.querySelector<HTMLElement>('[data-dp-slot]');
      if (!slot) return;
      rememberSlotEl(slot);
      if (!hit || !slot.contains(hit.node)) hit = nearestOffsetIn(slot, x);
      if (!hit) return;

      try {
        const range = document.createRange();
        const node = hit.node;
        const max = node.nodeType === 3 ? (node as Text).data.length : 0;
        range.setStart(node, Math.max(0, Math.min(hit.off, max || hit.off)));
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        /* 光标落位失败不影响"能改字"这件事本身 */
      }
    },
    [focusText, hostRef],
  );

  /* ---------------- 框选（空白处拖出一个矩形） ---------------- */

  const orderedBoxesRef = useLatest(orderedBoxes);
  const selectionRef = useLatest(selection);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    /**
     * 只在"纸面空处"起框选。
     * 编辑态里纸内所有装饰都是 pointer-events:none、只有命中框 / 手柄是 auto，
     * 所以点空处时事件的 target 恰好是 `.diary-sheet`（或宿主自己）——
     * 用它当判据最省事，也不会和命中框上的拖动手势打架。
     */
    const isPaper = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el === host) return true;
      return el.classList?.contains('diary-sheet') || el.classList?.contains('diary-paper');
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || !isPaper(ev.target)) return;
      const r = host.getBoundingClientRect();
      /* ⚠️ 存的是**布局 px**（除以 viewK）：`.dp-marquee` 在缩放容器里，CSS px 会
         跟着被 scale，直接存视口位移会画出一个比拖拽区域大的框。 */
      const k = r.width / (host.clientWidth || 1) || 1;
      const add = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      if (!add) e.setSel(null);
      const m = { x0: (ev.clientX - r.left) / k, y0: (ev.clientY - r.top) / k, x1: 0, y1: 0, add };
      m.x1 = m.x0;
      m.y1 = m.y0;
      mqRef.current = m;
      setMarquee(m);
      try {
        host.setPointerCapture(ev.pointerId);
      } catch {
        /* 捕获失败不影响后续（move 仍然会冒泡到宿主） */
      }
    };
    const onMoveMq = (ev: PointerEvent) => {
      const m = mqRef.current;
      if (!m) return;
      const r = host.getBoundingClientRect();
      const k = r.width / (host.clientWidth || 1) || 1;
      const n = { ...m, x1: (ev.clientX - r.left) / k, y1: (ev.clientY - r.top) / k };
      mqRef.current = n;
      setMarquee(n);
    };
    const onUp = (ev: PointerEvent) => {
      const m = mqRef.current;
      if (!m) return;
      mqRef.current = null;
      setMarquee(null);
      try {
        host.releasePointerCapture(ev.pointerId);
      } catch {
        /* 可能已经自动释放 */
      }
      const W = host.clientWidth || 1;
      const H = host.clientHeight || 1;
      const x0 = Math.min(m.x0, m.x1);
      const y0 = Math.min(m.y0, m.y1);
      const x1 = Math.max(m.x0, m.x1);
      const y1 = Math.max(m.y0, m.y1);
      /* 只是点了一下空白（没有拖出面积）→ 不当框选，前面那句 setSel(null) 已经完成取消选中 */
      if (x1 - x0 < 6 && y1 - y0 < 6) return;
      const hit: SelRef[] = [];
      for (const it of orderedBoxesRef.current()) {
        const b = it.box;
        if (
          Math.abs(b.cx - (x0 + x1) / 2 / W) * 2 < b.w + (x1 - x0) / W &&
          Math.abs(b.cy - (y0 + y1) / 2 / H) * 2 < b.h + (y1 - y0) / H
        ) {
          hit.push(it.ref);
        }
      }
      if (!hit.length) return;
      const cur = selectionRef.current;
      const merged = m.add ? [...cur, ...hit.filter((r) => !cur.some((s) => sameRef(s, r)))] : hit;
      e.setSelection(merged);
    };
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMoveMq);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    return () => {
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMoveMq);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
    };
  }, [hostRef, e, orderedBoxesRef, selectionRef]);

  /* ---------------- 右键菜单 ----------------
     用户 2026-09-23：「鼠标右键功能就是常用的复制粘贴剪切成组拆组等功能，类似于
     可画或者 PPT 的那样」。

     命中规则跟左键保持一致：右键**点在某个对象上**先把它选上（若它已经在选中集里
     就保持不动 —— 这样"框选一堆 → 右键"能直接对整批操作）；点在纸面空处则取消选中。
     菜单本身在 CtxMenu 里（portal 到 body，否则会被 overflow 裁掉）。 */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onCtx = (ev: MouseEvent) => {
      /* 只接管落在画布里的右键；书外的右键（页面背景、浏览器本身）留给浏览器 */
      if (!host.contains(ev.target as Node)) return;
      ev.preventDefault();
      const r = host.getBoundingClientRect();
      /* 用**视觉**宽高做归一化（clientX 是视口 px，编辑态整体有 scale） */
      const pw = r.width || host.clientWidth || 1;
      const ph = r.height || host.clientHeight || 1;
      const pt = { cx: (ev.clientX - r.left) / pw, cy: (ev.clientY - r.top) / ph, w: 0, h: 0 };
      const list = orderedBoxesRef.current();
      /* orderedBoxes 是"从下到上"排的 → 倒着找，第一个命中的就是最上面那个 */
      let hit: SelRef | null = null;
      for (let i = list.length - 1; i >= 0; i--) {
        if (boxHit(list[i].box, pt)) {
          hit = list[i].ref;
          break;
        }
      }
      const cur = selectionRef.current;
      if (hit) {
        if (!cur.some((s) => sameRef(s, hit))) e.setSelection([hit]);
      } else {
        e.setSel(null);
      }
      setMenu({ x: ev.clientX, y: ev.clientY });
    };
    host.addEventListener('contextmenu', onCtx);
    return () => host.removeEventListener('contextmenu', onCtx);
  }, [hostRef, e, orderedBoxesRef, selectionRef]);

  /* ---------------- 渲染 ---------------- */

  const { W: hostW, H: hostH } = hostSize();
  const group = primary ? e.groupOf(pageId, primary) : null;
  const groupHint = group && expanded.length > 1 ? `组合「${group.name}」· ${expanded.length} 个对象` : null;

  /* ---------- 右键菜单的内容 ----------
     项与快捷键一一对应（都是同一套 context API），不存在"右键能做、快捷键做不了"
     或者反过来的情况 —— 这是 PowerPoint 的一致性原则。 */
  const nSel = selection.length;
  const nEl = selection.filter((r) => r.kind === 'el').length;

  const menuHead = (() => {
    if (!nSel) return '纸面空白处';
    if (nSel > 1) return `已选中 ${nSel} 个对象`;
    const only = selection[0];
    if (only.kind === 'el') return `页面元素 · ${e.bridge.current?.elLabels?.[only.id] ?? only.id}`;
    const l = layers.find((x) => x.id === only.id);
    if (!l) return '贴纸';
    return l.type === 'text' ? '文字贴纸' : l.type === 'video' ? '视频贴纸' : '图片贴纸';
  })();

  const menuItems: CtxItem[] = [
    {
      kind: 'item',
      label: '剪切',
      hint: 'Ctrl+X',
      disabled: !nSel,
      onPick: () => {
        if (!e.cutSelection()) e.say('先选中要剪切的对象');
      },
    },
    {
      kind: 'item',
      label: '复制',
      hint: 'Ctrl+C',
      disabled: !nSel,
      onPick: () => {
        if (!e.copySelection()) e.say('先选中要复制的对象');
      },
    },
    {
      kind: 'item',
      label: '粘贴',
      hint: 'Ctrl+V',
      onPick: () => {
        if (!e.pasteClipboard(pageId)) e.say('剪贴板里还没有内容');
      },
    },
    {
      kind: 'item',
      label: '再制',
      hint: 'Ctrl+D',
      disabled: !nSel,
      onPick: () => {
        e.duplicateSelection();
      },
    },
    { kind: 'sep' },
    {
      kind: 'item',
      label: '置于顶层',
      hint: 'Ctrl+Shift+]',
      disabled: !nSel,
      onPick: () => e.orderRefs(pageId, e.selection, 'front'),
    },
    {
      kind: 'item',
      label: '上移一层',
      hint: 'Ctrl+]',
      disabled: !nSel,
      onPick: () => e.orderRefs(pageId, e.selection, 'up'),
    },
    {
      kind: 'item',
      label: '下移一层',
      hint: 'Ctrl+[',
      disabled: !nSel,
      onPick: () => e.orderRefs(pageId, e.selection, 'down'),
    },
    {
      kind: 'item',
      label: '置于底层',
      hint: 'Ctrl+Shift+[',
      disabled: !nSel,
      onPick: () => e.orderRefs(pageId, e.selection, 'back'),
    },
    { kind: 'sep' },
    {
      kind: 'item',
      label: '组合',
      hint: 'Ctrl+G',
      disabled: nSel < 2,
      onPick: e.groupSelection,
    },
    { kind: 'item', label: '取消组合', hint: 'Ctrl+Shift+G', disabled: !nSel, onPick: e.ungroupSelection },
    { kind: 'sep' },
    {
      kind: 'item',
      label: '水平居中',
      hint: 'Ctrl+E',
      disabled: !nSel,
      onPick: () => e.alignRefs(pageId, e.selection, 'hcenter'),
    },
    {
      kind: 'item',
      label: '垂直居中',
      hint: 'Ctrl+Shift+E',
      disabled: !nSel,
      onPick: () => e.alignRefs(pageId, e.selection, 'vcenter'),
    },
    /* 只有选中了页面自带的元素才出现：把挪走的元素放回原位（保留改过的字体字号颜色） */
    ...(nEl
      ? ([
          { kind: 'sep' },
          { kind: 'item', label: '回到原位', hint: '', onPick: () => e.resetElTransform() },
        ] as CtxItem[])
      : []),
    { kind: 'sep' },
    /* 「替换图片」：图片图层，或**图片类的结构元素**（相框 / 贴纸 / 底图）。
       后者是 2026-09-23 第三轮加的（用户：「双击相框里的图片可以替换图片」）。 */
    ...(canReplace(primary)
      ? ([
          { kind: 'item', label: '替换图片', hint: '双击', onPick: () => primary && openReplace(primary) },
        ] as CtxItem[])
      : []),
    { kind: 'item', label: '编辑文字', hint: 'F2', disabled: !nSel, onPick: e.editSelectedText },
    { kind: 'item', label: '全选本页', hint: 'Ctrl+A', onPick: e.selectAllOnPage },
    {
      kind: 'item',
      label: '删除',
      hint: 'Delete',
      danger: true,
      disabled: !nSel,
      onPick: e.deleteSelection,
    },
  ];

  /** 一个图层的手势（选中 / 拖动 / 双击改字）—— 普通档与沉底代理**共用同一份** */
  const layerHandlers = (l: DiaryLayer) => ({
    onPointerDown: (ev: React.PointerEvent) => {
      if (ev.button !== 0) return;
      const r: SelRef = { kind: 'layer', id: l.id };
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
        e.selectRef(r, 'toggle');
        /* 加选/减选时不参与"双击换图/改字"的判定 */
        clickRef.current = null;
      } else {
        if (!selection.some((s) => sameRef(s, r))) e.selectRef(r);
        /* 记一笔"点了这个图层"；松手时未位移 → 走 end() 里的单击/双击判定
           （双击图片 = 换图、双击四格 = 换那一格）。⚠️ 之前图层漏了这一笔，
           clickRef 恒为 null → end() 直接 return → 双击换图从来没生效过
           （2026-09-23 被四格相框的双击换格探针当场抓出）。 */
        clickRef.current = { ref: r, x: ev.clientX, y: ev.clientY, moved: false };
      }
      begin(ev, { kind: 'move', sx: ev.clientX, sy: ev.clientY, appliedX: 0, appliedY: 0 }, r);
    },
    onDoubleClick: (ev: React.MouseEvent) => {
      /* 双击文字贴纸 = 原地改字（单击是选中/拖动，见 InlineTextEditor 注释） */
      if (l.type === 'text') {
        ev.stopPropagation();
        e.selectRef({ kind: 'layer', id: l.id });
        setTextEditId(l.id);
      }
    },
  });

  /** 普通档图层：画在画布里，本体既可见又可点 */
  const renderLayerHit = (l: DiaryLayer) =>
    l.id === textEditId ? null : (
      <div className="dp-hit" key={l.id} {...layerHandlers(l)}>
        <LayerView layer={l} mode="live" />
      </div>
    );

  /**
   * 沉底档的**视觉**（portal 到 `.dp-under-slot`）：只画不管点 —— `passive` 会把
   * pointer-events 内联关掉。命中交给下面的代理框，看图的和点东西的彻底分开。
   */
  const renderLayerSkin = (l: DiaryLayer) =>
    l.id === textEditId ? null : (
      <div className="dp-hit" key={l.id} data-dp-sunk-skin="1">
        <LayerView layer={l} mode="live" passive />
      </div>
    );

  /**
   * 沉底档的**命中代理**：留在画布里，只画一个透明矩形。
   *
   * 为什么必须有它（用户 2026-09-23 报的就是这个）：图层沉到 `.diary-sheet` 之下以后，
   * elementFromPoint 永远先命中 sheet —— sheet 是满幅的定位元素、又是 `.dp-under-slot`
   * 的兄弟而树序在后，所以它把整页都盖住了。结果是**沉下去就再也点不着、拖不动**，
   * 用户只会觉得"东西弄丢了"。视觉沉下去、命中留在上面，两件事各自成立。
   *
   * 代价与既有行为一致：它矩形内点到的是贴纸而不是底下的字 —— 和结构元素的命中框
   * （`.dp-elhit`）是同一套规则，用户已经熟悉这一套。
   */
  const renderSunkProxy = (l: DiaryLayer) => {
    if (l.id === textEditId) return null;
    /**
     * ⚠️ 位置**按比例现算**，不查 `layerBoxes` —— 那份实测数据有致命的时间差：
     * portal 里的图层比 `measure()` 晚一帧才挂进 DOM（`underHost` 要先 setState），
     * 而 `measure` 的依赖当时已经烧完 ⇒ 永远量不到它 ⇒ 代理拿到空盒子被丢掉，
     * 表现为"沉底以后整块点不着"。比例算出来的位置和图层自己用的 `layerBox()` 同源，
     * 不存在这类竞态。
     * ⚠️ 图片图层的高度必须自己补：`layer.h` 只在"用户拉过框"时才有，
     * 否则高度由 `.dp-media` 的 aspectRatio 撑 —— 不补的话代理是个 0 高的线，点不着。
     */
    const { W, H } = hostSize();
    const hpx = l.h !== undefined ? l.h * H : (l.w * W) / (displayAspect(l) || 1);
    return (
      <div className="dp-hit is-sunk" key={`sunk-${l.id}`} {...layerHandlers(l)}>
        <span
          className="dp-sunk-proxy"
          style={{
            left: `${l.cx * 100}%`,
            top: `${l.cy * 100}%`,
            width: `${l.w * 100}%`,
            height: hpx,
            transform: `translate(-50%, -50%) rotate(${l.rot}deg)`,
          }}
        />
      </div>
    );
  };

  return (
    <div
      className={`dp-canvas${busy ? ' is-busy' : ''}`}
      ref={rootRef}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {/* ---------- 结构元素的命中框 ----------
          透明、只负责"点得到"。单选即选中、拖动即位移；双击进文字编辑。
          正在点改的那个元素让开（pointer-events: none），这样在字里点一下是移光标。 */}
      {Object.keys(boxes).map((id) => {
        const b = boxes[id];
        if (!b) return null;
        const ov = els[id];
        const sc = ov?.sc ?? 1;
        const rot = ov?.rot ?? 0;
        const style: CSSProperties = {
          left: b.left + (ov?.dx ?? 0) * hostW + (b.w - b.w * sc) / 2,
          top: b.top + (ov?.dy ?? 0) * hostH + (b.h - b.h * sc) / 2,
          width: b.w * sc,
          height: b.h * sc,
        };
        if (rot) style.transform = `rotate(${rot}deg)`;
        const sel = selection.some((r) => r.kind === 'el' && r.id === id);
        const muted = focusEl === id;
        return (
          <div
            key={`el-${id}`}
            className={`dp-elhit${sel ? ' is-on' : ''}${muted ? ' is-muted' : ''}`}
            style={style}
            title={e.bridge.current?.elLabels[id] ?? id}
            onPointerDown={(ev) => {
              if (ev.button !== 0) return;
              const shift = ev.shiftKey || ev.metaKey || ev.ctrlKey;
              if (shift) {
                /* 加选/减选时不打算改字（用户是在组一批东西） */
                e.selectRef({ kind: 'el', id }, 'toggle');
                clickRef.current = null;
              } else {
                if (!sel) e.selectRef({ kind: 'el', id });
                /* 记一笔"想改这个元素的字"；松手时如果没拖动过就执行 */
                clickRef.current = { ref: { kind: 'el', id }, x: ev.clientX, y: ev.clientY, moved: false };
              }
              begin(ev, { kind: 'move', sx: ev.clientX, sy: ev.clientY, appliedX: 0, appliedY: 0 }, { kind: 'el', id });
            }}
            onDoubleClick={(ev) => {
              ev.stopPropagation();
              e.selectRef({ kind: 'el', id });
              if (!e.bridge.current?.focusText({ kind: 'el', id }, { x: ev.clientX, y: ev.clientY })) {
                e.say('这个元素没有可编辑的文字 —— 想写字可以用「插入媒体」旁边的「添加文字」');
              }
            }}
          />
        );
      })}

      {/* ---------- 沉底图层的命中代理（透明，只负责点得到） ----------
          排在普通图层**之前**：万一沉底贴纸上又压了个普通贴纸，重叠处该选上面那个。 */}
      {sunkLayers.map(renderSunkProxy)}

      {/* ---------- 用户图层（普通档：画在画布里，压在正文之上） ----------
          「沉到页面内容下面」的那些不在这里 —— 视觉走下面的 portal，命中走上面那排代理。 */}
      {topLayers.map(renderLayerHit)}

      {/* ---------- 多选时的逐个细框（主选中框另画，带手柄） ---------- */}
      {expanded.length > 1
        ? expanded.map((r) => {
            const b = visualBox(r);
            if (!b) return null;
            return (
              <span
                key={`mk-${r.kind}-${r.id}`}
                className="dp-selmark"
                style={{ left: b.left, top: b.top, width: b.w, height: b.h, transform: `rotate(${b.rot}deg)` }}
              />
            );
          })
        : null}

      {/* ---------- 主选中框 + 手柄（多选/成组时作用在包围盒上） ---------- */}
      {activeBox ? (
        <div
          className={`dp-sel${expanded.length > 1 ? ' is-group' : ''}`}
          style={{
            left: activeBox.left,
            top: activeBox.top,
            width: activeBox.w,
            height: activeBox.h,
            transform: `rotate(${activeBox.rot}deg)`,
          }}
        >
          {groupHint ? <span className="dp-group-tag">{groupHint}</span> : null}
          {!cropping ? (
            <>
              <span
                className="dp-handle is-rot"
                title="拖动旋转（按住 Shift 每 15° 吸附）"
                onPointerDown={(ev) => {
                  const r = rectOf();
                  if (!r) return;
                  /* 布局 px × viewK = 视口 px（编辑态整体缩放后两者不等），
                     否则旋转圆心会偏，鼠标会"绕着错的地方转" */
                  const k = viewK();
                  const cx = r.left + (activeBox.left + activeBox.w / 2) * k;
                  const cy = r.top + (activeBox.top + activeBox.h / 2) * k;
                  begin(
                    ev,
                    {
                      kind: 'rotate',
                      cx,
                      cy,
                      a0: (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI,
                      appliedDeg: 0,
                    },
                    primary,
                  );
                }}
              />
              {(['nw', 'ne', 'se', 'sw'] as const).map((c) => (
                <span
                  key={c}
                  className={`dp-handle is-scale is-${c}`}
                  title="拖动缩放（保持比例）"
                  onPointerDown={(ev) =>
                    begin(ev, { kind: 'scale', sx: ev.clientX, sy: ev.clientY, appliedK: 1 }, primary)
                  }
                />
              ))}
              {/* 四条边 = 自由改长宽（不保持比例）。用户：「相框可以自由调整长宽」
                  「像这样可以调整底图的长宽」「图片相框也要自由调整长宽」
                  「正文块也可以调整长宽……可以自行换行」。
                  目标：单选的图片/视频图层，或单选的结构元素（图片类 + 文字类）。
                  见 canEdge 注释（代价与配套 CSS 也写在那里）。 */}
              {canEdge
                ? (['n', 's', 'e', 'w'] as const).map((edge) => (
                    <span
                      key={edge}
                      className={`dp-handle is-edge is-${edge}`}
                      title={
                        edgeEl && !e.bridge.current?.elMedia?.[edgeEl]
                          ? '拖动这条边：改这个文字框的长宽（横向改宽会重新折行）'
                          : '拖动这条边：自由调整长宽（不保持比例）'
                      }
                      onPointerDown={(ev) => {
                        const r = rectOf();
                        if (!r) return;
                        /* 两类目标的起始几何都换算到"比例空间 + 纸面视觉像素"：
                           图层读自己的 w/h（h 缺省时按纵横比推），
                           结构元素读 elBoxes 的**原位盒**（不含覆盖变换）。 */
                        const base = (() => {
                          const l = edgeLayer;
                          if (l && (l.type === 'image' || l.type === 'video') && l.frame !== 'circle') {
                            return {
                              w0: l.w,
                              h0:
                                l.h !== undefined
                                  ? l.h
                                  : (l.w * r.width) / (displayAspect(l) || 1) / r.height,
                              cx0: l.cx,
                              cy0: l.cy,
                              dx0: 0,
                              dy0: 0,
                              rot: l.rot,
                              /** 目标是不是"文字块"（只写拖的那个方向，见 Gesture 注释） */
                              elText: false,
                            };
                          }
                          const b = edgeEl ? e.bridge.current?.elBoxes?.[edgeEl] : null;
                          if (!b || !edgeEl) return null;
                          const ov = e.elOf(pageId, edgeEl);
                          return {
                            w0: b.w,
                            h0: b.h,
                            cx0: b.cx,
                            cy0: b.cy,
                            dx0: ov?.dx ?? 0,
                            dy0: ov?.dy ?? 0,
                            rot: ov?.rot ?? 0,
                            elText: !e.bridge.current?.elMedia?.[edgeEl],
                          };
                        })();
                        if (!base) return;
                        begin(
                          ev,
                          {
                            kind: 'edge',
                            target: edgeLayer ? 'layer' : 'el',
                            id: edgeLayer ? edgeLayer.id : (edgeEl as string),
                            edge,
                            sx: ev.clientX,
                            sy: ev.clientY,
                            ...base,
                            pw: r.width,
                            ph: r.height,
                          },
                          primary,
                        );
                      }}
                    />
                  ))
                : null}
            </>
          ) : null}

          {cropping && isImage && selectedLayer ? (
            <>
              {(['l', 'r', 't', 'b'] as const).map((edge) => (
                <span
                  key={edge}
                  className={`dp-handle is-crop is-${edge}`}
                  title="拖动裁切"
                  onPointerDown={(ev) => {
                    const r = rectOf();
                    if (!r) return;
                    const boxW = selectedLayer.w * r.width;
                    const aspect = displayAspect(selectedLayer) || 1;
                    const boxH = boxW / aspect;
                    begin(ev, {
                      kind: 'crop',
                      id: selectedLayer.id,
                      edge,
                      layer: selectedLayer,
                      sx: ev.clientX,
                      sy: ev.clientY,
                      boxW,
                      boxH,
                      left: r.left + selectedLayer.cx * r.width - boxW / 2,
                      top: r.top + selectedLayer.cy * r.height - boxH / 2,
                    });
                  }}
                />
              ))}
              <span className="dp-crop-tip">拖动四条边裁切 · 再点一次「裁切」结束</span>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ---------- 框选矩形 ---------- */}
      {marquee ? (
        <span
          className="dp-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      ) : null}

      {/* 跟随指针的实时读数（用户要的「坐标 + 字号」） */}
      {hud ? (
        <span className="dp-hud" style={{ left: hud.x + 16, top: hud.y + 16 }}>
          {hud.text}
        </span>
      ) : null}

      {/* 原地改字的编辑器：几何与贴纸完全一致，退焦即写回 doc */}
      {editingLayer ? (
        <InlineTextEditor
          key={editingLayer.id}
          layer={editingLayer}
          style={layerFrameStyle(editingLayer, layerBoxes[editingLayer.id])}
          onCommit={(text) => e.updateLayer(pageId, editingLayer.id, { text } as Partial<DiaryLayer>)}
          onClose={() => setTextEditId(null)}
        />
      ) : null}

      {/* 换图的文件通道（双击图片 / 右键「替换图片」；四格相框双击某格 = 换那格） */}
      <input
        ref={replaceInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          const target = replaceRef.current;
          replaceRef.current = null;
          if (f && target) {
            /* 三条落库路径：四格的格子 → replaceQuadCell；自由图层 → 换主图；
               结构元素 → 换元素内图片（四格只存在于图片图层上） */
            if (target.ref.kind === 'layer' && target.quad !== undefined)
              void e.replaceQuadCell(pageId, target.ref.id, f, target.quad);
            else if (target.ref.kind === 'layer') void e.replaceImageFile(pageId, target.ref.id, f);
            else void e.replaceElImage(pageId, target.ref.id, f);
          }
          ev.target.value = '';
        }}
      />

      {/* 右键菜单（portal 到 body，但放在这里才能读到最新的选中与层级） */}
      {menu ? (
        <CtxMenu
          x={menu.x}
          y={menu.y}
          head={menuHead}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {/* ---------- 「沉到页面内容下面」的图层：视觉 portal 到 .dp-under-slot ----------
          为什么非 portal 不可：`.dp-canvas` 自己 z-index 60，**整体**压在 `.diary-sheet`
          之上，在它内部无论怎么调 z 都沉不到正文下面（这正是用户说的
          「贴纸点击置于底部没反应」的第二层原因）。
          搬到 `.dp-under-slot`（z=0，且**排在 `.diary-sheet` 之前**）后，靠"同档定位元素
          按树序绘制"得到 纸 → 贴纸 → 正文 的顺序，阅读态 `.dp-layerhost.is-under` 同此理。
          注意这里只搬**画面**、不搬交互：命中由上面那排 `.dp-sunk-proxy` 负责。 */}
      {underHost && sunkLayers.length
        ? createPortal(
            <>{sunkLayers.map(renderLayerSkin)}</>,
            underHost,
          )
        : null}
    </div>
  );
}

/* ============================ 小工具 ============================ */

/** 文字贴纸的框：有实测盒子就按实测（比算出来的准，含边框内边距），否则退回 layerBox */
function layerFrameStyle(l: DiaryLayer, b?: PxBox): CSSProperties {
  if (!b) {
    const s = layerBox(l);
    const aspect = l.type === 'text' ? undefined : l.frame === 'circle' ? 1 : displayAspect(l) || 1;
    return aspect ? { ...s, aspectRatio: String(aspect) } : s;
  }
  return {
    position: 'absolute',
    left: b.left,
    top: b.top,
    width: b.w,
    height: b.h,
    transform: `rotate(${l.rot}deg)`,
    zIndex: 10 + l.z,
  };
}

/** 字体名 → 编辑器字体 id（复制结构元素时用；认不出来就跟随本页正文） */
function guessFont(family: string): string {
  const f = family.toLowerCase();
  if (f.includes('hutu') || f.includes('频凡')) return 'pflutu';
  if (f.includes('nanooldsong')) return 'nano';
  if (f.includes('caveat')) return 'caveat';
  if (f.includes('nanum pen')) return 'nanum-pen';
  if (f.includes('dancing')) return 'dancing';
  if (f.includes('press start')) return 'press-start';
  return 'default';
}

/** 只接受 rgb()/rgba()/hex —— 别的（color-mix 之类）一律退回默认色，免得图层存了浏览器认不出的值 */
function cssColor(v: string): string {
  const s = (v || '').trim();
  if (/^rgba?\(/.test(s) || /^#[0-9a-f]{3,8}$/i.test(s)) return s;
  return '';
}

/**
 * 在文字槽里按横坐标找**最近的字符间位置**。
 *
 * 用途：`caretRangeFromPoint` 偶尔仍会失准（点在行末留白、文字被 transform 缩放过…），
 * 这时至少要保证光标落在**这个槽里** —— 否则用户点了半天打不进字，还不知道为什么。
 * 只在点击那一下跑一次，一个槽几十到几百字符，代价可忽略。
 */
function nearestOffsetIn(slot: HTMLElement, x: number): { node: Node; off: number } | null {
  const walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let best: { node: Node; off: number; d: number } | null = null;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    const len = t.data.length;
    if (!len) continue;
    for (let i = 0; i <= len; i++) {
      r.setStart(t, i);
      r.setEnd(t, Math.min(len, i + 1));
      const b = r.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      const d = Math.abs(b.left - x);
      if (!best || d < best.d) best = { node: t, off: i, d };
    }
  }
  return best ? { node: best.node, off: best.off } : null;
}

/** 一个恒为最新的 ref（原生事件监听器里读最新值，不必把值写进 effect 依赖） */
function useLatest<T>(v: T): MutableRefObject<T> {
  const r = useRef(v);
  r.current = v;
  return r;
}
