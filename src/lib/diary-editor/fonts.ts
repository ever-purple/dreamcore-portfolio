/**
 * 手账编辑器 —— 字体注册表
 * =============================================================================
 * 用户口径（2026-09-23）：
 *   「[字体] 下拉提供十二种（含默认字体）：手写体 Caveat、钢笔字 Nanum PenScript、
 *     像素风 Press Start 2P、优雅花体 Dancing Script、随性手写 Kalam、印刷手写
 *     Patrick Hand、童趣 Indie Flower、马克笔 Permanent Marker、中文毛笔 MaShan Zheng、
 *     中文行书 Zhi Mang Xing、中文 Long Cang、中文衬线（思源宋体 Noto Serif SC）」
 *   「另外，也要加上现在使用的文字，放在最前面，选择字体时首选这个。」
 *
 * → 所以清单是：**站点当前在用的字体排最前**（默认选中），后面才是那 11 个外来字体。
 *   `default` 就是"本页正文"那套栈，选它 = 跟页面原本的字一模一样，这是首选。
 *
 * ## 懒加载（重要）
 * 三个中文手写体（Ma Shan Zheng / Zhi Mang Xing / Long Cang）每个 ~2–2.7MB，
 * PF 胡涂体全量 TTF 有 5MB —— 一进页面就全加载 = 十几 MB 首屏，不可接受。
 * 所以：**字体文件不在 index.html / index.css 里声明**，而是用户第一次选到它时，
 * 用 CSS Font Loading API 现场 `new FontFace(...).load()` 挂上去（见 `ensureFont`）。
 * 选不到就永远不会下载。
 */

export type EditorFont = {
  id: string;
  /** 中文名（下拉里显示） */
  label: string;
  /** CSS font-family 值（可含兜底栈） */
  family: string;
  /**
   * 需要懒加载的字体文件 URL。
   * 不填 = 站点已经全局加载过（如 NanoOldSongA / Noto Serif SC），或纯系统字体。
   */
  file?: string;
  /** 是不是中文字体（下拉里分组用） */
  cjk?: boolean;
  /**
   * **中文兜底**：本字体不含汉字（拉丁字体）时，汉字落到哪个字体上。
   *
   * 用户 2026-09-23：「很多字体都是没用过的……用不了的」「文字颜色改了以后会变成
   * 粗体，粗体还退不回去」。用 fontTools 解开 woff2 的 cmap 实测：Caveat / Dancing /
   * Kalam / Marker 这些**一个汉字字形都没有** —— 用户写中文日记选它们，中文按
   * font-family 的回退规则掉到浏览器默认字体（黑体，视觉上"变粗"），看起来就是
   * "选了没反应 / 字变粗还回不去"。
   *
   * 修复：family 栈里显式补一个中文手写体（胡涂体）—— 选英文书法后汉字变成
   * 好看的手写体而不是系统黑体；下拉分组也注明"英文·数字"。ensureFont 会把它
   * 连带加载（见本文件底部）。
   */
  cjkFallback?: string;
};

/**
 * ⚠️ 顺序即优先级：第一项是「默认」也是**新建文字贴纸的初始字体**，
 *    用户明确要求「现在使用的文字放在最前面，选择字体时首选这个」。
 *
 * 拉丁字体（Caveat / Dancing / Kalam…）的 family 栈第二位统一补 `'PF频凡胡涂体'`：
 * cmap 实测它们没有汉字字形，用户写中文选了它们 → 汉字掉到系统黑体
 * （视觉"变粗/没反应"）。补上兜底后汉字变成胡涂体手写，英文数字用原字体。
 */
