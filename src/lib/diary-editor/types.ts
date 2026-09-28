/**
 * 实习日记「手账编辑器」—— 数据模型
 * =============================================================================
 * 目标（用户 2026-09-23 原话）：
 *   「把实习日记做成在作者模式下是可编辑的手账本，且可以保存，保存后网站直接
 *     更新成保存后的样子，刷新后网站是我编辑后的样子，不需要自己修改代码。」
 *
 * 三层数据，全部**可序列化**（要进 IndexedDB）：
 *
 *   1. **结构化文字覆盖** `PageEdit.text`
 *      `key → 文本`。页面本来就是由 data/diary.ts 渲染出来的，我们不把它变成
 *      "自由画布"，而是给每个文字节点一个**稳定的路径 key**（如 `c0-head:title`），
 *      编辑后把覆盖值存下来，渲染时优先用覆盖值。
 *      → 好处：原有版式（两栏、思维导图、月份圈选…）原样保留，改动只是"字变了"。
 *
 *   2. **图层** `PageEdit.layers`
 *      用户在页面上自己贴的东西：图片 / 视频 / 文字贴纸。自由定位、旋转、缩放。
 *
 *   3. **纸张** `PageEdit.paper`
 *      每页独立的纸材质 + 纸色。
 *
 * ## 坐标单位（重要）
 * 全部用**比例**，不用像素 —— 因为本子尺寸随视口变（页面宽度是 vw 相关的）。
 *   · cx / cy：图层**中心点**，占纸面宽 / 高的比例（0..1）；
 *   · w：图层**宽度**占纸面宽度的比例（高度由素材原始纵横比推导，故整体等比缩放）；
 *   · size：字号，按 `REF_W` 这个"设计基准宽度"下的 px 记 —— 渲染时乘
 *     `纸面实际宽 / REF_W`，所以换屏幕字号跟着纸等比缩放，版式永远不会散。
 *   · rot：旋转角（度）。
 *
 * ⚠️ 比例坐标的代价：纸面纵横比变了（极端窄屏）贴纸会跟着变形。本子是固定纵横比
 *    的纸（见 CSS 的 .diary-book），所以这里可接受。
 */

/** 设计基准宽度：所有 px 类量（字号）都相对它。取 900 ≈ 1920 视口下纸面的实际宽。 */
export const REF_W = 900;

/** 新建文字贴纸的默认字号（px @ REF_W）—— 「默认现在的正文大小」＝ .dx-text 的 15px 档，取最接近的 16。 */
export const DEFAULT_TEXT_SIZE = 16;

/* ============================ 纸张 ============================ */

/** 纸材质：空白纸 / 方格纸 / 纹理纸（牛皮纸） */
export type PaperKind = 'blank' | 'grid' | 'kraft';

/**
 * 一页的纸张设置。
 * `color` 缺省 = 该材质的默认色（见 CSS 的 .dp-paper.is-blank 等）；
 * 用户改过色就把具体 CSS 颜色记下来。
 */
export type PaperStyle = {
  kind: PaperKind;
  /** 自定义纸色（CSS 颜色字面量），缺省 = 材质默认 */
  color?: string;
};

export const DEFAULT_PAPER: PaperStyle = { kind: 'kraft' };

/* ============================ 图层 ============================ */

/**
 * 图片框外观（十种，用户点名）：
 *   none 无边框 / polaroid 拍立得 / tape 纸胶带 / card 手帐卡纸 / circle 圆形裁切
 *   retro 复古黄边 / dashed 虚线边框 / double 双线相框 / float 立体悬浮
 *   quad 蓝色四格相框（2026-09-23 加：用户「图片框里没有蓝色的放四个图片的」——
 *        素材库那张"四格相框"是一张画着相框的贴纸插画，照片放不进去；
 *        这是**真四格**：2×2 四个窗口，双击任意一格换那一格的图）
 * ⚠️ 与 `LayerImage.frame` 一一对应，CSS 在 `.dp-frame.is-*`。
 */
