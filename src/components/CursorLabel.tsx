import { useEffect, useRef } from 'react';
import { EASE } from '@/lib/ease';
import gsap from 'gsap';

/** 哪些动作名吃磁吸。只做这三个 —— Jump / Edit / Next / Prev 保持纯滞后跟随，免得满屏都在吸。 */
const MAGNETIC = new Set(['Focus', 'Back', 'Close']);
/** 吸向元素中心的比例 */
const PULL = 0.22;
/** 但最多吸这么多 px。左栏 / 放大层是整块大热区，不 clamp 会把标签拽到屏幕中间去。 */
const PULL_MAX = 16;

/**
 * 手绘圈注式跟随标签（2026-09-15 第三版）。
 *
 * 形态演变：① 手绘手型 + 标签 → 用户嫌手型丑删掉；② 系统光标 + 纯文字标签（gilhuybrecht 那一路）；
 * ③ **现在这版**：照 mattjinn.com 抄 —— 手写体文字（2026-09-15 起用 Caveat）+ **两笔手绘弧线圈住它**，
 * 系统光标（手型）照旧保留在左上。用户要求「把光标换成视频网站那样」。
 *
 * 弧线为什么用 SVG 而不是 CSS 边框：手绘感靠的是"两笔不闭合、端点错开、笔画粗细一致"，
 * border-radius 画不出这个。两条 path 拼成一个不闭合的椭圆，
 * 配 `vector-effect: non-scaling-stroke`（宽度不随标签长短被拉伸）
 * 与 `pathLength:100`（把路径长度归一化，dash 动画不用手算长度）。
 *
 * 行为：
 *   - 只在悬停到带动作名（非空）的 [data-cursor] 上时出现；空标签（区域兜底）不显示 ——
 *     系统光标已经表达了默认态，不需要再画一个什么跟着；
 *   - 弹簧滞后：gsap.quickTo 缓动跟随（x .5s / y .42s 错开一点，走起来有有机的歪斜）；
 *   - 磁吸：悬停 Focus / Back / Close 时往元素中心轻拉（PULL 比例 + PULL_MAX 钳制）；
 *   - 双色调：data-cursor-tone="light"（浅底）→ 深棕字，否则白字；
 *   - 逐帧写 DOM 不走 React state（pointermove 一秒几十次，setState 会拖死页面）。
 */
