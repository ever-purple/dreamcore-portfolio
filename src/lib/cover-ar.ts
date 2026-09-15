import type { SyntheticEvent } from 'react';

/**
 * img.onLoad 时把图片自然宽高比写到指定目标元素的 inline `aspect-ratio` 上。
 * 让容器跟着图片走 —— 任意比例的封面都能"完整且铺满"（不裁、不留白）。
 *
 * 用法：
 *   <img onLoad={coverAr('.ww-cover')} ... />           ← 写到最近的 .ww-cover 祖先
 *   <img onLoad={coverAr('.wkp-hero')} ... />          ← 写到最近的 .wkp-hero 祖先
 *   <img onLoad={coverAr('self')} ... />               ← 写到 img 自身
 *
 * 在 verify-covers.mjs 里也用：DOM 内联 `aspect-ratio: 2880/2160` 之类的值，
 * 是「完整且铺满」最直接的证据（不是 cover 不是 contain，而是**窗口比例 = 图片比例**）。
 *
 * 注意：写入的是 `aspect-ratio` 这一个 CSS 属性；容器原本的 `width` 不动，
 * `height` 由 `aspect-ratio` 重新派生。所以 CSS 里不能再写死 height（除了 fallback）。
 */
export function coverAr(target: string | 'self') {
  return (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!(w > 0 && h > 0)) return;
    const t = target === 'self'
      ? (e.currentTarget as HTMLElement)
      : e.currentTarget.closest(target);
    if (t instanceof HTMLElement) {
      t.style.setProperty('aspect-ratio', `${w} / ${h}`);
    }
  };
}