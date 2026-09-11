import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { MascotHandle } from '@/components/MascotViewer';

const MascotViewer = lazy(() =>
  import('@/components/MascotViewer').then((m) => ({ default: m.MascotViewer })),
);

type Props = {
  /** 内容区右下角的停靠位（决定小人初始位置与尺寸） */
  dockRef: React.RefObject<HTMLDivElement | null>;
  onHoverChange?: (hovering: boolean) => void;
};

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
/** 阻尼系数：越小越"黏"（跟随越慢、惯性越强） */
const DAMP = 0.22;

/** 点击角色时轮流触发的互动（按顺序循环） */
type PetAction = 'jump' | 'squash' | 'wiggle';
const ACTION_ORDER: PetAction[] = ['jump', 'squash', 'wiggle'];

/** 互动时随机弹出的短对话（不透明白气泡）—— 甜酷人设：拽里带甜，不打鸡血 */
const BUBBLES = [
  '啧，别乱戳',
  '哼，准你再点一次',
  '本大人今天心情不错',
  '就这？还没看够？',
  '拖稳点，我很贵的',
  '哦？你有点东西',
  '才、才不是特意陪你',
  '站稳了，别手抖',
  '看我干嘛，忙你的去',
];

/**
 * 桌宠式 3D 小人：
 * - 默认停在内容区右下角的停靠位；按住左键拖动即"拎起来"跟着鼠标走（带阻尼/惯性，身体随移动方向倾斜）
 * - 松手后停在原地；拖回停靠位附近会自动吸附回去
 * - 单击 = 轮流触发互动：跳跃 → 压扁回弹 → 左右抖动，同时弹出随机中文白气泡
 * - 模型无骨骼，动作都是整体位移与形变（跳跃走 3D，压扁/抖动走 CSS 形变）
 */
