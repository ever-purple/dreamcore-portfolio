/**
 * 手账编辑器 —— 状态中枢
 * =============================================================================
 * 一份 Provider 管住整本的编辑状态，**编辑态与阅读态共用**：
 *   · 编辑态：工具栏读写它；
 *   · 阅读态：DiaryPage / LayerView / PageEl 从它读"用户改过的内容"
 *     （文字覆盖 / 纸张 / 图层 / 结构元素位移），所以刷新之后看到的正是编辑后的样子。
 *
 * ## 几个关键设计
 * 1. **doc 用 ref 镜像**（`docRef`）—— `mutate` 在事件回调里被连续调用时，
 *    必须读到"上一次改完的结果"，用 `setState(prev => …)` 的 updater 拿不到同步值，
 *    而 updater 里推撤销栈又会被 StrictMode 双调用推两遍。故：先算 next、立刻写 ref、再 setState。
 * 2. **撤销/重做 = 整份快照**。doc 很小（纯 JSON，几张贴纸的坐标），整份存最省心。
 *    连续操作（拖动 / 连打）用 `coalesceKey` + 900ms 窗口合并成一步 —— 否则拖一次要按 60 次撤销。
 * 3. **复制粘贴走内部剪贴板**（用户可以多选后整体复制）。同时**支持系统粘贴**：
 *    剪贴板里是图片文件时直接落成图层（从 PS / 网页右键复制来的图能直接贴进手账）。
 * 4. 字体 / 图片加载都可能有异步，`mutate` 之后要 `setDoc` 触发重渲染，不能只改 ref。
 *
 * ## 2026-09-23 第二轮追加（用户三条原话）
 *   「上面的所有东西都可以移动，文本、边框、底图等等」
 *   「可以建组，整组移动」
 *   「所有的功能与 PowerPoint 的功能一样，快捷键也是」
 * 于是引入两样东西：
 *
 *   (a) **统一选中模型** `SelRef = { kind: 'layer' | 'el'; id }`
 *       图层和"页面自带的结构元素"（标题/正文块/边框/照片…）用同一套选中、手柄、
 *       变换、对齐、层级逻辑。结构元素的位置改动存在 `PageEdit.els`（增量覆盖），
 *       见 types.ts 的 ElOverride。
 *
 *   (b) **组** `PageEdit.groups`
 *       选中两个以上对象 Ctrl+G 成组；之后点组里任意一个，`expandRefs` 会把整组
 *       展开成"实际要动的对象集合"，位移/缩放/旋转都作用于整组。
 *       缩放与旋转绕**组包围盒中心**，且换算走"等比空间"（layout.ts 的
 *       rotateAbout / scaleAbout）—— 否则纸不是正方形，转 90° 会把轨迹拉歪。
 *
 * ## 与画布的桥（CanvasBridge）
 * 「量元素在纸上的真实位置」「让某个对象进入文字编辑态」「把结构元素抓成文字图层快照」
 * 这三件事只有 DOM 侧（DiaryCanvas）做得到，所以由画布挂载时注册进来，
 * 状态中枢通过 `bridge` 这个 ref 调用。避免了把状态中枢和 DOM 互相 import。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type {
  DiaryGroup,
  DiaryLayer,
  DiaryDoc,
  ElImage,
  ElOverride,
  ElTextStyle,
  LayerDefaults,
  PageEdit,
  PaperStyle,
  ProBox,
  RichText,
  SelRef,
} from './types';
import {
  DEFAULT_LAYER_DEFAULTS,
  EMPTY_PAGE,
  IDENTITY_EL,
  MAX_EL_SC,
  MAX_LAYER_W,
  MAX_TEXT_SIZE,
  MIN_EL_SC,
  MIN_LAYER_W,
  MIN_TEXT_SIZE,
  clampCrop,
  clampCenter,
  isEmptyElText,
  isIdentityEl,
  memberRef,
  parseMemberRef,
  sameRef,
} from './types';
import {
  createSaver,
  deleteMedia,
  forgetMediaUrl,
  imageSize,
  hydrateDoc,
  loadDoc,
  putMedia,
  sanitizeRichHtml,
  videoProbe,
  type SaveState,
} from './storage';
import { newExtraId, resolveOrder, userOrder, removedPages, isProtectedPage } from './pageId';
import { Z_FLOOR, rotateAbout, scaleAbout, staggerSpot } from './layout';

const DEFAULTS_KEY = 'dreamcore:diary-editor-defaults';

function readDefaults(): LayerDefaults {
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY);
    if (raw) return { ...DEFAULT_LAYER_DEFAULTS, ...(JSON.parse(raw) as Partial<LayerDefaults>) };
  } catch {
    /* 隐私模式忽略 */
  }
  return { ...DEFAULT_LAYER_DEFAULTS };
}

function writeDefaults(d: LayerDefaults) {
  try {
    window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d));
  } catch {
    /* 忽略 */
  }
}

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * ⚠️ 稳定空值：`x ?? []` / `x ?? {}` 这种写法**每次渲染都造一个新对象**，
 * 一旦它被当成 `useMemo`/`useEffect` 的依赖，就会每帧都判定"变了" ——
 * 编辑态的画布量尺寸 → setState → 重渲染 → 依赖又变 → 再量 …… 无限循环。
 * 所以这几个空值必须是模块级常量。
 */
const NO_LAYERS: DiaryLayer[] = [];
const NO_ELS: Record<string, ElOverride> = {};
const NO_GROUPS: DiaryGroup[] = [];

/** 角度归一化到 -180..180（旋转叠加时不归一化会越转越大，HUD 读数会变成 720°） */
const normDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/* ============================ 页作用域 ============================ */

/**
 * 「我正在渲染的是哪一页」。
 *
 * 为什么不能直接用 `api.pageId`：翻页时会同时存在**两页** DOM ——
 * 正在被翻走的那页（`.diary-turn` 的 12 条带）和底下垫着的目标页（`.diary-under`）。
 * `api.pageId` 只有一个值，底下那页会拿到"当前页"的文字覆盖与元素位移，
 * 翻页过程中能看到文字/贴纸"跳"一下。
 * 所以在 `renderSheet(idx)` 外面套一层 `<PageScope id={pageOrder[idx]}>`，
 * 页内组件（EditableText / PageEl）优先读作用域里的 id。
 */
const PageIdCtx = createContext<string | null>(null);

export function PageScope({ id, children }: { id: string; children: ReactNode }) {
  return <PageIdCtx.Provider value={id}>{children}</PageIdCtx.Provider>;
}

/** 取当前渲染的页 id；没套作用域时返回 null（调用方回退到 api.pageId） */
export function usePageId(): string | null {
  return useContext(PageIdCtx);
}

/* ============================ 画布桥 ============================ */

/** 画布 → 状态中枢 的能力（都需要 DOM，只有 DiaryCanvas 拿得到） */
/**
 * 结构元素里文字的**实测样式**。
 *
 * 用户 2026-09-23 追加：「选中文字或素材边框样式，文字的字体字号颜色样式也会在下方
 * 这里显示出来」。页面自带的标题/正文用的是 CSS 里的字体栈，状态中枢（Context）
 * 根本不知道它们长什么样 —— 只能由 DOM 侧（DiaryCanvas）量出来交给工具栏。
 */
export type ElStyleInfo = {
  /** 第一个文字槽的 computed font-family（原样返回，工具栏负责反查成字体 id） */
  fontFamily: string;
  /** 第一个文字槽的 computed 字号（**屏幕 px**，与 ElTextStyle.size 同一单位） */
  fontSize: number;
  /** 第一个文字槽的 computed 颜色（`rgb(r, g, b)`，工具栏负责转 hex） */
  color: string;
  /** 第一个文字槽的 computed 对齐（`start` 归一到 `left`）—— 工具栏对齐控件的回显 */
  textAlign: string;
  /** 这个元素里**有没有可编辑文字** —— 没有的话字体/字号/颜色三项就不该显示 */
  hasText: boolean;
  /** 可编辑文字槽的个数（>1 时字号只报第一个，界面注明"多个文字块"） */
  slots: number;
};

export type CanvasBridge = {
  /** 当前页结构元素的**原位盒**（比例空间，未叠加位移/旋转/缩放） */
  elBoxes: Record<string, ProBox>;
  /** 元素 id → 给界面看的名字（提示条 / HUD） */
  elLabels: Record<string, string>;
  /** 元素 id → 内部文字的实测样式（选中回显用，见 ElStyleInfo） */
  elStyles: Record<string, ElStyleInfo>;
  /**
   * 元素 id → 是不是"图片类"（自身是 `<img>` / 内含 `<img>` / 有 background-image）。
   *
   * ⚠️ 这个表只回答"**双击能不能换图**"（用户 2026-09-23：「双击相框里的图片可以
   *    替换图片」）。"能不能拖边改长宽"不要只看它 —— 2026-09-23 第四轮起
   *    **文字类元素也给边手柄**（「正文块也可以调整长宽」），由 DiaryCanvas 的
   *    `edgeEl` 综合 `elMedia || elStyles[id].hasText` 判断。
   */
  elMedia: Record<string, boolean>;
  /** 让某个对象进入文字编辑态（双击 / F2 / Enter）。没有可编辑文字返回 false。
   *  `at` 是双击的屏幕坐标 —— 一个元素里可能有好几个可点改的槽位（小标题 + 正文），
   *  给坐标就能聚焦到离指针最近的那个。 */
  focusText: (ref: SelRef, at?: { x: number; y: number }) => boolean;
  /** 把结构元素抓成"文字图层"快照（复制/再制结构文字时用；返回的图层还没进 doc） */
  snapshot: (pageId: string, refs: SelRef[]) => DiaryLayer[];
  /** 当前页所有可选对象（图层 + 结构元素）的盒子，按"从下到上"排好 */
  orderedBoxes: () => { ref: SelRef; box: ProBox }[];
};

