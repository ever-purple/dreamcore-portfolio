/**
 * 全站动效策略（单一开关，2026-09-16）
 * ---------------------------------------------------------------------------
 * 背景：作者本人机器的 Windows「动画效果」是**关的**，Chromium 据此全量上报
 * `prefers-reduced-motion: reduce`。尊重它的后果是作者自己永远看不到做好的动效
 * （Lenis 不起 → 原生阶梯滚动＝卡顿、视差全灭、CSS 过渡清零＝入场瞬切）。
 * 作者明确要求：「关着的情况下也拿满效果」。
 *
 * 所以这里统一**忽略** reduce —— 全站（详情页视差、木马场景、报刊亭、媒体画廊、
 * Ascii 自画像、宠物、镜片背景…）都走完整动效。
 *
 * ⚠️ 这是有意的取舍，不是漏写：
 *   · 想恢复无障碍合规 → 把 FORCE_FULL_MOTION 改成 false 即可（JS 与 CSS 同步生效）；
 *   · CSS 那边的降级块在 index.css 里被改成"永不成立的媒体查询"，
 *     搜 `FORCE_FULL_MOTION` 就能找到（`@media (prefers-reduced-motion: reduce) and (min-width: 100000px)`）。
 *
 * 约定：**任何地方要判断"是否减少动效"，都调 prefersReduced()**，
 * 不要再直接写 matchMedia —— 否则开关会漏掉那一处。
 */
export const FORCE_FULL_MOTION = true;

/** 是否按"减少动效"降级。开关打开时恒为 false。 */
export function prefersReduced(): boolean {
  if (FORCE_FULL_MOTION) return false;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
