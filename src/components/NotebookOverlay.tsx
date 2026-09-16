import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import gsap from 'gsap';
import { DIARY_ENTRIES, DIARY_COVER_EN } from '@/data/diary';

type Props = {
  open: boolean;
  onClose: () => void;
  onHoverChange?: (hovering: boolean) => void;
};

const RING_COUNT = 14;
/** 总页数 = 封面 + N 篇日记 */
const TOTAL = DIARY_ENTRIES.length + 1;
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 实习日记（2026-09-16 重写）—— 工作室笔记本物件的「手账翻页本」。
 *
 * 设计参考用户给的示例录屏（130919）：牛皮纸面 + 淡手写字水印 + 纸带标题贴 +
 * 手写编号标题 + 手绘下划线/箭头 + 拍立得相框（纸胶带、微旋转）+ 纸片 chips + 涂鸦。
 * 内容 = 封面 + 五篇实习日记（src/data/diary.ts，占位文案，作者可随时替换）。
 *
 * 交互（用户要求）：**翻页**，不做长滚动 —— 绕左书脊 rotateY（GSAP transformPerspective），
 * 与 WorkProjectPage 的翻页同一套模式：
 *  · 翻页期间给 .diary-flip 挂 .is-flipping 关掉 transition（否则 CSS transition 会把
 *    GSAP 的逐帧 rotateY 压平，只看到最后几度 —— 踩过的坑）；
 *  · 翻出转到 108°（侧棱朝人、不可见）时才换内容（key 重建 .diary-sheet），
 *    useLayoutEffect 在 paint 前把新页摆回 108° 起点再转回 0°，肉眼看不到换页瞬间。
 * 入口仍是「点击工作室桌面上的笔记本」；关闭（X / Esc / 点遮罩）回工作室。
 */