export type DiaryEditorApi = {
  ready: boolean;
  /** 作者模式下是否处于「编辑中」 */
  editing: boolean;
  setEditing: (v: boolean) => void;
  /** 当前正在看的页 id（由页序 + 页号推导） */
  pageId: string;
  /** 当前页在页序里的下标 */
  pageIndex: number;
  setPageIndex: (i: number) => void;
  /** 实际页序（用户删过页就是用户那份） */
  pageOrder: string[];
  /** 页序长度 = 总页数 */
  total: number;

  order: string[];
  removed: string[];

  /* 文字覆盖 */
  getText: (key: string, fallback: string) => string | RichText;
  setText: (key: string, value: string | RichText) => void;

  /* 纸张 */
  paperOf: (pageId: string) => PaperStyle | undefined;
  setPaper: (pageId: string, paper: PaperStyle | undefined) => void;

  /* 图层 */
  layersOf: (pageId: string) => DiaryLayer[];
  addLayer: (pageId: string, layer: DiaryLayer) => void;
  updateLayer: (pageId: string, id: string, patch: Partial<DiaryLayer>, coalesceKey?: string) => void;
  removeLayer: (pageId: string, id: string) => void;
  /** 当前选中的图层（主选中，且必须是图层） */
  selected: DiaryLayer | null;
  /** 主选中的图层 id（兼容旧调用点：`sel` 只认图层） */
  sel: string | null;
  setSel: (id: string | null) => void;
  /** 主选中的结构元素 id */
  selEl: string | null;

  /* 结构元素 */
  elOf: (pageId: string, elId: string) => ElOverride | undefined;
  /** 当前页全部结构元素的覆盖（画布渲染选中框要整张表） */
  elsOf: (pageId: string) => Record<string, ElOverride>;
  updateEl: (pageId: string, elId: string, patch: Partial<ElOverride>, coalesceKey?: string) => void;
  /** 改结构元素里文字的样式（字体/字号/颜色）—— 覆盖会落到元素内**每一个**文字槽上 */
  updateElText: (pageId: string, elId: string, patch: Partial<ElTextStyle>, coalesceKey?: string) => void;
  /**
   * 改结构元素里**某一个槽**的文字样式（`data-dp-slot` 名）。
   * 与 `updateElText` 元素级分开存：槽级优先级更高，只影响那一个槽。
   */
  updateElSlotText: (
    pageId: string,
    elId: string,
    slot: string,
    patch: Partial<ElTextStyle>,
    coalesceKey?: string,
  ) => void;

  /* 选中（多选） */
  selection: SelRef[];
  setSelection: (refs: SelRef[]) => void;
  selectRef: (ref: SelRef, mode?: 'replace' | 'toggle') => void;
  isSelected: (ref: SelRef) => boolean;
  /** 把选中集合展开成"实际要动的对象"（组内成员整组跟随） */
  expandRefs: (pageId: string, refs: SelRef[]) => SelRef[];

  /* 组 */
  groupsOf: (pageId: string) => DiaryGroup[];
  groupOf: (pageId: string, ref: SelRef) => DiaryGroup | null;
  groupSelection: () => void;
  ungroupSelection: () => void;

  /* 变换（作用于一批引用；组会自动展开） */
  moveRefs: (pageId: string, refs: SelRef[], dx: number, dy: number, key?: string) => void;
  scaleRefs: (
    pageId: string,
    refs: SelRef[],
    k: number,
    center: { x: number; y: number },
    ar: number,
    key?: string,
  ) => void;
  rotateRefs: (
    pageId: string,
    refs: SelRef[],
    deg: number,
    center: { x: number; y: number },
    ar: number,
    key?: string,
  ) => void;

  /* 排列 */
  orderRefs: (pageId: string, refs: SelRef[], mode: 'up' | 'down' | 'front' | 'back') => void;
  alignRefs: (pageId: string, refs: SelRef[], mode: 'hcenter' | 'vcenter') => void;
  /** 选中对象在层序里的位置（第几层 / 是否顶底 / 是否已沉到页面内容下面） */
  zRankOf: (
    pageId: string,
    refs: SelRef[],
  ) => { position: number; total: number; isTop: boolean; isBottom: boolean; under: boolean } | null;

  /* 剪贴板 / 删除 / 全选 / 轮换 */
  copySelection: () => boolean;
  /** 剪切：复制 + 删除（Ctrl+X / 右键菜单） */
  cutSelection: () => boolean;
  duplicateSelection: () => boolean;
  pasteClipboard: (pageId: string) => boolean;
  deleteSelection: () => void;
  /** 把选中的结构元素放回原位（清掉位移/旋转/缩放，保留改过的字体字号颜色） */
  resetElTransform: () => boolean;
  selectAllOnPage: () => void;
  cycleSelection: (dir: 1 | -1) => void;
  /** 让主选中对象进入文字编辑态（F2 / Enter / 双击都由它兜底） */
  editSelectedText: () => void;

  /* 素材 → 图层 */
  addSticker: (pageId: string, asset: { id: string; src: string; w: number; h: number }) => void;
  addImageFile: (pageId: string, file: File) => Promise<void>;
  addVideoFile: (pageId: string, file: File) => Promise<void>;
  /** 换掉某张图片的内容（双击图片 / 右键「替换图片」）—— 框的位置/样式/说明全部保留 */
  replaceImageFile: (pageId: string, layerId: string, file: File) => Promise<void>;
  /** 换四格相框（frame='quad'）里某一格的图。index 0..3 = 左上/右上/左下/右下 */
  replaceQuadCell: (pageId: string, layerId: string, file: File, index: number) => Promise<void>;
  /** 页面**自带**的结构元素里的图片被换过的记录（元素 id → 新素材）；没换过返回 undefined */
  elImgOf: (pageId: string, elId: string) => ElImage | undefined;
  /**
   * 换掉**结构元素里**的图片（双击相框里的照片 / 右键「替换图片」）。
   * 用户 2026-09-23：「双击相框里的图片可以替换图片」。
   * 与 replaceImageFile 的区别：那个换的是自由图层，这个换的是代码版式里的照片
   * （拍立得 `<img>`、贴纸 `<img>`）—— 只改 src，元素的排版/旋转/位置一个都不动。
   */
  replaceElImage: (pageId: string, elId: string, file: File) => Promise<void>;

  /* 页管理 */
  addPageAfter: (afterId: string) => string;
  removePage: (id: string) => boolean;
  restorePage: (id: string) => void;
  resetPage: (pageId: string) => void;

  /* 默认样式（新建图层的初始值；工具栏未选中贴纸时的「默认框」也读它） */
  defaults: LayerDefaults;
  setDefaults: (patch: Partial<LayerDefaults>) => void;

  /* 撤销 / 重做 */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 立刻把待保存内容写库（Ctrl+S） */
  flushSave: () => void;

  saveState: SaveState | null;
  /** 一次性提示（如"封面是结构页，不能删除"），2.6s 自动消失 */
  hint: string | null;
  say: (msg: string) => void;

  /* 画布桥（由 DiaryCanvas 挂载时写入） */
  bridge: MutableRefObject<CanvasBridge | null>;
};

const Ctx = createContext<DiaryEditorApi | null>(null);

export function useDiaryEditor(): DiaryEditorApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useDiaryEditor 必须在 <DiaryEditorProvider> 内使用');
  return api;
}

/** 拿不到 Provider 时返回 null（EditableText / LayerView / PageEl 这类要能在无 Provider 下降级渲染） */
export function useDiaryEditorOptional(): DiaryEditorApi | null {
  return useContext(Ctx);
}

/** 阅读态里读"用户改过的文字"——没 Provider 时退回默认值（例如单测 / 独立渲染）。 */
export function useDiaryText(): (key: string, fallback: string) => string | RichText {
  const api = useContext(Ctx);
  return api ? api.getText : (_k, fallback) => fallback;
}

/* ============================ 排列：层级重排的纯函数 ============================ */

/**
 * 层级重排（**块式**）：把 `ids` 选中的一组对象在层序里整体搬家，其余对象相对顺序不变，
 * 最后从 `base = max(floor, 原最小 z)` 起、自下而上**重新编号**。
 *
 * 为什么不用"减一档 / 加一档"（老实现 reorderZ 的做法，2026-09-24 修掉）：
 * 层序存的是**整数 z**，这两个算术都会撞车或原地不动 ——
 *   · 置底：`["1","2","3"]` 里把 z=3 那件置底，算出来是 `minZ - 1 = 2`，
 *     而 2 已经被别人占着 ⇒ 实测落库变成 `["1","2","2"]`，**视觉上就是"置底没反应"**；
 *   · 置顶：已经是最高时 `maxZ + 1` 恰好等于它自己的 z ⇒ 同样没反应；
 *   · 上移/下移：邻居位被"同为选中/同为非选中"的判断吃掉时整批跳过 ⇒ 也没反应。
 * 重新编号从根本上没有这些毛病：**永远有空间、永远不撞车**，而且不依赖上面还有没有空档。
 *
 * front / back：整块搬到最上 / 最下（**组内保持相对顺序**，成组搬家的语义）；
 * up / down   ：整块在"槽位"里前后挪一格（一个槽位 = 一个非选中的邻居）。
 * 返回"需要改动的 id → 新 z"；值没变的不出现在结果里。
 *
 * `floor` 是**该域的层级下限**。结构元素域必须传 `Z_FLOOR`：用户 2026-09-23
 * 「置于底层是要放在页面纸张上面，现在是在纸张下面」—— z 一旦为负，
 * `.diary-band` 那个层叠上下文会把元素画在纸张**下面**（见 layout.ts 的 Z_FLOOR 注释）。
 */
