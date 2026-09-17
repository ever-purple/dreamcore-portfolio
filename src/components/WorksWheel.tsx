import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type Ref,
} from 'react';
import gsap from 'gsap';
import { EASE } from '@/lib/ease';
import type { ProjectState } from '@/data/works';
import { coverAr } from '@/lib/cover-ar';

/* ==================================================================
   1. 弧线几何（空间感）—— 三项缺一不可
   ------------------------------------------------------------------
   每一项都落在一个「竖向的圆」上，圆心在镜头后方：
       y = sin(θ) * R_Y       → 竖直位移（决定行距）
       z = (cos(θ) - 1) * R_Z → 纵深位移（决定往屏幕里退多少）
       x = (cos(θ) - 1) * R_X → 横向位移（决定"弯"得有多明显）★
   θ = (i - pos) * STEP_DEG，pos 是连续的小数位置，
   滚动时整条弧平滑滑过而不是一格一格跳。

   ⚠️ 血泪教训：一开始只给了 y 和 z，结果所有条目的**中心横坐标恒为 0**，
   透视只让它们缩小、位移，视觉上就是"一列排在同一条竖线上"，完全没有半圆感。
   因为透视投影里 x_screen = x_world * P/(P-z)，x_world 若是 0，
   再深的 z 也换不来横向偏移。必须显式给 x 分量，弧才会"弯"出来。

   三个半径的作用分工：
     R_Y  → 只影响行距（视觉上条目之间的疏密）
     R_Z  → 只影响后退速度（越小越"扁"，越大越"深"）
     R_X  → 只影响弯曲幅度（0 = 直线列，越大越像半圆）
   三者独立，可以单独调其中任何一个而不牵连其他两个。
   ================================================================== */
const STEP_DEG = 15; // 相邻两项在弧上的角距（deg）—— 越大弧度越明显
const R_Y = 560; // 竖直半径 → 行距 ≈ R_Y * sin(STEP_DEG) ≈ 145px（要比条目高度大才不挤）
const R_Z = 1150; // 纵深半径 → 越大，两侧往屏幕里退得越狠
const R_X = 620; // 横向半径 → 越大，"半圆"弯得越明显（0 = 退化成一条直线）
/*
   ⚠️ 想让屏幕上的轨迹是一条**正圆弧**，必须让 R_X 与 R_Y 相等：
      x_screen / y_screen = (curve / sinθ) * (R_X / R_Y)
    R_X === R_Y 时比值恰好等于正圆的 (1-cosθ)/sinθ = tan(θ/2)。
   R_X < R_Y → 弧被压扁成"竖着的一条微斜列"（就是用户吐槽的情况）；
   R_X > R_Y → 弯得比正圆还夸张，像被掰弯的弧。
*/
const TILT = 0.6; // rotateX 阻尼：0=不倾斜 1=完全贴合弧面（让条目面朝弧心）

/* ==================================================================
   2. 景深（镜头感）
   t = |i - pos| / FALLOFF，clamp 到 0~1，再用 smoothstep 缓一下，
   避免"刚离开焦点就立刻糊掉"的塑料感。
   ================================================================== */
const FALLOFF = 2.8; // 离焦点几项后完全虚化
const MAX_BLUR = 10; // 最远端 blur(px)
const SCALE_FOCUS = 1.1; // 焦点缩放（别调太大：scale 会把内容往外推，挤到右侧指示器）
const SCALE_FAR = 0.8; // 最远端缩放（透视还会再叠一层缩小）
const OPACITY_FAR = 0.32; // 最远端不透明度
/*
   ⚠️ VISIBLE 别贪大：弧线越往外纵向间距压缩得越快（近疏远密），
   而条目高度只按 scale 缩到 0.8 倍。一旦"行距 < 相邻两条目半高之和"，
   远端两项就会互相压字。实测 STEP_DEG=15 / R_Y=560 时，
   |d| ≤ 2.8 之内不会重叠，所以这里卡 2.8（远端本来也已 blur(10px) + opacity .32，
   隐藏时几乎看不出突兀）。
*/
const VISIBLE = 2.8; // 超出这个项距直接不渲染（省 DOM 与 blur 开销）
/** 刻度指示器一行的高度（px），必须与 CSS 里 .ww-gauge-node 的 height 一致 */
const GAUGE_ROW = 30;