export type FrameStyle =
  | 'none'
  | 'polaroid'
  | 'tape'
  | 'card'
  | 'circle'
  | 'retro'
  | 'dashed'
  | 'double'
  | 'float'
  | 'quad';

export const FRAME_STYLES: { id: FrameStyle; label: string }[] = [
  { id: 'none', label: '无边框' },
  { id: 'polaroid', label: '拍立得' },
  { id: 'tape', label: '纸胶带' },
  { id: 'card', label: '手帐卡纸' },
  { id: 'circle', label: '圆形裁切' },
  { id: 'retro', label: '复古黄边' },
  { id: 'dashed', label: '虚线边框' },
  { id: 'double', label: '双线相框' },
  { id: 'float', label: '立体悬浮' },
  { id: 'quad', label: '四格相框' },
];

/**
 * 文字框外观（八种，用户点名）—— **只服务于工具栏添加的文字贴纸**，
 * 不作用于页面原本的结构化文字（那是版式的一部分，加了框就毁了）。
 *   none 无框(透明) / soft 浅白悬浮底 / thin 细黑框 / dashed 虚线黑框
 *   dark 黑底白字 / round 圆角米白卡 / sticky 便签黄纸 / outline 描边卡片
 */
export type TextBoxStyle =
  | 'none'
  | 'soft'
  | 'thin'
  | 'dashed'
  | 'dark'
  | 'round'
  | 'sticky'
  | 'outline';

export const TEXT_BOX_STYLES: { id: TextBoxStyle; label: string }[] = [
  { id: 'none', label: '无框' },
  { id: 'soft', label: '浅白悬浮底' },
  { id: 'thin', label: '细黑框' },
  { id: 'dashed', label: '虚线黑框' },
  { id: 'dark', label: '黑底白字' },
  { id: 'round', label: '圆角米白卡' },
  { id: 'sticky', label: '便签黄纸' },
  { id: 'outline', label: '描边卡片' },
];

/** 字号档（用户点名的 10 档） */
export const TEXT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48] as const;

/** 图层公共字段 */
type LayerBase = {
  id: string;
  /** 中心点 x（占纸面宽的比例） */
  cx: number;
  /** 中心点 y（占纸面高的比例） */
  cy: number;
  /** 宽度（占纸面宽的比例） */
  w: number;
  /**
   * 高度（占纸面高的比例）。**只有用户自由拉过框才有值**。
   *
   * 用户 2026-09-23：「相框可以自由调整长宽」—— 拖四条边手柄时宽度和高度分别变，
   * 这时高度不能再由图片纵横比推出来（推出来的永远是"原始比例"）。
   * 缺省 = 跟着图片纵横比走（老数据、以及从没拉过边的贴纸都是这样），
   * 于是"没拉过 = 显示和以前逐像素一致"，不会因为加了这个字段而改变任何既有版式。
   */
  h?: number;
  /** 旋转角（度，顺时针） */
  rot: number;
  /** 叠放层级：新建时取当前页 max+1 */
  z: number;
  /**
   * 沉到**页面内容下面**（但仍在纸张之上）。
   *
   * 用户 2026-09-23：「贴纸点击置于底层没反应，但关闭编辑后可以看见」。
   * 查出来两件事：① 同域只有一个图层时重排函数整体早退，按下去什么都不做；
   * ② 只靠 `z` 永远沉不到正文下面 —— 图层所在的宿主（阅读态 `.dp-layerhost` z=2、
   * 编辑态 `.dp-canvas` z=60）整体就压在页面内容之上。
   * 所以「置于底层」按到底要多一个档位：本字段为真时，图层改画在
   * `.dp-layerhost.is-under`（z=0）里 —— 位于纸张之上、页面文字/相框之下。
   */
  under?: boolean;
};

