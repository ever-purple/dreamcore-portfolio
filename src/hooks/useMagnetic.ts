import { useEffect, useRef } from 'react';
import gsap from 'gsap';

interface MagneticOptions {
  /** 触发半径（px），默认 160 —— 鼠标进入该范围元素被吸向指针 */
  radius?: number;
  /** 吸附强度：位移 = 偏移 × strength，默认 0.35 */
  strength?: number;
  durationIn?: number;
  durationOut?: number;
}

/**
 * 磁吸交互：鼠标靠近/悬停元素时，元素被轻轻吸向指针；离开归位。
 * 仅精确指针（鼠标）启用，触屏不吸。返回 ref 直接挂到目标元素上。
 */
export function useMagnetic<T extends HTMLElement = HTMLButtonElement>(
  options: MagneticOptions = {},
) {
  const ref = useRef<T>(null);
  const { radius = 160, strength = 0.35, durationIn = 0.4, durationOut = 0.5 } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist < radius) {
        gsap.to(el, {
          x: dx * strength,
          y: dy * strength,
          duration: durationIn,
          ease: 'power2.out',
          overwrite: 'auto',
        });
      } else {
        gsap.to(el, { x: 0, y: 0, duration: durationOut, ease: 'power2.out', overwrite: 'auto' });
      }
    };
    const onLeave = () =>
      gsap.to(el, { x: 0, y: 0, duration: durationOut, ease: 'power2.out', overwrite: 'auto' });

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      gsap.killTweensOf(el);
    };
  }, [radius, strength, durationIn, durationOut]);

  return ref;
}
