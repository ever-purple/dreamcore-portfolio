import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '@/lib/escape-stack';

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
 * 2. **Esc 走全站统一的 Esc 栈**（2026-09-16 第一档改造 ③）。旧写法是自己用
 *    capture 阶段 + stopPropagation 抢在 AboutOverlay 前面 —— 因为那时所有浮层
 *    都是在 window 上各挂各的 bubble 监听，"谁先跑"得靠自己造。现在栈本身就保证
 *    一次按键只命中栈顶（预览是后开的，天然在 About 之上），这段 hack 可以退休了。
 */
export function InspLightbox({ item, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  /* Esc = 关预览（只在预览真的开着时入栈） */
  useEscape(onClose, item !== null);

  /* 打开后把焦点挪进浮层（键盘可达性） */
  useEffect(() => {
    if (!item) return;
    closeRef.current?.focus();
  }, [item]);

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