/** 裁切矩形（0..1 比例，相对素材原图） */
export type DiaryImageCrop = { x: number; y: number; w: number; h: number };

/**
 * 图片图层。
 * `src` 直接可用的展示地址：
 *   · 内建素材 → public/ 下的路径（`/journal/editor/xxx.png`）；
 *   · 用户上传 → 从 IndexedDB 媒体记录换出的 blob: 地址（见 storage.hydrate）。
 * `mediaId` 有值 = 这张图是上传的，刷新后要重新从库里换地址。
 */
export type LayerImage = LayerBase & {
  type: 'image';
  src: string;
  mediaId?: string;
  /** 素材原始像素宽 / 高 —— 用来算图层显示高度，也用于裁切 */
  nw: number;
  nh: number;
  frame: FrameStyle;
  /** 裁切（0..1 比例，相对原图）；缺省 = 整图 */
  crop?: DiaryImageCrop;
  /** 说明文字：拍立得底部那行手写小字 */
  caption?: string;
  /**
   * 四格相框（frame==='quad'）里**每一格的独立图源**（左上/右上/左下/右下）。
   *
   * 用户 2026-09-23：「图片框里没有蓝色的放四个图片的」——素材库那张"四格相框"
   * 是画着相框的贴纸插画，照片放不进去。这是真四格：某一格没换过（槽位为空）
   * 就显示主图 `src`；双击相框的某个格子换那一格的图（写这里）。
   * `mediaId` 与 src 一一对应：上传图刷新后要靠它从媒体库换回 blob 地址。
   */
  quadCells?: ({ src: string; mediaId?: string } | null)[] | null;
};

/** 视频图层。`poster` = 抽帧封面（翻页 12 条带里只渲染它，真正播放在单页覆盖层）。 */
export type LayerVideo = LayerBase & {
  type: 'video';
  src: string;
  mediaId?: string;
  nw: number;
  nh: number;
  frame: FrameStyle;
  poster?: string;
  caption?: string;
};

/** 文字图层（工具栏「添加文字」产生的那类可编辑贴纸） */
export type LayerText = LayerBase & {
  type: 'text';
  text: string;
  /** 字体 id，见 fonts.ts 的 EDITOR_FONTS */
  font: string;
  /** 字号 px @ REF_W */
  size: number;
  color: string;
  box: TextBoxStyle;
  bold?: boolean;
  italic?: boolean;
  /** 对齐（用户 2026-09-23：「可以调整对齐」）—— 只对文字贴纸有意义 */
  align?: TextAlign;
};

export type DiaryLayer = LayerImage | LayerVideo | LayerText;

/* ============================ 结构元素（页面自带的文本 / 边框 / 底图 / 装饰） ============================ */

/**
 * 结构元素的变换覆盖。
 *
 * 页面本体（大标题、正文块、手绘边框、拍立得照片、纸胶带、贴纸…）是**代码版式**
 * 渲染出来的，不是自由画布。用户 2026-09-23 要求「上面的所有东西都可以移动，
 * 文本、边框、底图等等」，但我们不能把这些节点从版式里摘出来重新绝对定位 ——
 * 那会把两栏、思维导图、月份圈选行的排版整个毁掉。
 *
 * 所以走**增量覆盖**：元素留在原版式位置，这里只记「相对原始位置挪了多少 /
 * 转了多少 / 缩了多少」。
 *   · 全零 = 完全没动过（`isIdentityEl` 判定），此时**连 `els` 这条都不落库**，
 *     不会产生"动了 0.0001px"的脏数据；
 *   · 渲染时用 CSS 的 `translate` / `rotate` / `scale` **三个独立属性**表达，
 *     而不是 `transform` —— 元素自己的 CSS 很可能已经有 `transform`
 *     （拍立得 -3.5°、封面英文 -2°、纸胶带 -3°…），写 `transform` 会整条顶掉。
 *     按规范独立属性叠在 `transform` **之前**生效，正好是"在原姿态之上再变换"。
 *
 * dx / dy 是**占纸面宽 / 高**的比例（与图层坐标同一套单位，见文件头说明）。
 */
