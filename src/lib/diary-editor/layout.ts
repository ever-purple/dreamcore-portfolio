/**
 * 手账编辑器 —— 图层的几何换算
 * =============================================================================
 * 图层坐标全是**比例**（见 types.ts 的说明），这里是比例 ↔ CSS 的唯一转换点。
 * 所有渲染路径（12 条带的静态渲染 / 编辑态的单页渲染 / 视频覆盖层）都走这几个函数，
 * 保证同一张图在任何路径下位置都逐像素一致 —— 否则翻页时贴纸会"跳"一下。
 */

import type { CSSProperties } from 'react';
import type { DiaryImageCrop, DiaryLayer, ElOverride, ElTextStyle, ProBox } from './types';
import { isEmptyElText, isIdentityEl } from './types';
import { familyOf } from './fonts';

/**
 * 把颜色往白里提亮 —— 牛皮纸的 `linear-gradient(paper-2 → paper)` 需要一个
 * 「比纸色浅一档」的伴色。用户用取色器挑了自定义纸色时，两端都由这个函数算出来，
 * 这样纸纹（渐变 + 噪点）在任何纸色下都还在，不会变成一块死板色。
 *
 * 支持 `#rgb` / `#rrggbb`；别的写法（rgb()/hsl()/关键字）原样返回 —— 宁可纹理丢一点，
 * 也不要因为解析失败把纸变成透明。
 */
