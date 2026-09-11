import { useMemo } from 'react';

type Sparkle = {
  left: string;
  top: string;
  size: number;
  delay: number;
  duration: number;
  char: string;
};

const GLYPHS = ['✦', '✧', '⋆', '✩'];

type Props = {
  /** 星星数量 */
  count?: number;
  /** 随机种子：同一区域传不同 seed，分布互不重叠 */
  seed?: number;
  className?: string;
};

/**
 * 一闪一闪的小星星（neocities 复古闪粉）：
 * 绝对定位铺满父容器（父需 position:relative），纯 CSS 动画，pointer-events 穿透。
 */
export function Sparkles({ count = 8, seed = 1, className = '' }: Props) {
  const sparkles = useMemo<Sparkle[]>(() => {
    let s = seed >>> 0 || 1;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: count }, () => ({
      left: `${(rand() * 92 + 3).toFixed(1)}%`,
      top: `${(rand() * 82 + 6).toFixed(1)}%`,
      size: 10 + Math.round(rand() * 9),
      delay: +(rand() * 3.4).toFixed(2),
      duration: +(1.7 + rand() * 2.1).toFixed(2),
      char: GLYPHS[Math.floor(rand() * GLYPHS.length)],
    }));
  }, [count, seed]);

  return (
    <span className={`about-sparkles ${className}`.trim()} aria-hidden="true">
      {sparkles.map((sp, i) => (
        <i
          key={i}
          style={{
            left: sp.left,
            top: sp.top,
            fontSize: sp.size,
            animationDelay: `${sp.delay}s`,
            animationDuration: `${sp.duration}s`,
          }}
        >
          {sp.char}
        </i>
      ))}
    </span>
  );
}