export type ElOverride = {
  dx: number;
  dy: number;
  rot: number;
  sc: number;
  /**
   * 宽 / 高（**占纸面宽 / 高的比例**）。
   *
   * 用户 2026-09-23：「像这样可以调整底图的长宽」「图片相框也要自由调整长宽」。
   * `sc` 是角手柄的**等比**缩放（不改变元素自身的宽高比），`w`/`h` 是边手柄拉出来的
   * **非等比**尺寸 —— 两者是不同的东西，可以叠加（先改尺寸、再等比放大）。
   *
   * ⚠️ **只有用户拖过边手柄才有值**。缺省 = 不写 width/height，
   *    元素完全按自己的 CSS 排版（这是"没动过"的逐像素底线的保证）。
   * ⚠️ 注意与 CSS 的 `scale` 的区别：`scale` 只影响绘制，不影响布局，元素在文档流里
   *    占的位置不变；`width/height` 是**真的改布局**。拍立得相框要"框变图也变"，
   *    必须走这条（内层 img 用属性 + CSS 跟着撑满，见 index.css 的 data-dp-imgfit）。
   */
  w?: number;
  h?: number;
  /** 显式层级（同页结构元素之间比大小；没设过 = 不写 z-index）。Ctrl+] / Ctrl+[ 改它。 */
  z?: number;
  /** 文字样式覆盖（见 ElTextStyle）—— 只对"里面有可编辑文字槽"的元素有意义。
   *  **作用于整个元素**（用户只是选中了它、没进改字态时走这条）。 */
  text?: ElTextStyle;
  /**
   * **槽级**文字样式覆盖：`[data-dp-slot]` 名 → 样式。
   *
   * 用户 2026-09-23：「选中的文字变色不了，变的是没选中的文字」。录屏抽帧 + 探针实测：
   * 双击某行正文进改字态、选几个字、点「文字颜色」→ 覆盖被写到 `els.core.text`，
   * 而 `core` 是**整块思维导图**（22 个文字槽）→ 整块变绿。根因是"元素级"作用域太宽。
   *
   * 现在改字态的样式分三层落点（由窄到宽，后写的更精确）：
   *   1. **行内富文本** —— 真的选了一段字符 → 给那几个字套 `<span style>`（见 RichText）；
   *   2. **槽级**（本字段）—— 光标在某个槽里但没选内容 → 只改那一个槽；
   *   3. **元素级**（`text`）—— 只是选中了元素 → 改整个元素（原有行为）。
   * ⚠️ 槽级与元素级**分开存**：不然"先给整块改红、再给某一行改蓝"会把红色冲掉，
   *    其余行莫名其妙退回默认色。
   */
  texts?: Record<string, ElTextStyle>;
  /**
   * 图片框样式，作用在**页面自带的结构元素**上。
   *
   * 用户 2026-09-23：「放边框没反应」。根因：`patchStyle` 的 `kinds` 把 `frame` 限死在
   * `image|video` 图层、`box` 限死在 `text` 图层；选中页面自带的照片 / 手绘边框 /
   * 正文块时**一个落点都没有** → 静默掉进 `setDefaults()`（改的是"新建默认值"，
   * 眼前什么都不变）→ 用户看到的就是"点了没反应"。
   *
   * 现在结构元素也吃这两项。渲染成**属性**而不是 inline style：
   * 拍立得 / 纸胶带这些用了 `::before` 与后代选择器（`> img`），inline style 表达不了。
   * 见 index.css 的 `[data-dp-frame=…]`。
   */
  frame?: FrameStyle;
  /**
   * 文字框样式，作用在**页面自带的结构元素**上（把版式文字块变成"PPT 那种框"）。
   *
   * ⚠️ 字段名是 `tbox` 而不是 `box`：元素上已经有一个 `data-dp-box`
   * （拖过边手柄后解除版式 `max-width` 的标记，见 PageEl），
   * 两者语义完全不同 —— 混用一个名字迟早出事。属性名同理用 `data-dp-tbox`。
   */
  tbox?: TextBoxStyle;
};

