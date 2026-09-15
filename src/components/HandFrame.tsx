import type { ReactNode } from 'react';

type Shape = 'ring' | 'box';

/**
 * 手绘描边（静态版）—— 「跟光标一样」的那两笔。
 *
 * 跟随鼠标的那个手绘圈在 `CursorLabel` 里（`.cur-ring`）。工作室里这些**常驻标签**
 * 需要同一套画法：两笔不闭合、端点故意错开、笔画粗细一致。所以把 path 抽到这里复用。
 *
 * 为什么是 SVG 而不是 `border` / `border-radius`：
 *   手绘感的三个来源 —— ① 线不是完美的圆/矩形；② 两笔之间有**缺口**；
 *   ③ 端点会**画过头**（第二笔的收尾越过第一笔的起笔）。
 *   边框一个都给不了。配 `pathLength=100` 把弧长归一化、`non-scaling-stroke`
 *   保证被拉伸到任意宽高时笔画都不变粗 —— 详见 `.hand__stroke` 的 CSS。
 *
 * 动画：`stroke-dashoffset: 100 → 0`，靠父级 hover 触发（`.studio-zone:hover` /
 * `.studio-pill` 常显）。第二笔延迟 0.16s 起笔，一次画完像描边、错开才像随手圈的。
 */
const PATHS: Record<Shape, [string, string]> = {
  /* 圆圈：与 `.cur-ring` 完全一致的 path —— 用户要的「跟光标一样」。 */
  ring: [
    'M23 64 C5 47 6 16 35 7 C62 -1 106 1 121 17',
    'M121 17 C130 38 120 60 94 66 C70 71 33 70 20 66',
  ],
  /* 方框：第一笔是顶边（右端画过头一点），第二笔从左上角下来 → 底边 → 右边 →
     回到右上角附近收住。四角都是圆角过渡，看着像用笔"蹭"出来的方框。
     ⚠️ 2026-09-15 起**暂时没人用**（工作室里英文的框被用户要求去掉了，只留中文的圆圈）——
     留着是为了下次要「手写方框」时直接 `shape="box"`，不必再对一遍 path。 */
  box: [
    'M7 21 C34 11 96 5 128 14 C133 17 131 22 127 23',
    'M8 22 C3 42 4 60 11 67 C46 73 98 72 125 64 C131 46 130 27 128 16',
  ],
};

type Props = {
  /** ring = 圆圈（手绘椭圆）／ box = 方框 */
  shape: Shape;
  /** 额外的 class（用来挂定位、字号等外层样式） */
  className?: string;
  children: ReactNode;
};

export function HandFrame({ shape, className, children }: Props) {
  const [a, b] = PATHS[shape];
  return (
    <span className={['hand', `hand--${shape}`, className].filter(Boolean).join(' ')}>
      <svg className="hand__s" viewBox="0 0 132 72" preserveAspectRatio="none" aria-hidden="true">
        <path className="hand__stroke" pathLength={100} d={a} />
        <path className="hand__stroke" pathLength={100} d={b} />
      </svg>
      <span className="hand__txt">{children}</span>
    </span>
  );
}

export default HandFrame;
