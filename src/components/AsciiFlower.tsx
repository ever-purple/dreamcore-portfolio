import { ASCII_FLOWER } from '@/components/flowerAsciiArt';

type Props = {
  /** 定位用的修饰类，见 index.css 的 `.ascii-flower--menu` / `--sheet` */
  className?: string;
  /** 覆盖浓度（默认由 CSS 给） */
  opacity?: number;
};

/**
 * 牵牛花字符画（装饰层）。
 *
 * 为什么是**真字符**而不是 SVG 遮罩：用户给的参考图里，花的轮廓是靠
 * `#%*+=-:.` 这一档字符的**密度**堆出来的（他批注"转字符""加颜色"）——
 * 一旦转成遮罩就只剩实心块，字感的颗粒全丢了。
 *
 * 所以这里排真字：等宽字体 + `white-space: pre`，颜色由 `--pal-mint` 给，
 * 浓度压到 0.1x —— 它是纸的肌理，不是主体，绝不能跟正文抢。
 * 交互上完全不参与：`pointer-events: none` + `aria-hidden`。
 */
export function AsciiFlower({ className, opacity }: Props) {
  return (
    <pre
      className={`ascii-flower${className ? ' ' + className : ''}`}
      style={opacity !== undefined ? ({ '--flower-op': opacity } as React.CSSProperties) : undefined}
      aria-hidden="true"
    >
      {ASCII_FLOWER}
    </pre>
  );
}