export function NotebookOverlay({ open, onClose, onHoverChange }: Props) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  /** 当前页：0 = 封面，1..N = DIARY_ENTRIES */
  const [page, setPage] = useState(0);

  /* ---------- 翻页动效 ---------- */
  const flipRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const flippingRef = useRef(false);
  /** 待换入的页码：exit 动画 onComplete 写入，entry 的 layout effect 消费 */
  const pendingRef = useRef<number | null>(null);
  /** 翻向（1=下一页绕左脊负向翻，-1=上一页正向） */
  const dirRef = useRef<-1 | 1>(-1);

  const flipTo = useCallback(
    (target: number, dir: 1 | -1) => {
      if (flippingRef.current || closing || target === page) return;
      if (target < 0 || target >= TOTAL) return;
      const el = flipRef.current;
      if (!el) {
        setPage(target);
        return;
      }
      flippingRef.current = true;
      dirRef.current = dir === 1 ? -1 : 1;
      const sign = dirRef.current;
      el.classList.add('is-flipping');
      gsap
        .timeline({
          onComplete: () => {
            pendingRef.current = target;
            setPage(target); // 侧棱朝人时换内容，看不见换页瞬间
          },
        })
        .set(el, { transformOrigin: 'left center', rotationY: 0, transformPerspective: 1500 })
        .to(shadeRef.current, { opacity: 0.4, duration: 0.3, ease: 'power2.in' }, 0)
        .to(el, { rotationY: sign * 108, duration: 0.36, ease: 'power2.in' }, 0);
    },
    [page, closing],
  );

  /* 新页挂载（paint 前）：从 108° 转回 0°，阴影随之淡出 */
  useLayoutEffect(() => {
    if (pendingRef.current === null) return;
    pendingRef.current = null;
    const el = flipRef.current;
    if (!el) {
      flippingRef.current = false;
      return;
    }
    const sign = dirRef.current;
    gsap.set(el, { rotationY: sign * 108 });
    gsap.fromTo(
      shadeRef.current,
      { opacity: 0.4 },
      { opacity: 0, duration: 0.55, ease: 'power2.out' },
    );
    gsap.to(el, {
      rotationY: 0,
      duration: 0.52,
      ease: 'power3.out',
      onComplete: () => {
        el.classList.remove('is-flipping');
        gsap.set(el, { clearProps: 'transform,transformOrigin,transformPerspective' });
        flippingRef.current = false;
      },
    });
  }, [page]);

  /* ---------- 开关 / 键盘 ---------- */
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      setPage(0); // 每次打开都从封面开始
      flippingRef.current = false;
      pendingRef.current = null;
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 380);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') flipTo(page + 1, 1);
      else if (e.key === 'ArrowLeft') flipTo(page - 1, -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onClose, flipTo, page]);

  if (!mounted) return null;

  const entry = page > 0 ? DIARY_ENTRIES[page - 1] : null;

  return (
    <div
      className={`notebook-overlay diary-overlay${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="实习日记"
    >
      <div className="notebook-backdrop" onClick={onClose} />

      <div className="notebook-page diary-book">
        {/* 左侧金属双线圈（沿用原线圈本样式） */}
        <div className="notebook-spiral" aria-hidden="true">
          {Array.from({ length: RING_COUNT }).map((_, i) => (
            <span key={i} className="notebook-ring" />
          ))}
        </div>

        {/* 淡手写字水印（参考示例的纸面底纹）：只挂一份，不随翻页重建 */}
        <div className="diary-watermarks" aria-hidden="true">
          <span className="diary-wm is-1">keep going</span>
          <span className="diary-wm is-2">2026</span>
          <span className="diary-wm is-3">idea!</span>
          <span className="diary-wm is-4">to be continued</span>
        </div>

        {/* 翻页层：绕左书脊 rotateY；.diary-sheet 按 key 换页 */}
        <div className="diary-flip" ref={flipRef}>
          <div className="diary-sheet" key={page}>
            {page === 0 ? (
              /* ================= 封面 ================= */
              <div className="diary-cover">
                <span className="diary-cover-tape" aria-hidden="true" />
                <div className="diary-cover-titlewrap">
                  <h2 className="diary-cover-title">实习日记</h2>
                  {/* 两笔手绘椭圆圈住标题（同光标标签 ring 的画法） */}
                  <svg
                    className="diary-cover-ring"
                    viewBox="0 0 340 150"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      className="diary-ring-stroke"
                      pathLength={100}
                      d="M176 12 C 66 8, 14 42, 16 78 C 18 118, 96 142, 182 139 C 272 136, 326 106, 324 70 C 322 36, 254 14, 190 14"
                    />
                    <path
                      className="diary-ring-stroke is-2"
                      pathLength={100}
                      d="M196 18 C 96 22, 30 52, 32 84 C 34 120, 116 143, 198 139"
                    />
                  </svg>
                </div>
                <p className="diary-cover-en">{DIARY_COVER_EN}</p>
                <p className="diary-cover-sub">Thinking / Process</p>
                <span className="diary-chip is-hint">从右下角开始翻 ›</span>
              </div>
            ) : (
              entry && (
                /* ================= 日记页 ================= */
                <article className={`diary-entry${entry.current ? ' is-current' : ''}`}>
                  {/* 纸带标签：时间 + 公司 */}
                  <div className="diary-tape-label">
                    <span className="diary-tape" aria-hidden="true" />
                    <span className="diary-tape-date">{entry.date}</span>
                    <span className="diary-tape-org">{entry.org}</span>
                  </div>

                  <header className="diary-note-head">
                    <p className="diary-note-no" aria-hidden="true">
                      {pad2(page)}.
                    </p>
                    <h3 className="diary-note-title">{entry.title}</h3>
                    <svg
                      className="diary-note-underline"
                      viewBox="0 0 260 14"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path
                        className="diary-ring-stroke"
                        pathLength={100}
                        d="M4 8 C 60 4, 150 4, 256 7 M 20 12 C 90 9, 170 9, 236 11"
                      />
                    </svg>
                    <p className="diary-note-en">{entry.titleEn}</p>
                  </header>

                  <div className="diary-entry-body">
                    {entry.body.map((p, i) => (
                      <p className="diary-p" key={i}>
                        {p}
                      </p>
                    ))}
                  </div>

                  <div className="diary-figs">
                    {entry.photos.map((ph, i) => (
                      <figure
                        className="diary-polaroid"
                        key={ph.src}
                        style={{ '--rot': `${ph.rot ?? (i ? 1.8 : -2.2)}deg` } as CSSProperties}
                      >
                        <span className="diary-polaroid-tape" aria-hidden="true" />
                        <img src={ph.src} alt="" loading="lazy" draggable={false} />
                        {ph.caption ? <figcaption>{ph.caption}</figcaption> : null}
                      </figure>
                    ))}
                  </div>

                  <div className="diary-chips">
                    <span className="diary-chip is-role">{entry.role}</span>
                    {entry.chips.map((c) => (
                      <span className="diary-chip" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>

                  {entry.current ? <span className="diary-chip is-todo">这一篇还在写 · 待续</span> : null}

                  <Doodle kind={entry.doodle} />
                </article>
              )
            )}
          </div>
          {/* 翻页时的动态阴影：翻出加深、翻入淡出 */}
          <div className="diary-shade" ref={shadeRef} aria-hidden="true" />
        </div>

        {/* 底部中间页码（保留手账页码；翻页键 2026-09-16 按用户要求改成圆圈箭头，
            钉在本子右下/左下角 —— 见 .diary-nav 的定位说明） */}
        <div className="diary-pager">
          <span className="diary-pager-num">
            {pad2(page + 1)} / {pad2(TOTAL)}
          </span>
        </div>

        {/* 圆圈右箭头 = 下一页：钉在本子右下角、半出页面外（用户参考图位置） */}
        {page < TOTAL - 1 ? (
          <button
            type="button"
            className="diary-nav is-next"
            onClick={() => flipTo(page + 1, 1)}
            aria-label="翻到下一页"
          >
            <span className="diary-nav-circle" aria-hidden="true">→</span>
          </button>
        ) : null}
        {/* 圆圈左箭头 = 上一页：第 2 页起出现在左下角对称位置 */}
        {page > 0 ? (
          <button
            type="button"
            className="diary-nav is-prev"
            onClick={() => flipTo(page - 1, -1)}
            aria-label="看上一页"
          >
            <span className="diary-nav-circle" aria-hidden="true">←</span>
          </button>
        ) : null}
      </div>

      {/* 左上进度胶囊（参考示例 3/5 Notes 的位置） */}
      <div className="diary-progress">
        <span className="diary-progress-num">
          {pad2(page + 1)}/{pad2(TOTAL)}
        </span>
        <span className="diary-progress-unit">篇</span>
      </div>

      <button
        type="button"
        className="notebook-close"
        onClick={onClose}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        aria-label="Close notebook"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/** 手绘涂鸦（参考示例里的 scribble / 荧光笔 / 线圈），绝对定位摆在页面角落 */
function Doodle({ kind }: { kind: 'black' | 'blue' | 'yellow' | 'loop' }) {
  if (kind === 'yellow') {
    return (
      <svg className="diary-doodle is-yellow" viewBox="0 0 200 120" aria-hidden="true">
        <path d="M14 96 C 30 30, 46 26, 52 78 C 57 116, 74 108, 84 52 C 92 12, 106 16, 112 64 C 117 104, 132 100, 142 58 C 149 28, 162 30, 170 62 C 176 84, 186 82, 194 70" />
      </svg>
    );
  }
  if (kind === 'blue') {
    return (
      <svg className="diary-doodle is-blue" viewBox="0 0 200 160" aria-hidden="true">
        <path d="M148 12 C 108 46, 74 92, 66 132 C 62 152, 84 150, 104 118 C 122 90, 150 62, 186 52" />
      </svg>
    );
  }
  if (kind === 'loop') {
    return (
      <svg className="diary-doodle is-loop" viewBox="0 0 220 140" aria-hidden="true">
        <path d="M12 108 C 40 40, 96 22, 104 58 C 110 86, 66 104, 58 78 C 52 54, 108 34, 156 44 C 186 50, 202 68, 208 88" />
      </svg>
    );
  }
  return (
    <svg className="diary-doodle is-black" viewBox="0 0 200 140" aria-hidden="true">
      <path d="M28 116 C 20 60, 44 30, 70 44 C 96 58, 60 108, 92 112 C 122 116, 118 54, 148 40 C 170 30, 182 48, 176 72 C 171 92, 186 96, 196 88" />
    </svg>
  );
}