/**
 * 结构元素里被**替换过**的图片。
 *
 * 用户 2026-09-23：「双击相框里的图片可以替换图片」。
 * 页面自带的照片（拍立得里的 `<img>`、贴纸 `<img>`）也是代码版式的一部分 ——
 * 它们的 `src` 写在 JSX 里，不能改代码。所以在这里记一条"这个元素换过图了"：
 *   · `mediaId` 是**持久**的素材键（Blob 存在 media 表，见 storage.ts）；
 *   · `src` 是每次载入现场换出来的 `blob:` 地址（与页面会话绑定，不跨刷新）。
 * 渲染时由 PageEl 把它写到"元素自身是 img / 元素里第一个 img"的 src 上。
 */
export type ElImage = {
  mediaId: string;
  src: string;
  /** 新图的原始像素尺寸（算"按比例铺满"用） */
  nw: number;
  nh: number;
};

/**
 * 结构元素里**文字**的样式覆盖。
 *
 * 用户 2026-09-23 追加：「选中文字或素材边框样式，文字的字体字号颜色样式也会在下方
 * 这里显示出来」。要"显示"，就得先有"被改过的值"这个概念 —— 所以结构文字也能改字体/
 * 字号/颜色，改完全站（含阅读态）就是这个样子。
 *
 * ⚠️ `size` 是**屏幕 px**，不是图层那套"REF_W 基准 + --dp-scale"的虚拟 px。
 *    因为结构元素的字号是 CSS 厘米级给定的（`font-size: 22px` 这种），
 *    要从 DOM 量出来只能是 computed 值。工具栏显示与写回都用同一套单位，
 *    用户看到的数字和他改的数字才是同一个 —— 不然"显示 22 改完变 13"。
 */
export type ElTextStyle = {
  /** 字体 id（见 fonts.ts 的 EDITOR_FONTS） */
  font?: string;
  /** 字号 px（屏幕单位） */
  size?: number;
  /** 文字颜色 */
  color?: string;
  /**
   * 对齐方式。
   *
   * 用户 2026-09-23：「把文字块做成ppt那种框，可以调整对齐」。
   * ⚠️ 这条**只能落在块级元素上**：`text-align` 对 `display:inline` 的元素没作用，
   *    而很多文字槽（思维导图的 `mm.*`）是 `<span>`。所以对齐不走"槽级"，
   *    一律写在**元素级**（`ElOverride.text.align`）—— 它会被内部所有块级子孙继承，
   *    也正好对应"选中一个文字框改对齐"的 PPT 心智。
   */
  align?: TextAlign;
};

/** 文字对齐（两端对齐用 `justify`） */
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export const TEXT_ALIGNS: { id: TextAlign; label: string; glyph: string }[] = [
  { id: 'left', label: '左对齐', glyph: '⇤' },
  { id: 'center', label: '居中', glyph: '↔' },
  { id: 'right', label: '右对齐', glyph: '⇥' },
  { id: 'justify', label: '两端对齐', glyph: '≡' },
];

/**
 * 富文本槽内容 —— 用户给**局部文字**改过样式之后，这个槽就不能再当纯文本存了。
 *
 * 用户 2026-09-23：「选中的文字变色不了，变的是没选中的文字」。他选中了 4 个字，
 * 期望只改那 4 个；纯文本 + 属性模型做不到，所以槽内容升级为"可选的 HTML"。
 *
 * ⚠️ 只在**真的产生标记**时才用这个形状（`<span style>` / `<b>` 之类）：
 *    平时仍然是 `string`（纯文本），老数据、老逻辑一个字节都不变。
 * ⚠️ `html` 必须过白名单清洗（见 storage.ts 的 sanitizeRichHtml）——
 *    内容会走 `dangerouslySetInnerHTML`，用户粘进来的 `<img onerror>` 不能放行。
 */