export const EDITOR_FONTS: EditorFont[] = [
  { id: 'default', label: '默认（本页正文）', family: "'Inter', 'Noto Sans SC', system-ui, sans-serif" },
  { id: 'pflutu', label: '中文手写 · 胡涂体（本站在用）', family: "'PF频凡胡涂体', 'STXingkai', 'KaiTi', cursive", file: '/fonts/PFHuTu.ttf', cjk: true },
  { id: 'nano', label: '中文宋体 · 标题（本站在用）', family: "'NanoOldSongA', 'Noto Serif SC', 'Songti SC', serif", cjk: true },
  { id: 'caveat', label: '手写 · Caveat（英文·数字）', family: "'Caveat', 'PF频凡胡涂体', cursive", file: '/fonts/Caveat-var.woff2', cjkFallback: 'pflutu' },
  { id: 'nanum-pen', label: '钢笔 · Nanum Pen（英文·数字）', family: "'Nanum Pen Script', 'PF频凡胡涂体', cursive", file: '/fonts/editor/nanum-pen-script.woff2', cjkFallback: 'pflutu' },
  { id: 'press-start', label: '像素 · Press Start 2P（英文·数字）', family: "'Press Start 2P', 'PF频凡胡涂体', monospace", file: '/fonts/editor/press-start-2p.woff2', cjkFallback: 'pflutu' },
  { id: 'dancing', label: '花体 · Dancing Script（英文·数字）', family: "'Dancing Script', 'PF频凡胡涂体', cursive", file: '/fonts/editor/dancing-script.woff2', cjkFallback: 'pflutu' },
  { id: 'kalam', label: '随性手写 · Kalam（英文·数字）', family: "'Kalam', 'PF频凡胡涂体', cursive", file: '/fonts/editor/kalam.woff2', cjkFallback: 'pflutu' },
  { id: 'patrick', label: '印刷手写 · Patrick Hand（英文·数字）', family: "'Patrick Hand', 'PF频凡胡涂体', cursive", file: '/fonts/editor/patrick-hand.woff2', cjkFallback: 'pflutu' },
  { id: 'indie', label: '童趣 · Indie Flower（英文·数字）', family: "'Indie Flower', 'PF频凡胡涂体', cursive", file: '/fonts/editor/indie-flower.woff2', cjkFallback: 'pflutu' },
  { id: 'marker', label: '马克笔 · Permanent Marker（英文·数字）', family: "'Permanent Marker', 'PF频凡胡涂体', cursive", file: '/fonts/editor/permanent-marker.woff2', cjkFallback: 'pflutu' },
  { id: 'mashan', label: '中文毛笔 · Ma Shan Zheng', family: "'Ma Shan Zheng', 'STKaiti', cursive", file: '/fonts/editor/ma-shan-zheng.woff2', cjk: true },
  { id: 'zhimang', label: '中文行书 · Zhi Mang Xing', family: "'Zhi Mang Xing', 'STXingkai', cursive", file: '/fonts/editor/zhi-mang-xing.woff2', cjk: true },
  { id: 'longcang', label: '中文 · Long Cang', family: "'Long Cang', 'STKaiti', cursive", file: '/fonts/editor/long-cang.woff2', cjk: true },
  { id: 'noto-serif', label: '中文衬线 · 思源宋体', family: "'Noto Serif SC', 'Songti SC', serif", cjk: true },
];

export const FONT_BY_ID = new Map(EDITOR_FONTS.map((f) => [f.id, f]));

/** 取字体 id 的 CSS family 值；未知 id 回退到「默认」。 */
export function familyOf(id: string): string {
  return (FONT_BY_ID.get(id) ?? EDITOR_FONTS[0]).family;
}

/** 字体中文名（HUD / 提示用） */
export function labelOf(id: string): string {
  return (FONT_BY_ID.get(id) ?? EDITOR_FONTS[0]).label;
}

/** family 栈里第 n 个名字（去引号、统一小写），用于比对 */
function nthFamily(family: string, i: number): string {
  const parts = family.split(',');
  return (parts[i] ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
}

/**
 * 把 `getComputedStyle().fontFamily` **反查**回字体 id。
 *
 * 用途：用户 2026-09-23 要求「选中文字…字体字号颜色样式也会在下方显示出来」——
 * 页面自带的标题/正文用的是代码里的字体栈，要在工具栏的"字体"下拉里**如实地**
 * 显示它现在是什么字体，就得反查。
 *
 * 算法：computed fontFamily 返回的是**声明的那个栈**（不是实际命中的字面），
 * 所以按"栈内顺序优先"逐个名字在所有注册字体里找第一个命中者 ——
 * 例如正文声明的是 `'PF频凡胡涂体', 'STXingkai', 'KaiTi', cursive`，
 * 第一项就命中了 `pflutu`，于是下拉会显示「中文手写 · 胡涂体（本站在用）」。
 *
 * 一个都匹配不上返回 null（工具栏据此显示"页面自定义字体"而不乱指一个）。
 */
export function fontIdFromFamily(computed: string): string | null {
  if (!computed) return null;
  const depth = computed.split(',').length;
  for (let i = 0; i < depth; i++) {
    const name = nthFamily(computed, i);
    if (!name) continue;
    /* generic family（serif / cursive / monospace…）不代表具体字体，跳过 */
    const hit = EDITOR_FONTS.find((f) => nthFamily(f.family, 0) === name);
    if (hit) return hit.id;
  }
  return null;
}

const loaded = new Set<string>();

/**
 * 懒加载一个字体（幂等）。返回 Promise 以便调用方在字体就绪后重新量尺寸。
 * ⚠️ 失败要**把 loaded 里的标记撤掉**，否则一次网络抖动会让这个字体永久加载不了。
 * ⚠️ 拉丁字体（cjkFallback）会**连带加载中文兜底** —— family 栈第二位就是它，
 *    不预载的话第一个汉字闪现时会先掉到系统字体再跳变。
 */
export async function ensureFont(id: string): Promise<void> {
  const f = FONT_BY_ID.get(id);
  if (f?.cjkFallback && f.cjkFallback !== id) void ensureFont(f.cjkFallback);
  if (!f?.file || loaded.has(id)) return;
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  loaded.add(id);
  try {
    /* family 可能写成 'A', 'B', cursive 这样的栈，FontFace 只认第一个名字 */
    const primary = f.family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    const face = new FontFace(primary, `url("${f.file}")`, { style: 'normal', weight: '400', display: 'swap' });
    await face.load();
    (document.fonts as FontFaceSet).add(face);
  } catch {
    loaded.delete(id);
  }
}

/** 预加载一组字体（打开下拉时把常用的几个先备好，减少"选了没反应"的空窗）。 */
export function preloadFonts(ids: string[]): void {
  ids.forEach((id) => void ensureFont(id));
}
