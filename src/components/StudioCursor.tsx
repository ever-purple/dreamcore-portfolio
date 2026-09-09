import { useEffect, useRef, useState } from 'react';

/** 默认：张开的手（可探索） */
function HandOpen() {
  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
      <g
        fill="#f3e9d2"
        stroke="#2b0a0c"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
        <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v6" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </g>
    </svg>
  );
}

/** 悬停感应区：食指指点（可点击），标准 lucide pointer 路径 */
function HandPoint() {
  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
      <g
        fill="#f3e9d2"
        stroke="#2b0a0c"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 14a8 8 0 0 1-8 8" />
        <path d="M18 11v-1a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
        <path d="M14 10V9a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1" />
        <path d="M10 9.5V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v10" />
        <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </g>
    </svg>
  );
}

/**
 * Studio 自定义光标：奶白色手型跟随鼠标（轻微阻尼），
 * 悬停在物件感应区 / 可点元素上时切换为指点手势。
 * 仅精确指针设备（鼠标）启用，触屏不渲染。
 */
export function StudioCursor({ pointing }: { pointing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled] = useState(
    () => window.matchMedia('(pointer: fine)').matches,
  );

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 2;
    let cx = tx;
    let cy = ty;
    let visible = false;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!visible) {
        visible = true;
        el.style.opacity = '1';
      }
    };
    const onLeave = () => {
      visible = false;
      el.style.opacity = '0';
    };

    const tick = () => {
      cx += (tx - cx) * 0.28;
      cy += (ty - cy) * 0.28;
      el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[60] opacity-0 transition-opacity duration-200"
    >
      <div
        className="transition-transform duration-200"
        style={{
          transform: pointing
            ? 'translate(-33%, -8%) scale(1.1)'
            : 'translate(-30%, -20%) scale(1)',
        }}
      >
        {pointing ? <HandPoint /> : <HandOpen />}
      </div>
    </div>
  );
}