function arrangeBlock(
  items: { id: string; z: number }[],
  ids: Set<string>,
  mode: 'up' | 'down' | 'front' | 'back',
  floor = -Infinity,
): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = [...items].sort((a, b) => a.z - b.z);
  const sel = sorted.filter((i) => ids.has(i.id));
  if (!sel.length || sorted.length < 2) return out;
  const others = sorted.filter((i) => !ids.has(i.id));
  const selMin = sel[0].z;
  /** 选中块当前占的"槽位" = 它前面有几个非选中对象（0 = 已经在最底下） */
  let slot = others.filter((o) => o.z < selMin).length;
  if (mode === 'front') slot = others.length;
  else if (mode === 'back') slot = 0;
  else if (mode === 'up') slot = Math.min(others.length, slot + 1);
  else slot = Math.max(0, slot - 1);
  const arranged = [...others.slice(0, slot), ...sel, ...others.slice(slot)];
  const base = Math.max(floor, sorted[0].z);
  /* ⚠️ 必须全量重编，不能只写"值变了的"（用户 2026-09-24 录屏实锤「上移/下一层没反应」）：
     没写过 z 的元素渲染成 z-index:auto，而 CSS 里 auto 永远排在**任何**显式 z 之下。
     老逻辑里恰好"不用改号"的那位交换邻居就保持着 auto —— 选中块的新 z 哪怕只有 1
     也照样压在它头上，层序换了等于没换，用户看到的就是点了一下、toast 弹了、画面没动。
     全量写一遍让整域层序永远显式，交换才能真的可见。 */
  arranged.forEach((it, i) => {
    out.set(it.id, base + i);
  });
  return out;
}

/* ============================ Provider ============================ */