/* ==================================================================
   3. 步进手感（一次滚动 = 一个项目）
   ================================================================== */
const WHEEL_THRESHOLD = 50; // 累计多少 deltaY 算"滚了一下"
const STEP_LOCK = 240; // 两次步进之间的最小间隔（ms）
const STEP_DURATION = 0.5; // 单步补间时长（s）
const STEP_EASE = EASE.world;
const DRAG_PER_ITEM = 70; // 拖拽多少 px 换一个项目

/**
 * 共享元素（FLIP）的起点：被点中的那张封面。
 * 封面既在轨道里（缩略图），又在详情页首屏（大图）——
 * 它就是这两屏之间的那个共享元素，详情页从这里的矩形长开、也缩回这里。
 */
export type WheelOrigin = {
  /** 封面元素本体。关闭详情页时要**重新**量它的位置（那时轨道已经转到位了） */
  el: HTMLElement;
  /** 点击**那一刻**的矩形。轨道随后会自己转过去，只有这一刻的矩形对得上眼睛 */
  rect: DOMRect;
};

export type WorksWheelHandle = {
  /** 取第 i 项的封面元素（详情页内部换项目后，关闭时要缩回"这一个"身上） */
  coverOf: (i: number) => HTMLElement | null;
};

type Props = {
  projects: ProjectState[];
  /** 外部（3D 木马 / 详情面板）当前聚焦的索引，用于反向同步轮子 */
  focusIndex: number | null;
  /** 点条目：第二参是该封面的 FLIP 起点（没封面 / 拿不到元素时为 null） */
  onSelect: (i: number, origin: WheelOrigin | null) => void;
  onCenterChange: (i: number) => void;
  ref?: Ref<WorksWheelHandle>;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 右侧 3D 半圆弧轨道（Curved 3D Wheel）
 *
 * 驱动方式：**离散步进** —— 一次滚轮/一次拖拽只走一个项目，
 * 由 GSAP 补间 pos（小数）从当前项滑到目标项，配合下面的
 * rotateX / translateZ / blur 计算，整条弧一起转过去。
 * 不再用 ScrollTrigger 的 scrub 惯性，避免"滚一下滑到底"。
 *
 * 所有逐帧样式都是 JS 直写 DOM（不走 React state），
 * 否则每帧 re-render 会把 60fps 直接打死。
 */
export function WorksWheel({ projects, focusIndex, onSelect, onCenterChange, ref }: Props) {
  const n = projects.length;

  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gaugeListRef = useRef<HTMLDivElement>(null);
  const gaugeCapRef = useRef<HTMLSpanElement>(null);

  /** 第 i 项的封面元素（有图取图，空槽退回那块 100×68 的占位） */
  const coverOf = useCallback((i: number) => {
    const item = itemRefs.current[i];
    if (!item) return null;
    return (
      item.querySelector<HTMLElement>('.ww-cover img') ??
      item.querySelector<HTMLElement>('.ww-cover')
    );
  }, []);

  useImperativeHandle(ref, () => ({ coverOf }), [coverOf]);

  /** 连续位置（小数），由 GSAP 补间推进 */
  const posRef = useRef(0);
  const proxyRef = useRef({ p: 0 });
  const centerRef = useRef(0);
  const posCbRef = useRef(onCenterChange);
  posCbRef.current = onCenterChange;

  /** 步进节流 */
  const accRef = useRef(0);
  const lockRef = useRef(0);
  /** 拖动状态 */
  const dragRef = useRef({ active: false, y: 0, moved: 0 });
  const suppressRef = useRef(false);

  /* ---------- 逐帧布局：把弧线 / 缩放 / 模糊写进 DOM ---------- */
  const layout = useCallback(() => {
    const pos = posRef.current;
    const list = itemRefs.current;

    for (let i = 0; i < list.length; i += 1) {
      const el = list[i];
      if (!el) continue;
      const d = i - pos;
      const ad = Math.abs(d);

      if (ad > VISIBLE) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      if (el.style.display === 'none') el.style.display = '';

      // —— 弧线：θ → (x, y, z)
      const a = d * STEP_DEG;
      const rad = (a * Math.PI) / 180;
      const curve = Math.cos(rad) - 1; // 0（中心）→ -1（最远），三项共用
      const y = Math.sin(rad) * R_Y;
      const z = curve * R_Z;
      /*
        横向分量带负号：curve 恒 ≤ 0，取负后两侧（上下远端）向**右**偏移，
        于是焦点项相对最靠左、整条弧呈 ")" 形（中心鼓向左）。
        去掉这个负号就翻成 "(" 形 —— 方向只由这一个符号决定。
      */
      const x = -curve * R_X;

      // —— 景深：t 用 smoothstep 缓动，避免"出焦即糊"
      const t = Math.min(ad / FALLOFF, 1);
      const e = t * t * (3 - 2 * t);
      const scale = SCALE_FOCUS + (SCALE_FAR - SCALE_FOCUS) * e;
      const blur = Math.pow(t, 1.4) * MAX_BLUR;
      const opacity = 1 - (1 - OPACITY_FAR) * e;

      el.style.transform =
        `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) ` +
        `rotateX(${(-a * TILT).toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      el.style.filter = blur > 0.06 ? `blur(${blur.toFixed(2)}px)` : 'none';
      el.style.opacity = opacity.toFixed(3);
      el.style.zIndex = String(Math.round(1000 - ad * 100));
    }

    /* —— 刻度指示器：白点随滚动沿线滑动，文字列同步平移 ——
       capY = 白点相对轴心的偏移（一个行距 = 30px，与 .ww-gauge-node 的行高一致）
       listY = 文字列反向平移，让"当前项"始终对齐到白点所在的水平线上 */
    const cap = gaugeCapRef.current;
    if (cap) cap.style.transform = `translate3d(0, ${(pos * GAUGE_ROW).toFixed(2)}px, 0)`;

    const listEl = gaugeListRef.current;
    if (listEl) {
      listEl.style.transform = `translate3d(0, ${(-pos * GAUGE_ROW).toFixed(2)}px, 0)`;
      // 逐项按"离白点的行距"写缩放 / 模糊 / 透明度，形成刻度渐隐
      const nodes = listEl.children;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i] as HTMLElement;
        const ad = Math.abs(i - pos);
        const t = Math.min(ad / 3.2, 1);
        const e = t * t * (3 - 2 * t);
        node.style.opacity = (1 - 0.82 * e).toFixed(3);
        node.style.filter = e > 0.05 ? `blur(${(e * 2.4).toFixed(2)}px)` : 'none';
        node.style.transform = `scale(${(1 - 0.06 * e).toFixed(3)})`;
      }
    }

    const center = clamp(Math.round(pos), 0, n - 1);
    if (center !== centerRef.current) {
      centerRef.current = center;
      posCbRef.current(center);
    }
  }, [n]);

  /* ---------- 补间到某一项（步长就是"一个项目"） ---------- */
  const animateTo = useCallback(
    (i: number, duration = STEP_DURATION) => {
      const target = clamp(i, 0, n - 1);
      gsap.to(proxyRef.current, {
        p: target,
        duration,
        ease: STEP_EASE,
        overwrite: true,
        onUpdate: () => {
          posRef.current = proxyRef.current.p;
          layout();
        },
      });
    },
    [layout, n],
  );

  /** 步进：+1 / -1 个项目 */
  const step = useCallback(
    (dir: number) => {
      animateTo(Math.round(posRef.current) + dir);
    },
    [animateTo],
  );

  /* ---------- 首帧布局 ---------- */
  useLayoutEffect(() => {
    if (n > 0) {
      proxyRef.current.p = 0;
      posRef.current = 0;
      centerRef.current = 0;
    }
    layout();
  }, [layout, n]);

  /* ---------- 外部聚焦变化 → 轮子转过去 ---------- */
  useEffect(() => {
    if (focusIndex === null) return;
    if (Math.abs(focusIndex - posRef.current) < 0.5) return;
    animateTo(focusIndex);
  }, [focusIndex, animateTo]);

  /* ---------- 滚轮 / 拖拽 / 触摸：一律换算成"走了几个项目" ---------- */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || n < 2) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // 行/页模式换算成像素
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? wrap.clientHeight : 1;
      accRef.current = clamp(accRef.current + e.deltaY * unit, -WHEEL_THRESHOLD * 2, WHEEL_THRESHOLD * 2);

      const now = performance.now();
      if (now - lockRef.current < STEP_LOCK) return;
      if (Math.abs(accRef.current) < WHEEL_THRESHOLD) return;

      const dir = accRef.current > 0 ? 1 : -1;
      accRef.current = 0;
      lockRef.current = now;
      step(dir);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragRef.current = { active: true, y: e.clientY, moved: 0 };
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d.active) return;
      d.moved = Math.max(d.moved, Math.abs(e.clientY - d.y));
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d.active) return;
      d.active = false;
      // 拖过就别再触发 click
      suppressRef.current = d.moved > 6;
      window.setTimeout(() => {
        suppressRef.current = false;
      }, 0);
      if (d.moved < 20) return;
      const dir = d.y > 0 ? -1 : 1; // 往上拖 = 看后面的项目
      const count = Math.max(1, Math.round(d.moved / DRAG_PER_ITEM));
      lockRef.current = performance.now();
      animateTo(Math.round(posRef.current) + dir * count);
    };

    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      wrap.removeEventListener('wheel', onWheel);
      wrap.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [animateTo, layout, n, step]);

  /* ---------- 卸载：收掉补间 ---------- */
  useEffect(
    () => () => {
      gsap.killTweensOf(proxyRef.current);
    },
    [],
  );

  const handleClick = (i: number) => {
    if (suppressRef.current) return;
    lockRef.current = performance.now();
    /* ⚠️ 先在**这里**量起点，再启动补间。animateTo 走完这一格要 0.5s，
       等它转到位再量，"起点"就成了屏幕中心 —— 详情页会从错的地方起飞。 */
    const el = coverOf(i);
    const rect = el ? el.getBoundingClientRect() : null;
    animateTo(i);
    onSelect(i, el && rect && rect.width > 1 ? { el, rect } : null);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    step(e.key === 'ArrowDown' ? 1 : -1);
  };

  return (
    <div
      className="ww-wrap"
      ref={wrapRef}
      onKeyDown={handleKey}
      data-lenis-prevent
      role="listbox"
      aria-label="策划案弧形轨道"
      tabIndex={0}
    >
      {/* 3D 舞台 */}
      <div className="ww-stage">
        {projects.map((p, i) => (
          <button
            key={p.code}
            type="button"
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className={`ww-item${i === focusIndex ? ' is-focus' : ''}${p.filled ? '' : ' is-empty'}`}
            onClick={() => handleClick(i)}
            role="option"
            aria-selected={i === focusIndex}
            tabIndex={i === focusIndex ? 0 : -1}
          >
            <span className="ww-cover">
              {p.cover ? (
                <img
                  src={p.cover}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  onLoad={coverAr('.ww-cover')}
                />
              ) : (
                <span className="ww-empty" />
              )}
            </span>
            <span className="ww-meta">
              <span className="ww-code">{p.code}</span>
              <span className="ww-title">{p.filled ? p.title : '待提交项目'}</span>
              <span className="ww-en">{p.filled ? p.role || p.client : 'EMPTY SLOT'}</span>
            </span>
          </button>
        ))}
      </div>

      {/* 右侧竖向刻度指示器：居中细线 + 随滚动滑动的白点 + 同步平移的文字列 */}
      <div className="ww-gauge" aria-hidden="true">
        <span className="ww-gauge-line" />
        <span className="ww-gauge-cap" ref={gaugeCapRef} />
        <div className="ww-gauge-list" ref={gaugeListRef}>
          {projects.map((p) => (
            <span key={p.code} className="ww-gauge-node">
              {p.title}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default WorksWheel;