export function lighten(color: string, amount: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * 结构元素层级（z-index）的**下限**。
 *
 * ⚠️ 用户 2026-09-23：「置于底层是要放在页面纸张上面，现在是在纸张下面」。
 *    原因是层叠顺序：`.diary-band` 每帧被 JS 写 transform ⇒ 它自己是**层叠上下文**；
 *    在这个上下文里负 z-index 的子孙排在**第 2 步**绘制，而纸张 `.diary-paper`
 *    是 `z-index: 0` 的定位元素、排在**第 6 步** —— 于是"置底"（`minZ - n`）
 *    一旦算出负数，元素就被纸整个盖住，看不见也点不到（看起来像"删掉了"）。
 *    下限取 1：纸是 0，所以永远压在纸**之上**；而元素之间仍能正常比大小。
 *    图层的 z 是另一套基数（`layerBox` 用 10 + z），不受这个下限约束。
 */
export const Z_FLOOR = 1;

/** 图层外框的定位样式（左/上/宽/高/居中偏移/旋转/层级） */
export function layerBox(layer: DiaryLayer): CSSProperties {
  const s: CSSProperties = {
    left: `${layer.cx * 100}%`,
    top: `${layer.cy * 100}%`,
    width: `${layer.w * 100}%`,
    transform: `translate(-50%, -50%) rotate(${layer.rot}deg)`,
    zIndex: 10 + layer.z,
  };
  /* 只有"用户拖边手柄自由拉过框"的贴纸才有明确高度（见 types.ts 的 LayerBase.h）；
     没有 h 时高度交给 `.dp-media` 的 aspectRatio，保持"显示与以前逐像素一致"。 */
  if (layer.h !== undefined) s.height = `${layer.h * 100}%`;
  return s;
}

/** 素材原始纵横比（宽/高）。未知时给 1，避免除零。 */
export function naturalAspect(layer: DiaryLayer): number {
  if (layer.type === 'text') return 0;
  const nw = layer.nw || 1;
  const nh = layer.nh || 1;
  return nw / nh;
}

/**
 * 显示用的纵横比。
 * 有裁切时是**裁切后**的比例 —— 外框必须跟着裁切变，否则裁完图会被拉变形。
 */
export function displayAspect(layer: DiaryLayer): number {
  /* 四格相框是 2×2 的方阵 → 整框强制正方形（与圆形裁切同一待遇）。
     否则刚套上框时高度还跟着主图纵横比走，四格会被拉成长条。 */
  if (layer.type !== 'text' && layer.frame === 'quad') return 1;
  const nat = naturalAspect(layer);
  if (layer.type !== 'image' || !layer.crop) return nat;
  const c = layer.crop;
  return (nat * c.w) / c.h;
}

/** 裁切后图片在框内的放大/偏移（overflow:hidden 的老技巧） */
export function cropInnerStyle(crop: DiaryImageCrop | undefined): CSSProperties {
  if (!crop) return { width: '100%', height: '100%', left: 0, top: 0 };
  return {
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
  };
}

/** 文字图层的字号：px @ REF_W × 当前纸面缩放（--dp-scale 由渲染方注入） */
export function textFontSize(size: number): string {
  return `calc(${size}px * var(--dp-scale, 1))`;
}

/** 文字图层的行高（手写体重叠一点更好看，统一给 1.45） */
export const TEXT_LINE_HEIGHT = 1.45;

/**
 * 在"当前页所有图层"里找一个不与新图层严重重叠的落点。
 * 用途：素材面板连点同一张贴纸时不要叠成一张 —— 每次往右下错开一点。
 */
export function staggerSpot(existing: DiaryLayer[]): { cx: number; cy: number } {
  let cx = 0.5;
  let cy = 0.42;
  const hits = (x: number, y: number) =>
    existing.some((l) => Math.abs(l.cx - x) < 0.07 && Math.abs(l.cy - y) < 0.07);
  let guard = 0;
  while (hits(cx, cy) && guard++ < 40) {
    cx += 0.055;
    cy += 0.045;
    if (cx > 0.86) {
      cx = 0.16;
      cy += 0.06;
    }
    if (cy > 0.86) cy = 0.2;
  }
  return { cx, cy };
}

/* ============================ 结构元素（页面自带的东西） ============================ */

/**
 * 结构元素的变换覆盖 → 内联样式。
 *
 * ⚠️ 用 `translate` / `rotate` / `scale` 三个**独立属性**，绝不用 `transform`：
 *    元素自己的 CSS 里往往已经有 `transform`（拍立得 -3.5°、封面英文 -2°、
 *    纸胶带 -3°…），写 `transform` 会把它整条顶掉，元素会"啪"地转正。
 *    独立属性按规范叠在 `transform` 之前生效 = 在原姿态之上再变换，正是我们要的。
 *
 * ⚠️ 位移写成 `calc(比例 × var(--dp-pw))`：纸面像素宽高只有翻页层（NotebookOverlay）
 *    知道，它把 `--dp-pw` / `--dp-ph` 挂在 `.diary-flip` 上；元素自己不该知道
 *    "纸有多宽"。这样换屏幕、换页时位移始终是纸面的同一个相对位置。
 *
 * 返回 `undefined` = 没动过 → **一个属性都不写**（避免平白造出层叠上下文）。
 */
export function elOverrideStyle(o?: ElOverride | null): CSSProperties | undefined {
  if (isIdentityEl(o)) return undefined;
  const s: CSSProperties = {};
  const ov = o as ElOverride;
  /* 自由改长宽（边手柄）—— 单位同位移：比例 × 纸面像素。
     ⚠️ width/height 是**布局**属性（不是 scale 那种纯绘制），纸面像素必须用宿主
        **布局**尺寸：NotebookOverlay 挂的 `--dp-pw/--dp-ph` 就是 `.diary-flip`
        的 clientWidth/clientHeight（见那边的注释）。 */
  if (ov.w !== undefined) s.width = `calc(${ov.w} * var(--dp-pw, 0px))`;
  if (ov.h !== undefined) s.height = `calc(${ov.h} * var(--dp-ph, 0px))`;
  if (Math.abs(ov.dx) > 1e-4 || Math.abs(ov.dy) > 1e-4) {
    s.translate = `calc(${ov.dx} * var(--dp-pw, 0px)) calc(${ov.dy} * var(--dp-ph, 0px))`;
  }
  if (Math.abs(ov.rot) > 1e-3) s.rotate = `${ov.rot}deg`;
  if (Math.abs(ov.sc - 1) > 1e-4) s.scale = String(ov.sc);
  /* z-index 只对"定位元素"生效。元素原本多为 static，所以 PageEl 会量一次计算样式、
     static 的补 `data-dp-rel="1"`，CSS 里给它 `position: relative`（不改布局）。
     ⚠️ **下限 1，不能是负数**（用户 2026-09-23：「置于底层是要放在页面纸张上面，
        现在是在纸张下面」）。原因在层叠顺序上：
        `.diary-band` 每帧被 JS 写 transform → 它自己是一个**层叠上下文**；
        在这个上下文里负 z-index 的子孙排在**第 2 步**绘制，而纸张 `.diary-paper`
        是 `z-index: 0` 的定位元素、排在**第 6 步** —— 于是负 z 的文字块会被纸盖住，
        点不动也看不见。下限 1 保证它永远在纸之上（纸 = 0）。 */
  if (ov.z !== undefined) s.zIndex = Math.max(Z_FLOOR, ov.z);
  /* 对齐**必须打在元素上**，不能只打在文字槽上。
     用户 2026-09-23：「把文字块做成ppt那种框，可以调整对齐」。
     `text-align` 是"块级容器的行内内容怎么摆"，对 `display:inline` 的文字槽
     （思维导图的 `mm.*` 全是 `<span>`）完全没有作用；写在元素上则会被内部
     所有块级子孙继承（`.dx-mm-leaf` 那些 `li`、`.dx-text` 那些 `p`），
     于是"选中一个文字框点居中"整块文字都居中 —— 正是用户要的效果。
     ⚠️ 槽级（`ElOverride.texts[slot]`）也保留 align 字段，但它只在槽本身是块级时
        才生效（少数页型是 `<p>`），不影响这里。 */
  if (ov.text?.align) s.textAlign = ov.text.align;
  return Object.keys(s).length ? s : undefined;
}

/**
 * 结构元素里文字的样式覆盖 → 内联样式（**打在文字槽上**，不是打在元素上）。
 *
 * ⚠️ 必须打到 `[data-dp-slot]` 那个节点，不能打在外层元素：
 *    外层把 font-family 传下去，但槽位自己（或它的类）声明了 font-family 就会赢，
 *    "改了没反应"的经典陷阱。所以由 PageEl 的 ElScope 把宿主 id 传下去、
 *    EditableText 自己去查这份覆盖、直接写在自己身上。
 *
 * ⚠️ 字号是**屏幕 px**（见 types.ts 的 ElTextStyle 注释），所以这里写死数字，
 *    不乘 `--dp-scale` —— 用户看到的数字和他改的数字必须是同一个。
 */
export function elTextStyle(t?: ElTextStyle | null): CSSProperties | undefined {
  if (isEmptyElText(t)) return undefined;
  const s: CSSProperties = {};
  if (t!.font) s.fontFamily = familyOf(t!.font);
  if (t!.size !== undefined) s.fontSize = `${t!.size}px`;
  if (t!.color) s.color = t!.color;
  /* 对齐会被内部所有块级子孙继承 —— 对"选中一个文字框改对齐"来说正是想要的。
     ⚠️ 对 `display:inline` 的槽本身没作用，所以对齐只走元素级，不走槽级。 */
  if (t!.align) s.textAlign = t!.align;
  return Object.keys(s).length ? s : undefined;
}

/**
 * 文字槽的**完整**覆盖样式 = 元素级（`ElOverride.text`）→ 槽级（`ElOverride.texts[slot]`）。
 *
 * 用户 2026-09-23：「选中的文字变色不了，变的是没选中的文字」。
 * 分两层是因为作用域不同：选中元素改的是整块，在某个槽里改字态改的是那一行 ——
 * 后者必须能盖住前者，同时又不能把前者清掉（否则其余行会莫名退回默认色）。
 */
export function slotTextStyle(ov?: ElOverride | null, slot?: string): CSSProperties | undefined {
  const a = elTextStyle(ov?.text);
  const b = slot ? elTextStyle(ov?.texts?.[slot]) : undefined;
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b };
}