export function AboutPet({ dockRef, onHoverChange }: Props) {
  const petRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<MascotHandle>(null);
  const dockedRef = useRef(true);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [showHint, setShowHint] = useState(true);
  // 气泡文字；null = 隐藏。below = 角色靠视口上方时气泡翻到下方
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [bubbleBelow, setBubbleBelow] = useState(false);
  // 互动轮换游标 & 气泡防重复
  const actionIdxRef = useRef(0);
  const lastBubbleRef = useRef('');
  const bubbleTimerRef = useRef(0);
  // 防止 pointerup 已触发动作后 onClick 再触发一次
  const lastTapRef = useRef(0);

  // 当前渲染位置 / 目标位置（阻尼跟随用，单位 px，相对视口左上）
  const cur = useRef({ x: 0, y: 0 });
  const tgt = useRef({ x: 0, y: 0 });
  const prev = useRef({ x: 0, y: 0 });

  const drag = useRef({
    active: false,
    id: -1,
    ox: 0,
    oy: 0,
    sx: 0,
    sy: 0,
    moved: 0,
  });

  // 随机取一条气泡文案（避免和上一次重复）
  const pickBubble = useCallback(() => {
    let line = BUBBLES[Math.floor(Math.random() * BUBBLES.length)];
    if (line === lastBubbleRef.current) {
      line = BUBBLES[(BUBBLES.indexOf(line) + 1) % BUBBLES.length];
    }
    lastBubbleRef.current = line;
    return line;
  }, []);

  // 显示气泡 2 秒后自动收起；角色靠视口上方时翻到下方，避免出屏
  const showBubble = useCallback(() => {
    setBubbleText(pickBubble());
    setBubbleBelow(cur.current.y < 130);
    window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => setBubbleText(null), 2000);
  }, [pickBubble]);

  // CSS 形变类动作：先移除再加回，强制重启动画
  const triggerFx = useCallback((kind: Exclude<PetAction, 'jump'>) => {
    const el = innerRef.current;
    if (!el) return;
    el.classList.remove('do-squash', 'do-wiggle');
    void el.offsetWidth;
    el.classList.add(kind === 'squash' ? 'do-squash' : 'do-wiggle');
  }, []);

  /** 点击角色：按 跳跃 → 压扁回弹 → 左右抖动 轮流触发，并弹出随机白气泡 */
  const playNextAction = useCallback(() => {
    const action = ACTION_ORDER[actionIdxRef.current % ACTION_ORDER.length];
    actionIdxRef.current += 1;
    if (action === 'jump') viewerRef.current?.jump(1);
    else triggerFx(action);
    showBubble();
  }, [showBubble, triggerFx]);

  // 把小人对齐到停靠位（写入目标与当前位置）
  const dock = useCallback(() => {
    const slot = dockRef.current;
    const pet = petRef.current;
    if (!slot || !pet) return;
    const rect = slot.getBoundingClientRect();
    if (rect.width === 0) return;
    dockedRef.current = true;
    pet.style.width = `${Math.round(rect.width)}px`;
    pet.style.height = `${Math.round(rect.height)}px`;
    // 停靠位在内容列右下角。About 页现在整页可滚，页面一长这个 slot 就会被推到
    // 好几屏之外，所以横向照 slot 走（保证不会压住右侧栏），纵向夹进视口内 ——
    // 并且在底部留 100px，免得停靠位正好压在页脚「欢迎第 N 位参观者」上。
    const x = Math.round(clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8)));
    const y = Math.round(clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 100)));
    tgt.current = { x, y };
    cur.current = { x, y };
    prev.current = { x, y };
    pet.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, [dockRef]);

  // 阻尼跟随循环：每帧让当前位置缓动逼近目标，并把瞬时速度传给 3D 用于身体倾斜
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const pet = petRef.current;
      if (!pet) return;
      const c = cur.current;
      const t = tgt.current;
      c.x += (t.x - c.x) * DAMP;
      c.y += (t.y - c.y) * DAMP;
      const vx = c.x - prev.current.x;
      const vy = c.y - prev.current.y;
      prev.current = { x: c.x, y: c.y };
      pet.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0)`;
      viewerRef.current?.setCarry(vx, vy);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 首次布局完成后停靠；窗口尺寸变化时若仍处于停靠状态则跟着走
  useEffect(() => {
    const raf = requestAnimationFrame(dock);
    // 自定义字体（JheriCurls）加载完成会撑开 banner，位置会变，需要重新对齐
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(() => dock()).catch(() => {});
    // 兜底：布局稳定前再补两次
    const t1 = window.setTimeout(() => {
      if (dockedRef.current) dock();
    }, 500);
    const t2 = window.setTimeout(() => {
      if (dockedRef.current) dock();
    }, 1600);
    const onResize = () => {
      if (dockedRef.current) dock();
    };
    window.addEventListener('resize', onResize);
    const slot = dockRef.current;
    const observer = slot ? new ResizeObserver(onResize) : null;
    if (slot && observer) observer.observe(slot);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [dock, dockRef]);

  // 闲置自动动作：挥手 / 蹦跳
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          if (!drag.current.active) {
            if (Math.random() < 0.45) viewerRef.current?.jump(0.7);
            else viewerRef.current?.wave();
          }
          schedule();
        },
        6500 + Math.random() * 5500,
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  // 出场打个招呼
  const handleReady = useCallback(() => {
    setReady(true);
    window.setTimeout(() => viewerRef.current?.wave(), 500);
  }, []);

  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(() => setShowHint(false), 7000);
    return () => window.clearTimeout(timer);
  }, [showHint]);

  // 卸载时清掉气泡定时器
  useEffect(() => () => window.clearTimeout(bubbleTimerRef.current), []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const pet = petRef.current;
    if (!pet) return;
    const rect = pet.getBoundingClientRect();
    drag.current = {
      active: true,
      id: event.pointerId,
      ox: event.clientX - rect.left,
      oy: event.clientY - rect.top,
      sx: event.clientX,
      sy: event.clientY,
      moved: 0,
    };
    // 从当前显示位置起拖（而不是瞬移回停靠位），手感更自然
    tgt.current = { x: cur.current.x, y: cur.current.y };
    pet.setPointerCapture(event.pointerId);
    dockedRef.current = false;
    setDragging(true);
    setShowHint(false);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const pet = petRef.current;
    if (!pet) return;
    const x = clamp(event.clientX - d.ox, 8, window.innerWidth - pet.offsetWidth - 8);
    const y = clamp(event.clientY - d.oy, 8, window.innerHeight - pet.offsetHeight - 8);
    d.moved = Math.max(d.moved, Math.hypot(event.clientX - d.sx, event.clientY - d.sy));
    tgt.current = { x, y }; // 目标位置，由阻尼循环缓动逼近
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d.active) return;
    const pet = petRef.current;
    d.active = false;
    try {
      pet?.releasePointerCapture(d.id);
    } catch {
      /* 指针已释放 */
    }
    setDragging(false);
    viewerRef.current?.setCarry(0, 0);
    if (d.moved < 6) {
      // 只是点了一下 → 轮流互动 + 气泡
      lastTapRef.current = performance.now();
      playNextAction();
      return;
    }
    // 拖回停靠位附近 → 吸附回去，否则留在原地并小小落地反弹
    const slot = dockRef.current;
    if (pet && slot) {
      const a = pet.getBoundingClientRect();
      const b = slot.getBoundingClientRect();
      const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const ratio = (overlapX * overlapY) / (b.width * b.height || 1);
      if (ratio > 0.32) {
        dock();
        viewerRef.current?.jump(0.5);
        return;
      }
    }
    viewerRef.current?.jump(0.5);
  };

  // 兜底：某些浏览器/输入下 pointerup 不触发，但 click 会；用 moved 阈值区分点击/拖拽
  const onClick = () => {
    if (drag.current.moved >= 6) return;
    const now = performance.now();
    if (now - lastTapRef.current < 300) return; // 已被 pointerup 的动作覆盖
    lastTapRef.current = now;
    playNextAction();
  };

  return (
    <div
      ref={petRef}
      className={`about-pet${dragging ? ' is-dragging' : ''}${ready ? ' is-ready' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={onClick}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      role="img"
      aria-label="3D 小人桌宠：左键拖动换位置，点击轮流触发跳跃、压扁回弹、左右抖动"
    >
      <div
        ref={innerRef}
        className="about-pet-inner"
        onAnimationEnd={(e) => {
          // 动画播完清掉形变类，避免和下一次点击的动画冲突
          if (e.target === innerRef.current) {
            innerRef.current.classList.remove('do-squash', 'do-wiggle');
          }
        }}
      >
        <Suspense fallback={null}>
          <MascotViewer ref={viewerRef} onReady={handleReady} />
        </Suspense>
      </div>
      <span className="about-pet-shadow" aria-hidden="true" />
      <span
        className={`about-pet-bubble${bubbleText ? ' is-on' : ''}${bubbleBelow ? ' is-below' : ''}`}
        aria-live="polite"
      >
        {bubbleText ?? ''}
      </span>
      <span className={`about-pet-hint${showHint && !dragging ? ' is-on' : ''}`}>
        拖我 · 点我一下
      </span>
    </div>
  );
}