export function DiaryEditorProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<DiaryDoc>(() => ({ v: 1, order: [], extraPages: [], pages: {} }));
  const [ready, setReady] = useState(false);
  const [editing, setEditingState] = useState(false);
  const [pageIndex, setPageIndexRaw] = useState(0);
  const [selection, setSelectionState] = useState<SelRef[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [defaults, setDefaultsState] = useState<LayerDefaults>(readDefaults);

  const docRef = useRef(doc);
  const historyRef = useRef<DiaryDoc[]>([]);
  const redoRef = useRef<DiaryDoc[]>([]);
  const coalesceRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  /** 内部剪贴板：一整批图层（复制结构元素时会被抓成文字图层快照） */
  const clipboardRef = useRef<DiaryLayer[] | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saverRef = useRef<ReturnType<typeof createSaver> | null>(null);
  const bridge = useRef<CanvasBridge | null>(null);
  /** 选区用 ref 镜像一份：快捷键处理器要保持稳定，不该每次点选都重新绑监听 */
  const selRef = useRef<SelRef[]>(selection);
  selRef.current = selection;
  if (!saverRef.current) saverRef.current = createSaver(400);

  /* ---------------- 页序与当前页 ----------------
     页序必须**从这里出去**，不能留在 NotebookOverlay 里：否则会出现
     「provider 需要 pageId → pageId 来自页序+页号 → 页号在 provider 内部」的循环。
     现在 provider 自己持有 pageIndex，pageId 由 order[pageIndex] 推导，
     NotebookOverlay 只是消费它（翻页时调用 setPageIndex）。 */
  const order = useMemo(() => resolveOrder(doc), [doc]);
  const removed = useMemo(() => removedPages(doc), [doc]);
  const total = order.length;
  const safeIndex = Math.min(Math.max(0, pageIndex), Math.max(0, total - 1));
  const pageId = order[safeIndex] ?? 'cover';
  const setPageIndex = useCallback((i: number) => {
    setPageIndexRaw(Number.isFinite(i) ? i : 0);
    /* 选中是"页内"概念：换页后那一页的图层不一定存在，选中框会挂着一个找不着的 id。
       编辑态现在可以直接翻页（见 NotebookOverlay 的 flipTo），所以这里必须清掉。 */
    setSelectionState([]);
  }, []);

  /* ---------------- 载入 ---------------- */

  useEffect(() => {
    let alive = true;
    void (async () => {
      const raw = await loadDoc();
      const hydrated = await hydrateDoc(raw);
      if (!alive) return;
      docRef.current = hydrated;
      setDoc(hydrated);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const saver = saverRef.current!;
    const off = saver.onState((s) => setSaveState(s));
    return () => {
      off();
    };
  }, []);

  /* ---------------- 保存（防抖） ---------------- */

  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!loadedOnce.current) {
      /* 首次载入不写库（会把空文档盖掉真实内容的那一帧风险留给别处，这里直接跳过） */
      loadedOnce.current = true;
      return;
    }
    saverRef.current!.push(doc);
  }, [doc, ready]);

  /* ---------------- 变更入口 ---------------- */

  const say = useCallback((msg: string) => {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2600);
  }, []);

  const pushHistory = useCallback((prev: DiaryDoc, coalesceKey?: string) => {
    const now = Date.now();
    const c = coalesceRef.current;
    if (coalesceKey && c.key === coalesceKey && now - c.at < 900) {
      c.at = now;
      return;
    }
    coalesceRef.current = { key: coalesceKey ?? null, at: now };
    historyRef.current.push(prev);
    if (historyRef.current.length > 80) historyRef.current.shift();
    setCanUndo(true);
    /* 新的改动落下 → 重做栈作废（这是编辑器的通用语义） */
    if (redoRef.current.length) {
      redoRef.current = [];
      setCanRedo(false);
    }
  }, []);

  const mutate = useCallback(
    (fn: (d: DiaryDoc) => DiaryDoc, coalesceKey?: string) => {
      const prev = docRef.current;
      const next = fn(prev);
      if (next === prev) return;
      pushHistory(prev, coalesceKey);
      docRef.current = next;
      setDoc(next);
    },
    [pushHistory],
  );

  /** 改某一页的 PageEdit（不存在就造一个） */
  const mutatePage = useCallback(
    (pageId: string, fn: (p: PageEdit) => PageEdit, coalesceKey?: string) => {
      mutate((d) => {
        const cur = d.pages[pageId] ?? EMPTY_PAGE;
        const nextPage = fn(cur);
        if (nextPage === cur) return d;
        return { ...d, pages: { ...d.pages, [pageId]: nextPage } };
      }, coalesceKey);
    },
    [mutate],
  );

  /* ---------------- 文字覆盖 ---------------- */

  const getText = useCallback(
    (key: string, fallback: string): string | RichText => {
      /* key 形如 `${pageId}:${slot}` —— 直接按页取，避免扫全表 */
      const cut = key.indexOf(':');
      const pp = cut < 0 ? key : key.slice(0, cut);
      const slot = cut < 0 ? '' : key.slice(cut + 1);
      const v = doc.pages[pp]?.text?.[slot];
      return v === undefined ? fallback : v;
    },
    [doc],
  );

  const setText = useCallback(
    (key: string, value: string | RichText) => {
      const cut = key.indexOf(':');
      const pp = cut < 0 ? key : key.slice(0, cut);
      const slot = cut < 0 ? '' : key.slice(cut + 1);
      /* 富文本落库前先洗干净（渲染时走 dangerouslySetInnerHTML，不能留任意标签） */
      const next: string | RichText =
        typeof value === 'string' ? value : { html: sanitizeRichHtml(value.html) };
      mutatePage(
        pp,
        (p) => {
          const cur = p.text ?? {};
          const old = cur[slot];
          /* 比较要按"内容"比：`{html}` 每次都是新对象，用引用比会永远判成"变了"。
             ⚠️ 槽还没有值（`old === undefined`）时不能直接读 `old.html` —— 会 TypeError。 */
          const same =
            old === undefined
              ? false
              : typeof old === 'string' || typeof next === 'string'
                ? old === next
                : old.html === next.html;
          if (same) return p;
          return { ...p, text: { ...cur, [slot]: next } };
        },
        `text:${key}`,
      );
    },
    [mutatePage],
  );

  /* ---------------- 纸张 ---------------- */

  const paperOf = useCallback((pageId: string) => docRef.current.pages[pageId]?.paper, []);

  const setPaper = useCallback(
    (pageId: string, paper: PaperStyle | undefined) => {
      mutatePage(pageId, (p) => ({ ...p, paper }), `paper:${pageId}`);
    },
    [mutatePage],
  );

  /* ---------------- 图层 ---------------- */

  const layersOf = useCallback((pageId: string) => doc.pages[pageId]?.layers ?? NO_LAYERS, [doc]);

  const addLayer = useCallback(
    (pageId: string, layer: DiaryLayer) => {
      mutatePage(pageId, (p) => ({ ...p, layers: [...p.layers, layer] }));
    },
    [mutatePage],
  );

  const updateLayer = useCallback(
    (pageId: string, id: string, patch: Partial<DiaryLayer>, coalesceKey?: string) => {
      mutatePage(
        pageId,
        (p) => ({
          ...p,
          layers: p.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as DiaryLayer) : l)),
        }),
        coalesceKey ?? `layer:${pageId}:${id}`,
      );
    },
    [mutatePage],
  );

  /** 媒体清理：只有**全库再没有图层引用**这个 mediaId 时才删 Blob（复制出来的副本会共用它） */
  const purgeMedia = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const d = docRef.current;
    const used = new Set<string>();
    for (const p of Object.values(d.pages))
      for (const l of p.layers) {
        if (l.type !== 'text' && l.mediaId) used.add(l.mediaId);
        /* 四格相框里单独换过的格子也占着媒体记录 —— 不算进引用会把还挂着的图清掉 */
        if (l.type === 'image' && Array.isArray(l.quadCells))
          for (const c of l.quadCells) if (c?.mediaId) used.add(c.mediaId);
      }
    for (const mid of ids) {
      if (used.has(mid)) continue;
      forgetMediaUrl(mid);
      void deleteMedia(mid);
    }
  }, []);

  const removeLayer = useCallback(
    (pageId: string, id: string) => {
      let media: string[] = [];
      mutatePage(pageId, (p) => {
        const target = p.layers.find((l) => l.id === id);
        if (!target) return p;
        if (target.type !== 'text' && target.mediaId) media.push(target.mediaId);
        /* 四格相框：格子里单独换过的图也跟着图层一起走 */
        if (target.type === 'image' && Array.isArray(target.quadCells))
          for (const c of target.quadCells) if (c?.mediaId) media.push(c.mediaId);
        return { ...p, layers: p.layers.filter((l) => l.id !== id) };
      });
      purgeMedia(media);
      setSelectionState((cur) => cur.filter((r) => !(r.kind === 'layer' && r.id === id)));
    },
    [mutatePage, purgeMedia],
  );

  const selected = useMemo(() => {
    const p = selection[selection.length - 1];
    if (!p || p.kind !== 'layer') return null;
    return (doc.pages[pageId]?.layers ?? []).find((l) => l.id === p.id) ?? null;
  }, [selection, doc, pageId]);

  const sel = selected?.id ?? null;
  const selEl = selection.length && selection[selection.length - 1].kind === 'el' ? selection[selection.length - 1].id : null;

  /** 兼容旧调用点：`setSel('layer-id')` = 单选这个图层；`setSel(null)` = 取消选中 */
  const setSel = useCallback((id: string | null) => {
    setSelectionState(id ? [{ kind: 'layer', id }] : []);
  }, []);

  /* 翻页时清掉选中（选中的东西不在当前页了，手柄还画着就很容易误操作） */
  const lastPageId = useRef(pageId);
  useEffect(() => {
    if (lastPageId.current !== pageId) {
      lastPageId.current = pageId;
      setSelectionState([]);
    }
  }, [pageId]);

  /* ---------------- 结构元素的变换覆盖 ---------------- */

  const elOf = useCallback(
    (pid: string, elId: string) => doc.pages[pid]?.els?.[elId],
    [doc],
  );

  const elsOf = useCallback((pid: string) => doc.pages[pid]?.els ?? NO_ELS, [doc]);

  const updateEl = useCallback(
    (pid: string, elId: string, patch: Partial<ElOverride>, coalesceKey?: string) => {
      mutatePage(
        pid,
        (p) => {
          const cur = p.els?.[elId] ?? { ...IDENTITY_EL };
          const next: ElOverride = { ...cur, ...patch };
          next.sc = Math.min(MAX_EL_SC, Math.max(MIN_EL_SC, next.sc));
          next.rot = normDeg(next.rot);
          /* 回到"没动过"就把这条记录整个删掉 —— 不留下 (0,0,0,1) 这种空壳 */
          if (isIdentityEl(next)) {
            if (!p.els?.[elId]) return p;
            const els = { ...p.els };
            delete els[elId];
            return { ...p, els: Object.keys(els).length ? els : undefined };
          }
          return { ...p, els: { ...(p.els ?? {}), [elId]: next } };
        },
        coalesceKey ?? `el:${pid}:${elId}`,
      );
    },
    [mutatePage],
  );

  /**
   * 改结构元素里**文字**的样式。
   *
   * 与 `updateEl`（位移/旋转/缩放）分开是因为落点不同：变换打在元素本身，
   * 文字样式要打在它内部的每个 `[data-dp-slot]` 上（见 layout.ts 的 elTextStyle 注释）。
   * 两者共用同一条 `els[elId]` 记录，所以"挪过位置"和"改过字体"不会互相覆盖。
   *
   * 传 `undefined` 表示**清掉这一项的覆盖**（回到页面原本的排版样式）。
   */
  const updateElText = useCallback(
    (pid: string, elId: string, patch: Partial<ElTextStyle>, coalesceKey?: string) => {
      mutatePage(
        pid,
        (p) => {
          const cur: ElOverride = p.els?.[elId] ?? { ...IDENTITY_EL };
          const nextText: ElTextStyle = { ...(cur.text ?? {}), ...patch };
          if (nextText.size !== undefined) {
            nextText.size = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(nextText.size)));
          }
          const next: ElOverride = { ...cur, text: isEmptyElText(nextText) ? undefined : nextText };
          if (isIdentityEl(next)) {
            if (!p.els?.[elId]) return p;
            const els = { ...p.els };
            delete els[elId];
            return { ...p, els: Object.keys(els).length ? els : undefined };
          }
          return { ...p, els: { ...(p.els ?? {}), [elId]: next } };
        },
        coalesceKey ?? `elt:${pid}:${elId}`,
      );
    },
    [mutatePage],
  );

  /**
   * 改**某一个槽**的文字样式（`ElOverride.texts[slot]`）。
   *
   * 用户 2026-09-23：「选中的文字变色不了，变的是没选中的文字」。
   * 光标停在某个文字槽里（双击进改字态）时改样式，作用域只能是**这一槽** ——
   * 之前一律写元素级，而 `core` 那种元素包着 22 个槽，一改就"整块思维导图变绿"。
   *
   * ⚠️ 与 `updateElText`（元素级）**分开存**：先给整块改红、再给某行改蓝时，
   *    红色仍在 `text` 里、蓝色在 `texts[slot]` 里，其余行不会被牵连。
   */
  const updateElSlotText = useCallback(
    (pid: string, elId: string, slot: string, patch: Partial<ElTextStyle>, coalesceKey?: string) => {
      mutatePage(
        pid,
        (p) => {
          const cur: ElOverride = p.els?.[elId] ?? { ...IDENTITY_EL };
          const nextOne: ElTextStyle = { ...(cur.texts?.[slot] ?? {}), ...patch };
          if (nextOne.size !== undefined) {
            nextOne.size = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(nextOne.size)));
          }
          const texts = { ...(cur.texts ?? {}) };
          if (isEmptyElText(nextOne)) delete texts[slot];
          else texts[slot] = nextOne;
          const next: ElOverride = {
            ...cur,
            texts: Object.keys(texts).length ? texts : undefined,
          };
          if (isIdentityEl(next)) {
            if (!p.els?.[elId]) return p;
            const els = { ...p.els };
            delete els[elId];
            return { ...p, els: Object.keys(els).length ? els : undefined };
          }
          return { ...p, els: { ...(p.els ?? {}), [elId]: next } };
        },
        coalesceKey ?? `elts:${pid}:${elId}:${slot}`,
      );
    },
    [mutatePage],
  );

  /* ---------------- 组 ---------------- */
  const groupsOf = useCallback((pid: string) => doc.pages[pid]?.groups ?? NO_GROUPS, [doc]);

  const groupOf = useCallback(
    (pid: string, ref: SelRef) => {
      const m = memberRef(ref);
      return (doc.pages[pid]?.groups ?? []).find((g) => g.members.includes(m)) ?? null;
    },
    [doc],
  );

  /**
   * 把选中集合展开成"实际要动的对象"：组内成员整组跟着动。
   * 这是「可建组、整组移动」的全部实现 —— 所有变换/删除/复制都先过这一层。
   */
  const expandRefs = useCallback((pid: string, refs: SelRef[]): SelRef[] => {
    const groups = docRef.current.pages[pid]?.groups ?? [];
    if (!groups.length || !refs.length) return refs;
    const out: SelRef[] = [];
    const seen = new Set<string>();
    const push = (r: SelRef) => {
      const k = memberRef(r);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(r);
    };
    for (const r of refs) {
      push(r);
      const g = groups.find((gg) => gg.members.includes(memberRef(r)));
      if (g) for (const m of g.members) push(parseMemberRef(m));
    }
    return out;
  }, []);

  const setSelection = useCallback((refs: SelRef[]) => setSelectionState(refs), []);

  const selectRef = useCallback((ref: SelRef, mode: 'replace' | 'toggle' = 'replace') => {
    setSelectionState((cur) => {
      const has = cur.some((r) => sameRef(r, ref));
      if (mode === 'toggle') {
        if (has) return cur.filter((r) => !sameRef(r, ref));
        return [...cur, ref];
      }
      if (has && cur.length === 1) return cur;
      return [ref];
    });
  }, []);

  const isSelected = useCallback(
    (ref: SelRef) => selection.some((r) => sameRef(r, ref)),
    [selection],
  );

  const groupSelection = useCallback(() => {
    const refs = selRef.current;
    if (refs.length < 2) {
      say('先选中两个以上对象（按住 Shift 点选 / 在空白处拖一个框）再成组');
      return;
    }
    const members = refs.map(memberRef);
    const gid = uid('g');
    mutatePage(pageId, (p) => {
      /* 一个对象只能属于一个组：先从其它组里摘掉，再建新组 */
      const kept = (p.groups ?? [])
        .map((g) => ({ ...g, members: g.members.filter((m) => !members.includes(m)) }))
        .filter((g) => g.members.length >= 2);
      return { ...p, groups: [...kept, { id: gid, name: `组合 ${kept.length + 1}`, members }] };
    });
    say(`已成组（${refs.length} 个对象）—— 之后点其中任意一个，整组一起动`);
  }, [mutatePage, pageId, say]);

  const ungroupSelection = useCallback(() => {
    const page = docRef.current.pages[pageId];
    const groups = page?.groups ?? [];
    if (!groups.length) {
      say('这一页还没有组合');
      return;
    }
    const members = new Set(expandRefs(pageId, selRef.current).map(memberRef));
    const hit = new Set(groups.filter((g) => g.members.some((m) => members.has(m))).map((g) => g.id));
    if (!hit.size) {
      say('选中的对象不在任何组合里');
      return;
    }
    mutatePage(pageId, (p) => {
      const nx = (p.groups ?? []).filter((g) => !hit.has(g.id));
      return { ...p, groups: nx.length ? nx : undefined };
    });
    say('已解组');
  }, [expandRefs, mutatePage, pageId, say]);

  /* ---------------- 变换：位移 / 缩放 / 旋转（对一批引用） ---------------- */

  const moveRefs = useCallback(
    (pid: string, refs: SelRef[], dx: number, dy: number, key?: string) => {
      if (!refs.length) return;
      const lset = new Set(refs.filter((r) => r.kind === 'layer').map((r) => r.id));
      const eset = new Set(refs.filter((r) => r.kind === 'el').map((r) => r.id));
      mutatePage(
        pid,
        (p) => {
          let touched = false;
          const layers = p.layers.map((l) => {
            if (!lset.has(l.id)) return l;
            touched = true;
            return { ...l, cx: clampCenter(l.cx + dx), cy: clampCenter(l.cy + dy) };
          });
          let els = p.els;
          if (eset.size) {
            els = { ...(els ?? {}) };
            for (const id of eset) {
              const cur = els[id] ?? { ...IDENTITY_EL };
              els[id] = { ...cur, dx: cur.dx + dx, dy: cur.dy + dy };
              touched = true;
            }
          }
          return touched ? { ...p, layers, els } : p;
        },
        key,
      );
    },
    [mutatePage],
  );

  const scaleRefs = useCallback(
    (
      pid: string,
      refs: SelRef[],
      k: number,
      center: { x: number; y: number },
      ar: number,
      key?: string,
    ) => {
      if (!refs.length || !Number.isFinite(k) || k <= 0) return;
      const lset = new Set(refs.filter((r) => r.kind === 'layer').map((r) => r.id));
      const eset = new Set(refs.filter((r) => r.kind === 'el').map((r) => r.id));
      const boxes = bridge.current?.elBoxes ?? {};
      mutatePage(
        pid,
        (p) => {
          const layers = p.layers.map((l) => {
            if (!lset.has(l.id)) return l;
            const at = scaleAbout(l.cx, l.cy, center.x, center.y, k, ar);
            const w = Math.min(MAX_LAYER_W, Math.max(MIN_LAYER_W, l.w * k));
            if (l.type === 'text') {
              const size = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, l.size * k));
              return { ...l, cx: at.x, cy: at.y, w, size };
            }
            return { ...l, cx: at.x, cy: at.y, w };
          });
          let els = p.els;
          if (eset.size) {
            els = { ...(els ?? {}) };
            for (const id of eset) {
              const b = boxes[id];
              const cur = els[id] ?? { ...IDENTITY_EL };
              if (!b) {
                els[id] = { ...cur, sc: Math.min(MAX_EL_SC, Math.max(MIN_EL_SC, cur.sc * k)) };
                continue;
              }
              /* 元素的位置 = 原位 + 覆盖位移；缩放要连位置一起绕中心缩放，
                 否则多个对象成组时它们会各自原地变大、组的形状散掉 */
              const at = scaleAbout(b.cx + cur.dx, b.cy + cur.dy, center.x, center.y, k, ar);
              els[id] = {
                ...cur,
                dx: at.x - b.cx,
                dy: at.y - b.cy,
                sc: Math.min(MAX_EL_SC, Math.max(MIN_EL_SC, cur.sc * k)),
              };
            }
          }
          return { ...p, layers, els };
        },
        key,
      );
    },
    [mutatePage],
  );

  const rotateRefs = useCallback(
    (
      pid: string,
      refs: SelRef[],
      deg: number,
      center: { x: number; y: number },
      ar: number,
      key?: string,
    ) => {
      if (!refs.length || !Number.isFinite(deg) || !deg) return;
      const lset = new Set(refs.filter((r) => r.kind === 'layer').map((r) => r.id));
      const eset = new Set(refs.filter((r) => r.kind === 'el').map((r) => r.id));
      const boxes = bridge.current?.elBoxes ?? {};
      mutatePage(
        pid,
        (p) => {
          const layers = p.layers.map((l) => {
            if (!lset.has(l.id)) return l;
            const at = rotateAbout(l.cx, l.cy, center.x, center.y, deg, ar);
            return { ...l, cx: at.x, cy: at.y, rot: normDeg(l.rot + deg) };
          });
          let els = p.els;
          if (eset.size) {
            els = { ...(els ?? {}) };
            for (const id of eset) {
              const b = boxes[id];
              const cur = els[id] ?? { ...IDENTITY_EL };
              if (!b) {
                els[id] = { ...cur, rot: normDeg(cur.rot + deg) };
                continue;
              }
              const at = rotateAbout(b.cx + cur.dx, b.cy + cur.dy, center.x, center.y, deg, ar);
              els[id] = { ...cur, dx: at.x - b.cx, dy: at.y - b.cy, rot: normDeg(cur.rot + deg) };
            }
          }
          return { ...p, layers, els };
        },
        key,
      );
    },
    [mutatePage],
  );

  /* ---------------- 排列：层级 / 对齐 ---------------- */

  const orderRefs = useCallback(
    (pid: string, refs: SelRef[], mode: 'up' | 'down' | 'front' | 'back') => {
      if (!refs.length) return;
      const lset = new Set(refs.filter((r) => r.kind === 'layer').map((r) => r.id));
      const eset = new Set(refs.filter((r) => r.kind === 'el').map((r) => r.id));
      const elBoxes = bridge.current?.elBoxes ?? {};
      let sankUnder = false;
      mutatePage(pid, (p) => {
        let next = p;
        if (lset.size) {
          /* 图层域（用户 2026-09-23、2026-09-24 两次反馈）。
             两个要点：
               ① z 只决定**普通图层彼此**的次序 —— 它们整体住在"页面内容之上"的宿主里
                  （阅读态 `.dp-layerhost` z=2、编辑态 `.dp-canvas` z=60），
                  单靠 z 永远沉不到正文下面。所以「置底」按到底要多一档 `under`：
                  已经在普通图层最底时再按一次 → 改画在 `.dp-layerhost.is-under`（z=0，
                  纸张之上、页面内容之下）。
               ② 重排一律走 arrangeBlock（整块重新编号）—— 老的"减一档 / 加一档"
                  会算出别人占着的 z、或算出等于自己原值的 z，用户看到的就是
                  「置顶置底上移下移都没用了」。 */
          const selL = next.layers.filter((l) => lset.has(l.id));
          const normalL = next.layers.filter((l) => !l.under);
          const normalOther = normalL.filter((l) => !lset.has(l.id));
          const allUnder = selL.length > 0 && selL.every((l) => l.under);
          const selMinZ = Math.min(...selL.filter((l) => !l.under).map((l) => l.z), Infinity);
          /** 选中块前面还有没有非选中的普通图层 —— 没有就说明它已经在普通层最底 */
          const atBottom = selL.some((l) => !l.under) && !normalOther.some((l) => l.z < selMinZ);
          const patch = new Map<string, { z?: number; under?: boolean }>();
          /** 重排普通图层域；把"还压在页面下面的选中项"一并纳入，好让它们落回序列里 */
          const renumber = (m: 'up' | 'down' | 'front' | 'back') => {
            const domain = normalL.concat(selL.filter((l) => l.under)).map((l) => ({ id: l.id, z: l.z }));
            for (const [id, z] of arrangeBlock(domain, lset, m, 1)) patch.set(id, { z });
          };
          /** 把选中项从"页面下面"拉回普通图层域（under 抹掉，z 由 renumber 定） */
          const lift = (m: 'up' | 'down' | 'front' | 'back') => {
            renumber(m);
            for (const l of selL) if (l.under) patch.set(l.id, { ...(patch.get(l.id) ?? {}), under: false });
          };
          if (mode === 'front') {
            lift('front');
          } else if (mode === 'back') {
            if (allUnder) {
              /* 已经在页面内容下面，没有更下面了 */
            } else if (!normalOther.length || atBottom) {
              for (const l of selL) patch.set(l.id, { under: true });
            } else {
              renumber('back');
            }
          } else if (mode === 'up') {
            /* 从页面下面回来只挪一格 → 落在**图层域的最底**
               （正面情形：把 under 项当块插到 others 之前 = 槽位 0） */
            if (allUnder) lift('back');
            else renumber('up');
          } else {
            if (allUnder) {
              /* 已经贴着页面内容的下沿了 */
            } else if (!normalOther.length || atBottom) {
              for (const l of selL) patch.set(l.id, { under: true });
            } else {
              renumber('down');
            }
          }
          if (patch.size) {
            sankUnder = [...patch.values()].some((v) => v.under === true);
            next = {
              ...next,
              layers: next.layers.map((l) => (patch.has(l.id) ? { ...l, ...patch.get(l.id)! } : l)),
            };
          }
        }
        if (eset.size) {
          /* 结构元素域：以"实测到的元素"为全集（DOM 顺序 = 默认层序），
             z 没设过的算 0。只是比大小，所以基准值随便，只要彼此可比。
             ⚠️ floor 必须给 Z_FLOOR —— 否则"置底"会把 z 写成负数，
                元素被 `.diary-band` 的层叠上下文画到纸张**下面**去。 */
          const items = Object.keys(elBoxes).map((id, i) => ({
            id,
            z: next.els?.[id]?.z ?? i,
          }));
          const map = arrangeBlock(items, eset, mode, Z_FLOOR);
          if (map.size) {
            const els = { ...(next.els ?? {}) };
            for (const [id, z] of map) els[id] = { ...(els[id] ?? { ...IDENTITY_EL }), z };
            next = { ...next, els };
          }
        }
        return next;
      });
      const label =
        mode === 'front'
          ? '已置于顶层'
          : mode === 'back'
            ? sankUnder
              ? '已沉到页面内容下面（用「上移一层」可以拉回图层里）'
              : '已置于底层'
            : mode === 'up'
              ? '已上移一层'
              : sankUnder
                ? '已沉到页面内容下面（用「上移一层」可以拉回图层里）'
                : '已下移一层';
      say(label);
    },
    [mutatePage, say],
  );

  /**
   * 选中对象在**层序里的位置**（给工具栏回显「第几层 / 顶层 / 底层」用）。
   *
   * 用户 2026-09-23 录屏投诉：「编辑的时候还是看不到是不是在底层或顶层」。
   * 层级重排的数据早就对了，但界面上没有任何东西告诉用户"它现在在第几层、
   * 是不是已经到顶/到底了"。这里把选中块的层位算出来：
   *
   *   · 图层：普通图层按 z 排序（under 的算"最底一档"，永远排在普通层之下）；
   *   · 结构元素：按 `els[id].z`（没设过的按 DOM 顺序兜底）。
   *
   * 返回 `null` = 当前没有可回显的层级信息（没选中 / 对象不存在 / 只有一件）。
   */
  const zRankOf = useCallback(
    (pid: string, refs: SelRef[]): { position: number; total: number; isTop: boolean; isBottom: boolean; under: boolean } | null => {
      if (!refs.length) return null;
      const lset = new Set(refs.filter((r) => r.kind === 'layer').map((r) => r.id));
      const eset = new Set(refs.filter((r) => r.kind === 'el').map((r) => r.id));
      if (lset.size) {
        /* 图层域：普通图层按 z 升序，under 的一律垫在最后（"页面内容下面"是最底一档） */
        const page = doc.pages[pid];
        const layers = page?.layers ?? [];
        const normal = layers.filter((l) => !l.under).slice().sort((a, b) => a.z - b.z);
        const sunk = layers.filter((l) => l.under);
        const order = [...normal, ...sunk];
        const sel = order.filter((l) => lset.has(l.id));
        if (!sel.length) return null;
        /* 选中块取"最靠上"那个成员的位置（多选时以最上层为准更直观） */
        const top = sel[sel.length - 1];
        const topIdx = order.indexOf(top);
        const anyUnder = sel.some((l) => l.under);
        return {
          position: topIdx + 1,
          total: order.length,
          isTop: topIdx === order.length - 1,
          isBottom: anyUnder || topIdx === 0,
          under: anyUnder,
        };
      }
      if (eset.size) {
        /* 结构元素域：z 没设过的按 DOM 顺序（elBoxes 的 key 顺序）兜底 */
        const boxes = bridge.current?.elBoxes ?? {};
        const items = Object.keys(boxes).map((id, i) => ({
          id,
          z: doc.pages[pid]?.els?.[id]?.z ?? i,
        }));
        if (!items.length) return null;
        items.sort((a, b) => a.z - b.z);
        const sel = items.filter((it) => eset.has(it.id));
        if (!sel.length) return null;
        const top = sel[sel.length - 1];
        const topIdx = items.findIndex((it) => it.id === top.id);
        return {
          position: topIdx + 1,
          total: items.length,
          isTop: topIdx === items.length - 1,
          isBottom: topIdx === 0,
          under: false,
        };
      }
      return null;
    },
    [doc],
  );

  const alignRefs = useCallback(
    (pid: string, refs: SelRef[], mode: 'hcenter' | 'vcenter') => {
      if (!refs.length) return;
      const lset = new Set(refs.filter((r) => r.kind === 'layer').map((r) => r.id));
      const eset = new Set(refs.filter((r) => r.kind === 'el').map((r) => r.id));
      const boxes = bridge.current?.elBoxes ?? {};
      mutatePage(pid, (p) => {
        const layers = p.layers.map((l) => {
          if (!lset.has(l.id)) return l;
          return mode === 'hcenter' ? { ...l, cx: 0.5 } : { ...l, cy: 0.5 };
        });
        let els = p.els;
        if (eset.size) {
          els = { ...(els ?? {}) };
          for (const id of eset) {
            const b = boxes[id];
            if (!b) continue;
            const cur = els[id] ?? { ...IDENTITY_EL };
            els[id] =
              mode === 'hcenter'
                ? { ...cur, dx: 0.5 - b.cx }
                : { ...cur, dy: 0.5 - b.cy };
          }
        }
        return { ...p, layers, els };
      });
      say(mode === 'hcenter' ? '已水平居中' : '已垂直居中');
    },
    [mutatePage, say],
  );

  /* ---------------- 剪贴板 ---------------- */

  const copySelection = useCallback(() => {
    const refs = expandRefs(pageId, selRef.current);
    if (!refs.length) return false;
    const page = docRef.current.pages[pageId];
    const layers: DiaryLayer[] = [];
    for (const r of refs) {
      if (r.kind !== 'layer') continue;
      const l = page?.layers.find((x) => x.id === r.id);
      if (l) layers.push(l);
    }
    const elRefs = refs.filter((r) => r.kind === 'el');
    const snaps = elRefs.length ? bridge.current?.snapshot(pageId, elRefs) ?? [] : [];
    const payload = [...layers, ...snaps].map((l) => JSON.parse(JSON.stringify(l)) as DiaryLayer);
    if (!payload.length) return false;
    clipboardRef.current = payload;
    say(`已复制 ${payload.length} 个对象，Ctrl+V 粘贴`);
    return true;
  }, [expandRefs, pageId, say]);

  const pasteClipboard = useCallback(
    (targetPage: string) => {
      const src = clipboardRef.current;
      if (!src?.length) return false;
      const baseZ = (docRef.current.pages[targetPage]?.layers ?? []).reduce((m, l) => Math.max(m, l.z), 0);
      const copies = src.map((l, i) => {
        const c = JSON.parse(JSON.stringify(l)) as DiaryLayer;
        c.id = uid(c.type[0]);
        /* 稍稍错开，否则粘出来的和原图完全重叠、看着像没反应 */
        c.cx = Math.min(1.02, c.cx + 0.035);
        c.cy = Math.min(1.02, c.cy + 0.035);
        c.z = baseZ + 1 + i;
        return c;
      });
      mutatePage(targetPage, (p) => ({ ...p, layers: [...p.layers, ...copies] }));
      setSelectionState(copies.map((c) => ({ kind: 'layer' as const, id: c.id })));
      say(`已粘贴 ${copies.length} 个对象`);
      return true;
    },
    [mutatePage, say],
  );

  const duplicateSelection = useCallback(() => {
    if (!copySelection()) return false;
    return pasteClipboard(pageId);
  }, [copySelection, pasteClipboard, pageId]);

  const deleteSelection = useCallback(() => {
    const refs = expandRefs(pageId, selRef.current);
    if (!refs.length) return;
    const lset = new Set(refs.filter((r) => r.kind === 'layer').map((r) => r.id));
    const eset = new Set(refs.filter((r) => r.kind === 'el').map((r) => r.id));
    let media: string[] = [];
    mutatePage(pageId, (p) => {
      const layers = p.layers.filter((l) => !lset.has(l.id));
      if (lset.size) media = p.layers.filter((l) => lset.has(l.id) && l.type !== 'text' && l.mediaId).map((l) => (l as { mediaId: string }).mediaId);
      /* 结构元素不能真删（它们来自页面版式）—— Delete = 清掉位移/旋转/缩放，回到原位 */
      let els = p.els;
      if (eset.size && els) {
        els = { ...els };
        for (const id of eset) delete els[id];
        if (!Object.keys(els).length) els = undefined;
      }
      /* 成员被删掉的组：成员不足 2 个就自动解散，免得留下"空壳组" */
      let groups = p.groups;
      if (groups?.length) {
        const gone = new Set([...lset].map((id) => `l:${id}`));
        const nx = groups
          .map((g) => ({ ...g, members: g.members.filter((m) => !gone.has(m)) }))
          .filter((g) => g.members.length >= 2);
        if (nx.length !== groups.length) groups = nx.length ? nx : undefined;
      }
      if (!lset.size && !eset.size) return p;
      return { ...p, layers, els, groups };
    });
    purgeMedia(media);
    setSelectionState([]);
    say(eset.size && !lset.size ? '已把结构元素放回原位' : `已删除 ${refs.length} 个对象`);
  }, [expandRefs, mutatePage, pageId, purgeMedia, say]);

  /**
   * 剪切 = 复制 + 删除（Ctrl+X / 右键菜单）。
   *
   * ⚠️ 对**结构元素**语义略有不同，这是有意的：复制那一份现在是个文字贴纸快照，
   *    而原元素不能真删（它来自页面版式）—— 所以"删"的落点是把它的位移/旋转/缩放
   *    清掉、回到原位。用户看到的是"原地不动的一份 + 粘贴区里多了一份素材"，
   *    比"元素凭空消失、版式塌一块"合理得多。
   */
  const cutSelection = useCallback(() => {
    if (!copySelection()) return false;
    deleteSelection();
    return true;
  }, [copySelection, deleteSelection]);

  /**
   * 把选中的结构元素**放回原位**（只清位移/旋转/缩放/层级，保留改过的字体字号颜色）。
   * 右键菜单里的「回到原位」用它 —— 只清变换不碰文字样式，是两件事。
   */
  const resetElTransform = useCallback(
    () => {
      const refs = expandRefs(pageId, selRef.current).filter((r) => r.kind === 'el');
      if (!refs.length) return false;
      for (const r of refs) {
        updateEl(pageId, r.id, { dx: 0, dy: 0, rot: 0, sc: 1, z: undefined });
      }
      say('已回到原位');
      return true;
    },
    [expandRefs, pageId, say, updateEl],
  );

  const selectAllOnPage = useCallback(() => {
    const page = docRef.current.pages[pageId];
    const layers: SelRef[] = (page?.layers ?? []).map((l) => ({ kind: 'layer', id: l.id }));
    const els: SelRef[] = Object.keys(bridge.current?.elBoxes ?? {}).map((id) => ({ kind: 'el', id }));
    if (!layers.length && !els.length) return;
    setSelectionState([...layers, ...els]);
    say(`已选中本页 ${layers.length + els.length} 个对象`);
  }, [pageId, say]);

  const cycleSelection = useCallback(
    (dir: 1 | -1) => {
      const items = bridge.current?.orderedBoxes() ?? [];
      if (!items.length) return;
      const cur = selRef.current;
      const last = cur.length ? cur[0] : null;
      let i = last ? items.findIndex((it) => sameRef(it.ref, last)) : -1;
      i = i < 0 ? (dir === 1 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
      setSelectionState([items[i].ref]);
    },
    [],
  );

  const editSelectedText = useCallback(() => {
    const cur = selRef.current;
    const last = cur.length ? cur[cur.length - 1] : null;
    if (!last) return;
    const ok = bridge.current?.focusText(last);
    if (!ok) say('这个对象没有可编辑的文字');
  }, [say]);

  /* ---------------- 素材 / 上传 ---------------- */

  const nextZ = (pageId: string) =>
    (docRef.current.pages[pageId]?.layers ?? []).reduce((m, l) => Math.max(m, l.z), 0) + 1;

  const addSticker = useCallback(
    (targetPage: string, asset: { id: string; src: string; w: number; h: number }) => {
      const spot = staggerSpot(docRef.current.pages[targetPage]?.layers ?? []);
      /* 宽度的初始值按素材纵横比给：长条（胶带）窄一点、方块（贴纸）大一点，
         免得一落下来就横贯整页或小得看不见 */
      const ar = (asset.w || 1) / (asset.h || 1);
      const w = ar > 2.4 ? 0.3 : ar < 0.5 ? 0.16 : 0.22;
      const layer: DiaryLayer = {
        id: uid('s'),
        type: 'image',
        src: asset.src,
        nw: asset.w || 1,
        nh: asset.h || 1,
        cx: spot.cx,
        cy: spot.cy,
        w,
        rot: 0,
        z: nextZ(targetPage),
        frame: 'none',
      };
      addLayer(targetPage, layer);
      setSelectionState([{ kind: 'layer', id: layer.id }]);
    },
    [addLayer],
  );

  const addMediaLayer = useCallback(
    async (targetPage: string, file: File, kind: 'image' | 'video') => {
      const id = uid(kind === 'video' ? 'v' : 'i');
      const url = URL.createObjectURL(file);
      try {
        if (kind === 'image') {
          const { w, h } = await imageSize(url);
          await putMedia({ id, kind: 'image', name: file.name, blob: file });
          const layer: DiaryLayer = {
            id,
            type: 'image',
            src: url,
            mediaId: id,
            nw: w,
            nh: h,
            cx: 0.5,
            cy: 0.45,
            /* 宽按素材纵横比挑一个舒服的初始值：竖图给窄一点，免得一进来就顶天立地 */
            w: h / w > 1.5 ? 0.2 : 0.34,
            rot: 0,
            z: nextZ(targetPage),
            frame: defaults.frame,
          };
          addLayer(targetPage, layer);
          setSelectionState([{ kind: 'layer', id: layer.id }]);
        } else {
          const probe = await videoProbe(url);
          await putMedia({ id, kind: 'video', name: file.name, blob: file });
          const layer: DiaryLayer = {
            id,
            type: 'video',
            src: url,
            mediaId: id,
            poster: probe.poster,
            nw: probe.w,
            nh: probe.h,
            cx: 0.5,
            cy: 0.45,
            w: 0.36,
            rot: 0,
            z: nextZ(targetPage),
            frame: defaults.frame === 'circle' ? 'none' : defaults.frame,
          };
          addLayer(targetPage, layer);
          setSelectionState([{ kind: 'layer', id: layer.id }]);
        }
      } catch {
        URL.revokeObjectURL(url);
        say('这个文件读不出来，换一个试试。');
      }
    },
    [addLayer, defaults.frame, say],
  );

  const addImageFile = useCallback(
    (targetPage: string, file: File) => addMediaLayer(targetPage, file, 'image'),
    [addMediaLayer],
  );
  const addVideoFile = useCallback(
    (targetPage: string, file: File) => addMediaLayer(targetPage, file, 'video'),
    [addMediaLayer],
  );

  /**
   * **换掉一张图的内容**（双击图片 / 右键「替换图片」）。
   * 用户 2026-09-23：「点击图片可以替换图片」。
   *
   * 与"重新插一张"的区别：位置、框样式、说明文字、层级**全部保留**，只换图源 ——
   * 用户已经把拍立得摆好了角度、写好了那行小字，换张图不该把这些全丢掉。
   * 宽高比按新图更新；但**自由拉过框的（有 h）就不动** —— 那说明他要的就是这个框，
   * 新图用 `object-fit: cover` 填进去（见 LayerView）。
   * 旧的 Blob 记录按引用计数清掉，不留垃圾。
   *
   * ⚠️ 不在替换后 `revokeObjectURL` 旧地址：12 条竖带此刻还可能正引用着它，
   *    一撤销就整页破图。交给 purgeMedia 的引用计数 + 浏览器回收。
   */
  const replaceImageFile = useCallback(
    async (targetPage: string, layerId: string, file: File) => {
      const layer = docRef.current.pages[targetPage]?.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'image') return;
      const url = URL.createObjectURL(file);
      try {
        const { w, h } = await imageSize(url);
        const id = uid('i');
        await putMedia({ id, kind: 'image', name: file.name, blob: file });
        const oldId = layer.mediaId;
        mutatePage(targetPage, (p) => ({
          ...p,
          layers: p.layers.map((l) =>
            l.id === layerId && l.type === 'image' ? { ...l, src: url, mediaId: id, nw: w, nh: h } : l,
          ),
        }));
        if (oldId && oldId !== id) purgeMedia([oldId]);
        say('已换成这张图');
      } catch {
        URL.revokeObjectURL(url);
        say('这张图读不出来，换一张试试。');
      }
    },
    [mutatePage, purgeMedia, say],
  );

  /**
   * 换掉**四格相框里某一格**的图（双击相框的某个窗口，2026-09-23 加）。
   *
   * 用户 2026-09-23：「图片框里没有蓝色的放四个图片的」——素材库那张"四格相框"
   * 是贴纸插画放不了照片，所以新增 `frame:'quad'`：2×2 四个窗口各自存图。
   * `index` 0..3 = 左上/右上/左下/右下。与"换整张图"的区别：
   *   · 位置、框样式、主图 src、**其它三格**全部保留；
   *   · 只写 `quadCells[index]`，被替换那一格的旧媒体记录按引用计数清掉。
   */
  const replaceQuadCell = useCallback(
    async (targetPage: string, layerId: string, file: File, index: number) => {
      if (index < 0 || index > 3) return;
      const layer = docRef.current.pages[targetPage]?.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'image') return;
      const url = URL.createObjectURL(file);
      try {
        await imageSize(url);
        const id = uid('i');
        await putMedia({ id, kind: 'image', name: file.name, blob: file });
        const oldId = layer.quadCells?.[index]?.mediaId;
        mutatePage(targetPage, (p) => ({
          ...p,
          layers: p.layers.map((l) => {
            if (l.id !== layerId || l.type !== 'image') return l;
            const cells = (l.quadCells ?? [null, null, null, null]).slice(0, 4);
            while (cells.length < 4) cells.push(null);
            cells[index] = { src: url, mediaId: id };
            /* 主图的 nw/nh 与 crop 都不动：四格尺寸由框自己决定（整框强制正方形，
               见 layout.displayAspect 特判），覆盖元数据会连累"切回别的框样式"的显示。 */
            return { ...l, quadCells: cells };
          }),
        }));
        if (oldId && oldId !== id) purgeMedia([oldId]);
        say(`已换成${['左上', '右上', '左下', '右下'][index]}那一格`);
      } catch {
        URL.revokeObjectURL(url);
        say('这张图读不出来，换一张试试。');
      }
    },
    [mutatePage, purgeMedia, say],
  );

  const elImgOf = useCallback(
    (pid: string, elId: string) => doc.pages[pid]?.imgs?.[elId],
    [doc],
  );

  /**
   * 换掉**结构元素里**的图片（双击相框里的照片 / 右键「替换图片」）。
   *
   * 用户 2026-09-23：「双击相框里的图片可以替换图片」。
   * 页面自带的照片（拍立得里的 `<img>`、贴纸 `<img>`）是代码版式的一部分，
   * 不能从版式里摘出来，所以只在这个元素下记一条"换过图了"（见 ElImage），
   * 渲染时由 PageEl 把它写到元素内第一个 `<img>` 的 src 上。
   *
   * ⚠️ 不动 `els` 里的位置/尺寸/旋转 —— 用户只是换图，框该怎么放还怎么放。
   */
  const replaceElImage = useCallback(
    async (targetPage: string, elId: string, file: File) => {
      const url = URL.createObjectURL(file);
      try {
        const { w, h } = await imageSize(url);
        const id = uid('i');
        await putMedia({ id, kind: 'image', name: file.name, blob: file });
        const oldId = docRef.current.pages[targetPage]?.imgs?.[elId]?.mediaId;
        mutatePage(targetPage, (p) => ({
          ...p,
          imgs: { ...(p.imgs ?? {}), [elId]: { mediaId: id, src: url, nw: w, nh: h } },
        }));
        if (oldId && oldId !== id) purgeMedia([oldId]);
        say('已换成这张图');
      } catch {
        URL.revokeObjectURL(url);
        say('这张图读不出来，换一张试试。');
      }
    },
    [mutatePage, purgeMedia, say],
  );

  /* ---------------- 页管理 ---------------- */
  const addPageAfter = useCallback(
    (afterId: string) => {
      const id = newExtraId(docRef.current);
      mutate((d) => {
        /* ⚠️ 编辑操作用 userOrder（不自动补封底），否则会把补进去的 `back`
           写进用户存档，再也退不回"用户没改过页序"的状态。 */
        const order = userOrder(d);
        const i = order.indexOf(afterId);
        const next = [...order];
        next.splice(i < 0 ? order.length : i + 1, 0, id);
        return { ...d, order: next, extraPages: [...d.extraPages, id] };
      });
      say('已插入一张空白页');
      return id;
    },
    [mutate, say],
  );

  const removePage = useCallback(
    (id: string) => {
      if (isProtectedPage(id)) {
        say('封面是结构页，删页时自动跳过。');
        return false;
      }
      mutate((d) => {
        const order = userOrder(d);
        if (!order.includes(id)) return d;
        return { ...d, order: order.filter((x) => x !== id) };
      });
      say('已移出页序（内容保留，可随时恢复）');
      return true;
    },
    [mutate, say],
  );

  const restorePage = useCallback(
    (id: string) => {
      mutate((d) => {
        const order = userOrder(d);
        if (order.includes(id)) return d;
        /* 恢复位置：代码页按代码顺序插回去，空白页放最后 */
        const base = userOrder({ ...d, order: [] });
        const bi = base.indexOf(id);
        const next = [...order];
        if (bi < 0) next.push(id);
        else {
          let at = next.length;
          for (let i = 0; i < next.length; i++) {
            const oi = base.indexOf(next[i]);
            if (oi > bi) {
              at = i;
              break;
            }
          }
          next.splice(at, 0, id);
        }
        return { ...d, order: next };
      });
      say('已恢复该页');
    },
    [mutate, say],
  );

  const resetPage = useCallback(
    (targetPage: string) => {
      mutate((d) => {
        const pages = { ...d.pages };
        delete pages[targetPage];
        return { ...d, pages };
      });
      setSelectionState([]);
      say('已恢复本页的原始内容');
    },
    [mutate, say],
  );

  /* ---------------- 撤销 / 重做 ---------------- */

  /** 撤销/重做后选区里可能有已经不存在的对象，剪一下（否则手柄会挂着一个空 id） */
  const pruneSelection = useCallback(() => {
    const page = docRef.current.pages[pageId];
    setSelectionState((cur) =>
      cur.filter((r) => {
        if (r.kind === 'layer') return !!page?.layers.some((l) => l.id === r.id);
        return !!bridge.current?.elBoxes[r.id];
      }),
    );
  }, [pageId]);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) {
      say('没有可撤销的改动了');
      return;
    }
    redoRef.current.push(docRef.current);
    if (redoRef.current.length > 80) redoRef.current.shift();
    coalesceRef.current = { key: null, at: 0 };
    docRef.current = prev;
    setDoc(prev);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    pruneSelection();
  }, [pruneSelection, say]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) {
      say('没有可重做的改动了');
      return;
    }
    historyRef.current.push(docRef.current);
    coalesceRef.current = { key: null, at: 0 };
    docRef.current = next;
    setDoc(next);
    setCanRedo(redoRef.current.length > 0);
    setCanUndo(true);
    pruneSelection();
  }, [pruneSelection, say]);

  /* ---------------- 外部状态 ---------------- */

  const setEditing = useCallback((v: boolean) => {
    setEditingState(v);
    if (!v) setSelectionState([]);
  }, []);

  const setDefaults = useCallback((patch: Partial<LayerDefaults>) => {
    setDefaultsState((cur) => {
      const next = { ...cur, ...patch };
      writeDefaults(next);
      return next;
    });
  }, []);

  const flushSave = useCallback(() => {
    void saverRef.current!.flush();
  }, []);

  /* ---------------- 快捷键：与 PowerPoint 对齐 ---------------- */

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const low = key.length === 1 ? key.toLowerCase() : key;
      /** 当前要操作的对象集合（组会自动展开） */
      const refs = () => expandRefs(pageId, selRef.current);
      const blurTyping = () => {
        const cur = document.activeElement as HTMLElement | null;
        if (cur && cur.isContentEditable) cur.blur();
      };

      if (key === 'Escape') {
        if (typing) return; /* 正在改字：Esc 交给 EditableText 自己 blur */
        setSelectionState([]);
        return;
      }

      if (mod) {
        switch (low) {
          case 'z': {
            e.preventDefault();
            /* 撤销前先让正在编辑的文字节点失焦 —— EditableText 在聚焦时不写 DOM，
               不失焦的话撤销回去的文字要等下次失焦才显示出来。 */
            blurTyping();
            if (e.shiftKey) redo();
            else undo();
            return;
          }
          case 'y':
            e.preventDefault();
            blurTyping();
            redo();
            return;
          case 'c':
            if (typing) return;
            if (copySelection()) e.preventDefault();
            return;
          case 'x':
            if (typing) return;
            if (copySelection()) {
              e.preventDefault();
              deleteSelection();
            }
            return;
          case 'v':
            if (typing) return;
            if (pasteClipboard(pageId)) e.preventDefault();
            return;
          case 'd':
            if (typing) return;
            e.preventDefault();
            if (!duplicateSelection()) say('先选中要再制的对象');
            return;
          case 'a':
            if (typing) return;
            e.preventDefault();
            selectAllOnPage();
            return;
          case 'g':
            if (typing) return;
            e.preventDefault();
            if (e.shiftKey) ungroupSelection();
            else groupSelection();
            return;
          case ']':
            if (typing) return;
            e.preventDefault();
            orderRefs(pageId, refs(), e.shiftKey ? 'front' : 'up');
            return;
          case '[':
            if (typing) return;
            e.preventDefault();
            orderRefs(pageId, refs(), e.shiftKey ? 'back' : 'down');
            return;
          case 'e':
            if (typing) return;
            e.preventDefault();
            alignRefs(pageId, refs(), e.shiftKey ? 'vcenter' : 'hcenter');
            return;
          case 's':
            e.preventDefault();
            flushSave();
            say('已保存到本机');
            return;
          default:
            return;
        }
      }

      if (key === 'Delete' || key === 'Backspace') {
        if (typing || !selRef.current.length) return;
        e.preventDefault();
        deleteSelection();
        return;
      }
      /* F2 / Enter = 进入文字编辑（PPT 同款）；再按 Esc 退出 */
      if (key === 'F2' || (key === 'Enter' && !typing)) {
        if (!selRef.current.length) return;
        e.preventDefault();
        editSelectedText();
        return;
      }
      if (key === 'Tab') {
        e.preventDefault();
        cycleSelection(e.shiftKey ? -1 : 1);
        return;
      }
      if (key.startsWith('Arrow')) {
        if (typing || !selRef.current.length) return;
        e.preventDefault();
        /* 方向键微移；按住 Shift 走大步（PPT 的手感） */
        const stepX = e.shiftKey ? 0.02 : 0.002;
        const stepY = e.shiftKey ? 0.02 : 0.002;
        const dx = key === 'ArrowLeft' ? -stepX : key === 'ArrowRight' ? stepX : 0;
        const dy = key === 'ArrowUp' ? -stepY : key === 'ArrowDown' ? stepY : 0;
        moveRefs(pageId, refs(), dx, dy, 'nudge');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    editing,
    undo,
    redo,
    copySelection,
    pasteClipboard,
    duplicateSelection,
    deleteSelection,
    selectAllOnPage,
    groupSelection,
    ungroupSelection,
    orderRefs,
    alignRefs,
    editSelectedText,
    cycleSelection,
    moveRefs,
    expandRefs,
    pageId,
    flushSave,
    say,
  ]);

  /* 系统剪贴板里的图片文件 → 直接贴成图层（用户新加要求「可以复制粘贴」） */
  useEffect(() => {
    if (!editing) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.isContentEditable) return; /* 粘贴文字时别抢 */
      const items = Array.from(e.clipboardData?.items ?? []);
      const file = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'))?.getAsFile();
      if (file) {
        e.preventDefault();
        void addImageFile(pageId, file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [editing, addImageFile, pageId]);

  const value = useMemo<DiaryEditorApi>(
    () => ({
      ready,
      editing,
      setEditing,
      pageId,
      pageIndex: safeIndex,
      setPageIndex,
      pageOrder: order,
      total,
      order,
      removed,
      getText,
      setText,
      paperOf,
      setPaper,
      layersOf,
      addLayer,
      updateLayer,
      removeLayer,
      selected,
      sel,
      setSel,
      selEl,
      elOf,
      elsOf,
      updateEl,
      updateElText,
      updateElSlotText,
      selection,
      setSelection,
      selectRef,
      isSelected,
      expandRefs,
      groupsOf,
      groupOf,
      groupSelection,
      ungroupSelection,
      moveRefs,
      scaleRefs,
      rotateRefs,
      orderRefs,
      alignRefs,
      zRankOf,
      copySelection,
      cutSelection,
      duplicateSelection,
      pasteClipboard,
      deleteSelection,
      resetElTransform,
      selectAllOnPage,
      cycleSelection,
      editSelectedText,
      addSticker,
      addImageFile,
      addVideoFile,
      replaceImageFile,
      replaceQuadCell,
      elImgOf,
      replaceElImage,
      addPageAfter,
      removePage,
      restorePage,
      resetPage,
      defaults,
      setDefaults,
      undo,
      redo,
      canUndo,
      canRedo,
      flushSave,
      saveState,
      hint,
      say,
      bridge,
    }),
    [
      ready, editing, setEditing, pageId, safeIndex, setPageIndex, order, total, removed, getText,
      setText, paperOf, setPaper, layersOf, addLayer, updateLayer, removeLayer, selected, sel,
      setSel, selEl, elOf, elsOf, updateEl, updateElText, updateElSlotText, selection, setSelection, selectRef, isSelected, expandRefs,
      groupsOf, groupOf, groupSelection, ungroupSelection, moveRefs, scaleRefs, rotateRefs,
      orderRefs, alignRefs, zRankOf, copySelection, cutSelection, duplicateSelection, pasteClipboard,
      deleteSelection, resetElTransform,
      selectAllOnPage, cycleSelection, editSelectedText, addSticker, addImageFile, addVideoFile,
      replaceImageFile, replaceQuadCell, elImgOf, replaceElImage,
      addPageAfter, removePage, restorePage, resetPage, defaults, setDefaults, undo, redo, canUndo,
      canRedo, flushSave, saveState, hint, say,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 给需要"新建图层默认值"的地方用的纯函数：把 defaults 变成图层初始样式字段 */
export function styleFromDefaults(kind: 'image' | 'video' | 'text', d: LayerDefaults) {
  if (kind === 'text') return { font: d.font, size: d.size, color: d.color, box: d.box, align: d.align };
  return { frame: d.frame };
}

/** 裁切比例的对外门面（LayerView 的裁切手柄用） */
export { clampCrop };