/** 把 `rgb(r, g, b)` / `rgba(...)` 归一成 `#rrggbb`（取色器只认 hex）。非 rgb 写法原样返回。 */
export function toHex(color: string): string {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color.trim());
  if (!m) return color.trim();
  const h = (v: string) =>
    Math.max(0, Math.min(255, Math.round(Number(v))))
      .toString(16)
      .padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

/**
 * 比例空间里的"像素空间"换算工具。
 *
 * ⚠️ 为什么不能直接在比例空间做旋转：x 是按纸**宽**归一化的、y 是按纸**高**归一化的，
 *    两者量纲不同（纸不是正方形）。直接在比例空间转 90°会把圆转成椭圆 ——
 *    对象的轨迹会是一条歪掉的斜线。所以先换算到"以纸宽为单位"的等比空间
 *    （X = x，Y = y / ar，ar = 纸宽/纸高），在这里做旋转/缩放，再换回去。
 */
export function toMetric(x: number, y: number, ar: number): { X: number; Y: number } {
  return { X: x, Y: y / (ar || 1) };
}
export function fromMetric(X: number, Y: number, ar: number): { x: number; y: number } {
  return { x: X, y: Y * (ar || 1) };
}

/** 绕比例空间的某点旋转 deg 度（内部走等比空间）。返回新位置（比例）。 */
export function rotateAbout(
  x: number,
  y: number,
  cx: number,
  cy: number,
  deg: number,
  ar: number,
): { x: number; y: number } {
  const p = toMetric(x - cx, y - cy, ar);
  const a = (deg * Math.PI) / 180;
  const X = p.X * Math.cos(a) - p.Y * Math.sin(a);
  const Y = p.X * Math.sin(a) + p.Y * Math.cos(a);
  const q = fromMetric(X, Y, ar);
  return { x: cx + q.x, y: cy + q.y };
}

/** 以比例空间的某点为中心缩放 k 倍（内部走等比空间，保证不歪） */
export function scaleAbout(
  x: number,
  y: number,
  cx: number,
  cy: number,
  k: number,
  ar: number,
): { x: number; y: number } {
  const p = toMetric(x - cx, y - cy, ar);
  const q = fromMetric(p.X * k, p.Y * k, ar);
  return { x: cx + q.x, y: cy + q.y };
}

/** 一组盒子的并集外框（组包围盒 / 多选包围盒） */
export function unionBox(boxes: ProBox[]): ProBox | null {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.cx - b.w / 2);
    y0 = Math.min(y0, b.cy - b.h / 2);
    x1 = Math.max(x1, b.cx + b.w / 2);
    y1 = Math.max(y1, b.cy + b.h / 2);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** 两个比例盒子是否相交（框选命中用） */
export function boxHit(a: ProBox, b: ProBox): boolean {
  return (
    Math.abs(a.cx - b.cx) * 2 < a.w + b.w && Math.abs(a.cy - b.cy) * 2 < a.h + b.h
  );
}

