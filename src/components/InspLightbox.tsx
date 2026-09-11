import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type LightboxItem = {
  src: string;
  title: string;
  code: string;
  link?: string;
};

type Props = {
  item: LightboxItem | null;
  onClose: () => void;
};

/**
 * 大图预览浮层。
 *
 * 两个必须这么写的点：
 *
 * 1. **用 portal 挂到 body**。`.about-overlay` 在入场过渡里 opacity 从 0 → 1，
 *    opacity < 1 的元素会给自己造出包含块，且 260 的层叠上下文会把 fixed 子元素锁在里面。
 *    挂到 body 就完全绕开这两个坑。z-index 取 9990 —— 刻意压在 9999 的胶片颗粒层下面，
 *    这样颗粒依然盖在预览图上，和站内其它浮层的观感一致。
 *
 * 2. **Esc 必须用 capture 抢在 AboutOverlay 前面**。AboutOverlay 在 window 上挂了
 *    bubble 阶段的 Esc → onClose()，如果这里也用默认阶段，按一下 Esc 会把预览和整个
 *    About 页一起关掉。所以这里用 capture 监听 + stopPropagation 把事件吃掉。
 */
export function InspLightbox({ item, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [item, onClose]);

  if (!item) return null;

  return createPortal(
    <div
      className="about-insp-lb"
      role="dialog"
      aria-modal="true"
      aria-label={`大图预览：${item.title}`}
      data-lenis-prevent
      onClick={(e) => {
        // 只有点背景本身才关；点图、点标题都不关
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <figure className="about-insp-lb-fig">
        <img className="about-insp-lb-img" src={item.src} alt={item.title} />
        <figcaption className="about-insp-lb-cap">
          <span className="about-insp-lb-code">[{item.code}]</span>
          <span className="about-insp-lb-title">{item.title}</span>
          {item.link ? (
            <a
              className="about-insp-lb-link"
              href={item.link}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
            >
              打开原链接 ↗
            </a>
          ) : null}
        </figcaption>
      </figure>

      <button
        ref={closeRef}
        type="button"
        className="about-insp-lb-close"
        onClick={onClose}
        aria-label="关闭大图预览"
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}