export function CursorLabel() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const lab = root.querySelector<HTMLElement>('.cur-label');
    if (!lab) return;

    /* 初始是 null 而不是 ''：区分「还没算过」和「这里没动作名」 */
    let showing: string | null = null;
    /** 真实指针位置 —— 悬停判定用它，**不是**标签渲染位置（否则磁吸会自己抖动） */
    const ptr = { x: -1, y: -1 };
    let started = false;
    /** 上一帧是否处于磁吸态：磁吸时元素会随滚动移动，得持续重算 */
    let locked = false;
    /** 指针没动时没必要每帧 elementFromPoint（它会强制布局） */
    let dirty = true;
    /* 上一次下发的目标点。⚠️ 必须去重：磁吸态下每帧都会算出一个新目标，
       而 quickTo 的 resetTo 是「从当前位置重新起一段完整 duration 的补间」——
       每帧重设 = 补间永远重启，标签永远差最后一段追不上。 */
    let lastTx = NaN;
    let lastTy = NaN;

    /* 弹簧滞后：x 比 y 慢一点（0.5 / 0.42），对角线移动时会有很轻的弧线感 */
    const toX = gsap.quickTo(root, 'x', { duration: 0.5, ease: EASE.world });
    const toY = gsap.quickTo(root, 'y', { duration: 0.42, ease: EASE.world });

    /** 目标点没变就不重复下发（见 lastTx 的注释） */
    const push = (tx: number, ty: number) => {
      if (Math.abs(tx - lastTx) < 0.5 && Math.abs(ty - lastTy) < 0.5) return;
      lastTx = tx;
      lastTy = ty;
      toX(tx);
      toY(ty);
    };

    const update = () => {
      if (!started) return;
      // 标签自身是 pointer-events:none，所以 elementFromPoint 拿到的是它底下的元素
      const hit = document.elementFromPoint(ptr.x, ptr.y);
      const host = hit instanceof Element ? hit.closest<HTMLElement>('[data-cursor]') : null;
      const next = host?.dataset.cursor ?? '';

      if (next !== showing) {
        lab.textContent = next;
        showing = next;
      }
      /* 色调就近取：host 自己没声明 tone 就往上找最近的声明（区域兜底一般挂在祖先上） */
      if (host) {
        const toneEl = host.closest<HTMLElement>('[data-cursor-tone]') ?? host;
        root.classList.toggle('is-ink', toneEl.dataset.cursorTone === 'light');
      }

      /* ---- 磁吸：目标点往元素中心偏移一点点 ---- */
      let tx = ptr.x;
      let ty = ptr.y;
      locked = MAGNETIC.has(next);
      root.classList.toggle('is-lock', locked);
      if (locked && host) {
        const r = host.getBoundingClientRect();
        const dx = r.left + r.width / 2 - ptr.x;
        const dy = r.top + r.height / 2 - ptr.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) {
          const pull = Math.min(d * PULL, PULL_MAX);
          tx += (dx / d) * pull;
          ty += (dy / d) * pull;
        }
      }

      /* 只有「有动作名」才显示文字 —— 没有动作名的地方系统光标自己就够了 */
      root.classList.toggle('is-on', next !== '');
      push(tx, ty);
    };

    const onMove = (e: PointerEvent) => {
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      if (!started) {
        /* 首帧直接落位，别从 (0,0) 缓动飞过来 */
        started = true;
        lastTx = ptr.x;
        lastTy = ptr.y;
        gsap.set(root, { x: ptr.x, y: ptr.y });
      }
      dirty = true;
      update();   // 当帧就算一次：动作名要跟着鼠标立刻换，不能等下一帧
    };

    /* 页面结构变了（比如放大层刚弹出来）但指针没动 → 手动重算一次 */
    const refresh = () => {
      dirty = true;
      update();
    };

    /* 悬停判定放 ticker 里兜底：指针不动但底下的东西变了（滚动 / 元素移动 /
       磁吸目标在动）时，标签和磁吸偏移都要跟上。 */
    const tick = () => {
      if (!dirty && !locked) return;
      dirty = false;
      update();
    };

    const hide = () => {
      root.classList.remove('is-on');
      root.classList.remove('is-lock');
      showing = null;
      locked = false;
    };
    const down = () => root.classList.add('is-press');
    const up = () => root.classList.remove('is-press');
    /* 滚动（含右栏内部滚动，所以用捕获）会让指针底下的元素换人 */
    const onScroll = () => { dirty = true; };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('cursor:refresh', refresh);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('pointerleave', hide);
    gsap.ticker.add(tick);

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('cursor:refresh', refresh);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', hide);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerleave', hide);
    };
  }, []);

  return (
    <div className="cur" ref={rootRef} aria-hidden="true">
      {/* 圈注：两笔手绘弧线 + 中间的手写体文字。位置（跟系统光标的间距）在 CSS 里。 */}
      <span className="cur-mark">
        <svg className="cur-ring" viewBox="0 0 132 72" preserveAspectRatio="none" aria-hidden="true">
          {/* 第一笔：从左下起，绕上去到右上 */}
          <path
            className="cur-ring__s"
            pathLength={100}
            d="M23 64 C5 47 6 16 35 7 C62 -1 106 1 121 17"
          />
          {/* 第二笔：从右上接下去，绕回左下，末端**故意超出起点一点**（手绘不闭合的关键） */}
          <path
            className="cur-ring__s"
            pathLength={100}
            d="M121 17 C130 38 120 60 94 66 C70 71 33 70 20 66"
          />
        </svg>
        <span className="cur-label" />
      </span>
    </div>
  );
}

export default CursorLabel;