export type RichText = { html: string };

/** 槽内容是富文本吗 */
export function isRich(v: string | RichText | undefined | null): v is RichText {
  return !!v && typeof v !== 'string' && typeof (v as RichText).html === 'string';
}

/** 取出槽内容的纯文本形式（富文本就剥标签；给朗读 / 导出 / 比较用） */
export function plainOf(v: string | RichText | undefined | null, fallback = ''): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'string') return v;
  return v.html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
}

export const IDENTITY_EL: ElOverride = { dx: 0, dy: 0, rot: 0, sc: 1 };

/** 文字覆盖是空的吗（工具栏"清掉覆盖"时判定用） */
export function isEmptyElText(t?: ElTextStyle | null): boolean {
  return (
    !t ||
    (t.font === undefined && t.size === undefined && t.color === undefined && t.align === undefined)
  );
}

/** 是否是"没动过"的状态 —— 决定要不要落库 / 要不要写内联样式 */
export function isIdentityEl(o?: ElOverride | null): boolean {
  if (!o) return true;
  if (!isEmptyElText(o.text)) return false;
  if (o.texts && Object.values(o.texts).some((t) => !isEmptyElText(t))) return false;
  /* 框样式只要设过（哪怕设成 'none'）就算"动过" —— 'none' 是用户明确选的
     "把框去掉"，和"从没设过"在语义上不同：后者要跟随页面原本的版式。 */
  if (o.frame !== undefined) return false;
  if (o.tbox !== undefined) return false;
  return (
    Math.abs(o.dx) < 1e-4 &&
    Math.abs(o.dy) < 1e-4 &&
    Math.abs(o.rot) < 1e-3 &&
    Math.abs(o.sc - 1) < 1e-4 &&
    o.w === undefined &&
    o.h === undefined &&
    o.z === undefined
  );
}

/* ============================ 选中与分组 ============================ */

/**
 * 选中对象的引用。
 * 页面上有两类可选对象，各自住在自己的命名空间里：
 *   · `layer` —— 用户自己贴的（图片 / 视频 / 文字贴纸），存在 `PageEdit.layers`；
 *   · `el`    —— 页面自带的结构元素（标题 / 正文块 / 边框 / 照片…），id 由代码给出
 *              （登记表见 components/diary-editor/PageEl.tsx 的注释）。
 * 选中框、手柄、成组、层级都只认 `SelRef`，于是两类对象能被同一套交互模型统一处理 ——
 * 这正是「所有东西都能移动 / 能整组移动」的前提。
 */
export type SelRef = { kind: 'layer' | 'el'; id: string };

/** 序列化成组内成员引用（存进 IndexedDB 的字符串形式）：`l:xxx` / `e:xxx` */
export function memberRef(r: SelRef): string {
  return `${r.kind === 'layer' ? 'l' : 'e'}:${r.id}`;
}

export function parseMemberRef(s: string): SelRef {
  return { kind: s.startsWith('l:') ? 'layer' : 'el', id: s.slice(2) };
}

