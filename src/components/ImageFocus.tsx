import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { EASE } from '@/lib/ease';
import gsap from 'gsap';

export type ImageFocusHandle = {
  /** 走**带动画的**关闭（Esc / 点击都该调它，别直接 setFocus(null)，否则图会瞬间消失） */
  close: () => void;
};

type Props = {
  /** 要放大的图 */
  src: string;
  /** 左下角说明，可省 */
  caption?: string;
  /**
   * 被点的那张缩略图。开合都按它做 FLIP ——
   * 打开时从它的位置/尺寸长到居中全屏，关闭时缩回去。
   * 传 null 就退化成「淡入 + 轻微放大」。
   */
  origin?: HTMLElement | null;
  onClose: () => void;
  ref?: Ref<ImageFocusHandle>;
};

/**
 * 「Focus」结果层：点图片后整屏铺开看大图。
 *
 * 参考录屏里的行为：点 Focus 之后是一个**深色整屏**、图居中、光标始终显示 Close，
 * 点任意处或 Esc 关掉。
 *
 * 这一层是 fixed 定位、盖满视口，所以它天然挡住下面页面的点击；
 * `data-cursor="Close"` 加在整层上 → 光标在这一层里任何地方都显示 Close。
 *
 * ── 2026-09-14 改造：GSAP FLIP 开合（学 gilhuybrecht.com/projects/studio-dado） ──
 * 参考站关闭时是「图淡出 + 溶解回原来的位置」（它用 WebGL plane 做的）。
 * 这里用 DOM FLIP 达到同样的观感：整层 `autoAlpha` 淡出 + 图片按 delta 缩回缩略图原位。
 *
 * ⚠️ 两个坑：
 *  1. 图片盒子在加载出固有尺寸之前是 0×0，`from.width / to.width` 会炸 ——
 *     必须先把图等出来（decode/load）再量。
 *  2. 动画结束后才调 onClose 卸载。中途重复触发要挡（closingRef），
 *     否则 Esc 连按两下会拿到半路的位置、缩到一半就断。
 */
export function ImageFocus({ src, caption, origin, onClose, ref }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const closingRef = useRef(false);
  const tlRef = useRef<ReturnType<typeof gsap.timeline> | null>(null);

  /* ---------- 打开：从缩略图长到居中全屏 ---------- */
  useEffect(() => {
    const root = rootRef.current;
    const img = imgRef.current;
    if (!root || !img) return;

    /* 这一层盖上来之后指针可能还没动过，让光标立刻按新层级重算（显示 Close） */
    window.dispatchEvent(new Event('cursor:refresh'));

    let killed = false;
    const waitReady = new Promise<void>((res) => {
      if (img.complete && img.naturalWidth) {
        res();
        return;
      }
      img.addEventListener('load', () => res(), { once: true });
      img.addEventListener('error', () => res(), { once: true });
    });

    void waitReady.then(() => {
      if (killed || closingRef.current) return;
      const to = img.getBoundingClientRect();   // 居中后的最终位置（此时还没有 transform）
      const from = origin?.isConnected ? origin.getBoundingClientRect() : null;

      gsap.set(root, { autoAlpha: 0 });
      const tl = gsap.timeline();
      tlRef.current = tl;
      tl.to(root, { autoAlpha: 1, duration: 0.26, ease: EASE.world }, 0);

      if (from && from.width > 1 && to.width > 1) {
        /* FLIP：把图挪到缩略图的中心、缩到缩略图的宽度，再回到自身的位置与 scale 1。
           源图与缩略图都是 4:3，等比缩放能对上。 */
        const s = from.width / to.width;
        gsap.set(img, {
          x: from.left + from.width / 2 - (to.left + to.width / 2),
          y: from.top + from.height / 2 - (to.top + to.height / 2),
          scale: s,
        });
        tl.to(img, { x: 0, y: 0, scale: 1, duration: 0.54, ease: EASE.world }, 0);
      } else {
        gsap.set(img, { scale: 0.94 });
        tl.to(img, { scale: 1, duration: 0.46, ease: EASE.world }, 0);
      }
    });

    return () => {
      killed = true;
      tlRef.current?.kill();
      tlRef.current = null;
    };
  }, [src, origin]);

  /* ---------- 关闭：缩回原缩略图 + 整层淡出 ---------- */
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;

    const root = rootRef.current;
    const img = imgRef.current;
    tlRef.current?.kill();
    tlRef.current = null;
    if (!root || !img) {
      onClose();
      return;
    }

    const tl = gsap.timeline({ onComplete: onClose });
    tl.to(root, { autoAlpha: 0, duration: 0.34, ease: EASE.in }, 0);

    const from = origin?.isConnected ? origin.getBoundingClientRect() : null;
    const now = img.getBoundingClientRect();   // 当前实际位置（可能还在打开动画中途）
    if (from && from.width > 1 && now.width > 1) {
      const s = from.width / now.width;
      tl.to(
        img,
        {
          x: from.left + from.width / 2 - (now.left + now.width / 2),
          y: from.top + from.height / 2 - (now.top + now.height / 2),
          scale: s,
          transformOrigin: '50% 50%',
          duration: 0.46,
          ease: EASE.io,
        },
        0,
      );
    }
  }, [onClose, origin]);

  useImperativeHandle(ref, () => ({ close }), [close]);

  return (
    <div
      className="wkf"
      role="dialog"
      aria-modal="true"
      aria-label="查看大图"
      data-cursor="Close"
      data-cursor-tone="dark"
      ref={rootRef}
      onClick={close}
    >
      <img className="wkf-img" ref={imgRef} src={src} alt={caption ?? ''} draggable={false} />
      {caption ? <p className="wkf-cap">{caption}</p> : null}
      <p className="wkf-hint">点击任意处或按 Esc 关闭</p>
    </div>
  );
}

export default ImageFocus;