export function sameRef(a: SelRef | null | undefined, b: SelRef | null | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

/** 组：把选中的多个对象绑在一起，之后点其中任意一个就整组一起动（Ctrl+G / Ctrl+Shift+G） */
export type DiaryGroup = {
  id: string;
  name: string;
  /** 成员引用，`memberRef` 的形式 */
  members: string[];
};

/** 比例空间的盒子：中心 + 尺寸，全部占纸面比例（框选命中 / 组包围盒 / 对齐都用它） */
export type ProBox = { cx: number; cy: number; w: number; h: number };

/* ============================ 页 ============================ */

/** 单页的用户编辑内容 */
export type PageEdit = {
  paper?: PaperStyle;
  layers: DiaryLayer[];
  /** 结构化文字覆盖：稳定路径 key → 文本（局部改过样式的槽是 RichText，见那里的说明） */
  text?: Record<string, string | RichText>;
  /** 结构元素的变换覆盖：元素 id → 变换（见 ElOverride） */
  els?: Record<string, ElOverride>;
  /** 结构元素里被替换过的图片：元素 id → 新素材（见 ElImage） */
  imgs?: Record<string, ElImage>;
  /** 用户建的组 */
  groups?: DiaryGroup[];
};

export const EMPTY_PAGE: PageEdit = { layers: [] };

/** 整本的文档（进 IndexedDB 的主体，不含 Blob） */
export type DiaryDoc = {
  /** 版本号，便于以后迁移 */
  v: 1;
  /** 页序（sheet id 列表）。缺省 = 代码里 DIARY_SHEETS 摊出来的顺序 */
  order: string[];
  /** 用户「加页」新建的空白页 id（不在代码的 sheet 表里，渲染成空白纸） */
  extraPages: string[];
  pages: Record<string, PageEdit>;
};

export function emptyDoc(): DiaryDoc {
  return { v: 1, order: [], extraPages: [], pages: {} };
}

/* ============================ 默认值（新建图层用） ============================ */

export const DEFAULT_TEXT_COLOR = '#3a2e23';

/** 新建图层时用的默认样式 —— 工具栏没选中贴纸时的「默认框」也读这里 */
export type LayerDefaults = {
  frame: FrameStyle;
  font: string;
  size: number;
  color: string;
  box: TextBoxStyle;
  /** 新建文字的对齐（工具栏没选中任何对象时改的就是它） */
  align: TextAlign;
};

export const DEFAULT_LAYER_DEFAULTS: LayerDefaults = {
  frame: 'polaroid',
  /** 'default' = 跟随本页正文（fonts.ts 里排第一的那个） */
  font: 'default',
  size: DEFAULT_TEXT_SIZE,
  color: DEFAULT_TEXT_COLOR,
  box: 'none',
  align: 'left',
};

/** 裁切比例的合法化：始终保证是原图内的有效矩形 */
export function clampCrop(c?: { x: number; y: number; w: number; h: number }) {
  if (!c) return undefined;
  const w = Math.min(1, Math.max(0.05, c.w));
  const h = Math.min(1, Math.max(0.05, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  return { x, y, w, h };
}

/* ============================ 变换的上下限 ============================ */

/**
 * 拖动/缩放时的夹取范围 —— 集中在这里，避免"这块用 0.045、那块用 0.05"的漂移。
 * 图层宽度：低于 4.5% 就小到看不见了；高于 160% 会横贯整页。
 * 结构元素缩放：20% ~ 400%（再小看不清、再大爆版）。
 * 字号：8px ~ 220px（成组缩放文字图层时按比例乘，要夹住）。
 */
export const MIN_LAYER_W = 0.045;
export const MAX_LAYER_W = 1.6;
export const MIN_EL_SC = 0.2;
export const MAX_EL_SC = 4;
/**
 * 结构元素「拖边自由改长宽」的范围（占纸面宽 / 高的比例）。
 * 下限比图层宽一点（3% ≈ 纸面上 26px，再小抓不住手柄）；上限 300% 允许把
 * 底图/相框拉到比纸还大（用户原话「自由调整长宽」）。
 */
export const MIN_EL_SIZE = 0.03;
export const MAX_EL_SIZE = 3;
export const MIN_TEXT_SIZE = 8;
export const MAX_TEXT_SIZE = 220;

/** 把中心点夹在纸面附近（允许 -2%~102%，方便把东西推到边缘外一点） */
export function clampCenter(v: number): number {
  return Math.min(1.02, Math.max(-0.02, v));
}

