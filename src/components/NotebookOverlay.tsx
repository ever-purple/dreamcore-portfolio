import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { EASE } from '@/lib/ease';
import gsap from 'gsap';
import { DIARY_ENTRIES, DIARY_COVER_EN } from '@/data/diary';
import { PageDecor } from '@/components/PageDecor';
import { StudioChrome } from '@/components/StudioChrome';
import { useEscape } from '@/lib/escape-stack';

type Props = {
  open: boolean;
  onClose: () => void;
};

const RING_COUNT = 14;
/**
 * 翻页时把纸**横切成多少条竖带**。
 * CSS 变换是仿射的 —— 单个元素无论怎么 rotateY/skew，平面矩形转完还是平面矩形，
 * 永远弯不起来（这就是用户说的「直直地翻过去」）。真弯曲只能「切条 + 每条各自转」
 * 拼出来，条数越多弧面越顺、代价是 DOM 越多（每条带 = 一份完整纸面）。
 * 12 条在 1920 宽下每条约 130px，弧线的折角在动态里看不出来，是实测的平衡点。
 */
const BAND_COUNT = 12;
/**
 * 卷曲最大总圆心角（弧度）≈ 24°。见 applyCurl 的圆弧模型。
 *
 * ⚠️ 这个值是被**投影放大**卡住的，不是审美随便定的：
 *    圆弧把自由边往读者这边推 `W·φ/2`，透视（.diary-flip 的 1700px）再把它放大
 *    `1700/(1700-z)` 倍。φ 取 0.78（≈45°）时 z≈575px、放大 1.51× ——
 *    纸的右缘直接被推出本子的裁切框外，"弯曲"全被裁掉了（实测截图确认）。
 *    φ=0.42 时 z≈310px、放大 1.22×，自由边落在 x≈1438 < 1474 框内，刚好收得住。
 */
const CURL_MAX = 0.42;
/**
 * 卷曲量随翻页进度 p(0..1) 的变化曲线 —— **平台型**，不是 sin 单峰。
 *
 * 为什么不用 sin(πp)：它在 p=0.5 达到峰值，而 p=0.5 正好是纸转 54°、
 * 最"侧"的时候 —— 弯得最狠的时候偏偏最看不见（实测姿态截图就是这样）。
 * 改成 [0,0.25] 升到 1、[0.25,0.75] 保持 1、[0.75,1] 收回 0：
 * 纸从转到 27° 起就已经弯满，一直弯到 81°，整个可见窗口里"纸是弯的"这件事
 * 都成立；两端仍归零（平摊在书脊任一侧时不该是弯的）。
 * 用两次 smoothstep 相乘而不是直接 clamp，是为了在平台两端没有折角。
 */
function curlBump(p: number): number {
  const rise = Math.min(1, p / 0.25);
  const fall = Math.min(1, (1 - p) / 0.25);
  return rise * rise * (3 - 2 * rise) * (fall * fall * (3 - 2 * fall));
}
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
 * 交互（用户要求）：**翻页**，不做长滚动。
 *
 * ## 翻页动效的三轮演进（别往回退）
 *   第一轮：整张纸一个元素绕左书脊 `rotateY` —— 用户否掉了：
 *     「没有翻页时的弯曲感，现在是直直地翻过去的」。
 *     根因是 CSS 变换**仿射**：平面矩形转完还是平面矩形，不可能弯。
 *   第二轮（现在）：**切条 + 各自自转**，把纸弯成一段圆弧，同时整体公转。
 *     结构 .diary-flip（透视/裁切）＞ .diary-turn（公转）＞ .diary-band ×12（自转）。
 *     几何模型与参数全在下面 `applyCurl` 的注释里。
 *     · 翻页期间给 .diary-flip 挂 .is-flipping 开 will-change；
 *     · 公转转到 108°（侧棱朝人）时才换内容（key 重建 .diary-sheet），
 *     · 卷曲量走 `curlBump(p)`（平台型，不是 sin 单峰）—— 让"弯满"落在纸还朝着
 *       读者的时候，而不是它转到 54° 最侧的那一瞬；详见 CURL_MAX / curlBump 注释。
 * 入口仍是「点击工作室桌面上的笔记本」；关闭（X / Esc / 点遮罩）回工作室。
 */

export function NotebookOverlay({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  /** 当前页：0 = 封面，1..N = DIARY_ENTRIES */
  const [page, setPage] = useState(0);

  /* ---------- 翻页动效（2026-09-16 第三轮：加「卷曲」）----------
     用户原话：「不喜欢实习日记的翻页方式，没有翻页时的弯曲感，现在是直直地翻过去的」。
     旧实现把整张纸当成**一个元素**绕左书脊 rotateY —— 平面矩形转完还是平面矩形，
     弯不起来。所以这里改成**三层**：
       .diary-flip   透视 + 裁切（所有带共用一台投影像机，否则弧面会裂开）
       .diary-turn   整页绕左书脊**公转**（0 → ±108°）
       .diary-band   每条竖带各自**自转**一小角（把纸弯成圆弧）＞ .diary-sheet 内容
     公转负责"翻过去"，自转负责"弯起来"，两者由同一个进度量 p 驱动。 */
  const flipRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef<HTMLDivElement>(null);
  const bandRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shadeRef = useRef<HTMLDivElement>(null);
  const flippingRef = useRef(false);
  /** 竖带的像素边界 [0, b1, … , W] —— clip-path 与每条带的中心都从这儿取 */
  const boundsRef = useRef<number[]>([]);
  /** 待换入的页码：exit 动画 onComplete 写入，entry 的 layout effect 消费 */
  const pendingRef = useRef<number | null>(null);
  /** 翻向（1=下一页绕左脊负向翻，-1=上一页正向） */
  const dirRef = useRef<-1 | 1>(-1);
  /** 卷曲方向：+1 往读者这边鼓（下一页），-1 往纸背鼓（上一页） */
  const curlRef = useRef<1 | -1>(1);

  /**
   * 量一次竖带边界并把 clip-path 铺好（只在挂载 / 改尺寸时跑，翻页过程中不动）。
   * ⚠️ 用**四舍五入后的像素边界**而不是百分比：相邻两条带共享同一个边界值，
   *    各自取整不会在接缝处漏出一条发丝亮线（百分比会各算各的、在奇数列宽下对不齐）。
   */
  const layoutBands = useCallback(() => {
    const flip = flipRef.current;
    if (!flip) return;
    const W = flip.clientWidth;
    if (!W) return;
    const b = Array.from({ length: BAND_COUNT + 1 }, (_, i) =>
      Math.round((i / BAND_COUNT) * W),
    );
    boundsRef.current = b;
    bandRefs.current.forEach((el, i) => {
      if (!el) return;
      el.style.clipPath = `inset(0 ${W - b[i + 1]}px 0 ${b[i]}px)`;
    });
  }, []);

  /**
   * 把「卷曲量 amount(0..1)」落到每条竖带上。
   *
   * 模型：整张纸弯成一段**圆弧**，弧长恒等于纸宽 W，总圆心角 φ = CURL_MAX × amount。
   * 于是半径 R = W/φ；离书脊 s 处的点在弧上的角 α = s·φ/W，其
   *   · 位置   P = (R·sinα, 0, ±R·(1−cosα))   —— 正号 = 往读者这边鼓
   *   · 切向角 该条带自身要转 −α（往纸背鼓时取反），**绕主对角线**转（见下）
   * α=0 处 P=(0,0,0)、转角 0 —— **圆弧在书脊处与纸面平切**，所以纸始终"钉在书脊上"，
   * 不会整张飘起来。这一点是它比"整体平移 + 旋转"更像真纸的关键。
   *
   * 折线方向：每条带绕的**不是竖直轴**（`rotateY`），而是纸的**主对角线**
   * （左下角 → 右上角）。这是用户那条「要从右下向左上卷」的落点 —— 折线一斜，
   * 离折线最远的右下角就抬得最多，翻起来才有"捏住右下角往左上掀"的手感。
   * 具体推导见下面 `ax / ay` 那段注释。
   *
   * 每条带是个**满幅**的纸面副本（inset:0），所以：
   *   transform-origin 取该带中心 s_c，先绕中心转，再用 translate3d 把它送到 P(s_c)。
   *   transform 列表里 translate3d 必须在最左（父级坐标系里的落位），写进 rotate 后面
   *   就变成"带子自己坐标系里的方向"了 —— 和 .mjp 画廊那边踩的是同一个坑。
   */
  const applyCurl = useCallback((amount: number) => {
    const flip = flipRef.current;
    const b = boundsRef.current;
    if (!flip || b.length < 2) return;
    const W = flip.clientWidth;
    const H = flip.clientHeight || 1;
    if (!W) return;
    /* 折线方向 —— 这条就是"从右下向左上卷"的全部来源。
       用户原话：「翻页效果要从右下向左上卷一点翻过去的效果」。
       原来每条带绕**竖直轴**转（`rotateY`，等价于 rotate3d(0,1,0)），折线是竖的，
       纸只会从右往左"倒"过去，没有斜向的手感。
       换成绕**主对角线**转：轴 = (W, −H) 归一化 —— 这条线正是从左下角连到右上角，
       于是离折线最远的地方就是**右下角**，它抬得最多、往读者这边鼓得最狠，
       整张纸读起来就是"捏着右下角往左上翻"。轴里天然带着竖直分量（0.46），
       所以原来的竖直翻转也没丢，是两者的混合。
       ⚠️ 轴必须归一化，rotate3d 不会替你归一（不归一角度会失真）。 */
    const diag = Math.hypot(W, H) || 1;
    const ax = W / diag;
    const ay = -H / diag;
    const sign = curlRef.current;
    const phi = CURL_MAX * amount;
    const R = phi > 1e-4 ? W / phi : Infinity;
    const sinPhi = Math.sin(phi) || 1;
    bandRefs.current.forEach((el, i) => {
      if (!el || b[i] === undefined) return;
      if (!Number.isFinite(R)) {
        // φ→0 = 完全摊平：连 transform 都不写，免得留下 `rotate3d(...,0rad)` 这种无谓的合成层
        el.style.transform = 'none';
        el.style.setProperty('--sheen', '0');
        return;
      }
      const sc = (b[i] + b[i + 1]) / 2;
      const a = (sc / W) * phi;
      const px = R * Math.sin(a);
      const pz = sign * R * (1 - Math.cos(a));
      const th = -sign * a;
      el.style.transformOrigin = `${sc}px 50%`;
      el.style.transform = `translate3d(${(px - sc).toFixed(2)}px, 0, ${pz.toFixed(2)}px) rotate3d(${ax.toFixed(4)}, ${ay.toFixed(4)}, 0, ${th.toFixed(4)}rad)`;
      /* 卷起来那一段受光更多 —— 一道很淡的高光顺着折线从书脊扫向自由边。
         只给剪影形状的话，静帧里"弧面"和"平移过的平面片"其实不好分辨，
         这层高光是"一眼看出纸是弯的"最省事也最有效的一笔。 */
      el.style.setProperty('--sheen', (0.16 * amount * (Math.sin(a) / sinPhi)).toFixed(4));
    });
  }, []);

  const flipTo = useCallback(
    (target: number, dir: 1 | -1) => {
      if (flippingRef.current || closing || target === page) return;
      if (target < 0 || target >= TOTAL) return;
      const el = flipRef.current;
      const turn = turnRef.current;
      if (!el || !turn) {
        setPage(target);
        return;
      }
      flippingRef.current = true;
      dirRef.current = dir === 1 ? -1 : 1;
      curlRef.current = dir === 1 ? 1 : -1;
      const sign = dirRef.current;
      layoutBands();
      el.classList.add('is-flipping');
      /* 用同一个代理量 p 同时驱动「公转」和「卷曲」。
         卷曲走 curlBump(p)：平台型曲线，见模块顶上那段注释 ——
         关键是让"弯满"落在纸还朝着读者的时候，而不是它转到 54° 最侧的那一瞬。 */
      const st = { p: 0 };
      gsap
        .timeline({
          onComplete: () => {
            pendingRef.current = target;
            setPage(target); // 侧棱朝人时换内容，看不见换页瞬间
          },
        })
        .to(shadeRef.current, { opacity: 0.4, duration: 0.3, ease: EASE.in }, 0)
        .to(
          st,
          {
            p: 1,
            duration: 0.44,
            ease: EASE.in,
            onStart: () => gsap.set(turn, { transformOrigin: 'left center', rotationY: 0 }),
            onUpdate: () => {
              gsap.set(turn, { rotationY: sign * 108 * st.p });
              applyCurl(curlBump(st.p));
            },
          },
          0,
        );
    },
    [page, closing, applyCurl, layoutBands],
  );

  /* 新页挂载（paint 前）：从 108° 转回 0°、卷曲同步收平，阴影随之淡出。
     onStart / onUpdate 里必须**先把新页摆回 108° 起点再往回走** —— 否则会先在
     0° 闪一帧新内容。 */
  useLayoutEffect(() => {
    if (pendingRef.current === null) return;
    pendingRef.current = null;
    const el = flipRef.current;
    const turn = turnRef.current;
    if (!el || !turn) {
      flippingRef.current = false;
      return;
    }
    const sign = dirRef.current;
    gsap.set(turn, { transformOrigin: 'left center', rotationY: sign * 108 });
    applyCurl(0);
    gsap.fromTo(
      shadeRef.current,
      { opacity: 0.4 },
      { opacity: 0, duration: 0.55, ease: EASE.world },
    );
    const st = { p: 0 };
    gsap.to(st, {
      p: 1,
      duration: 0.56,
      ease: EASE.world,
      onUpdate: () => {
        gsap.set(turn, { rotationY: sign * 108 * (1 - st.p) });
        applyCurl(curlBump(st.p));
      },
      onComplete: () => {
        el.classList.remove('is-flipping');
        gsap.set(turn, { clearProps: 'transform,transformOrigin' });
        applyCurl(0);
        flippingRef.current = false;
      },
    });
  }, [page, applyCurl]);

  /* 挂载 / 改尺寸时重新量一次带子边界（clip-path 是 px，viewport 一变就得重算），
     并把纸摆回完全摊平的状态。 */
  useLayoutEffect(() => {
    if (!mounted) return;
    layoutBands();
    applyCurl(0);
    const onResize = () => {
      layoutBands();
      applyCurl(0);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mounted, layoutBands, applyCurl]);

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

  /* Esc = 关本子回工作室。走全站统一的 Esc 栈（@/lib/escape-stack）——
     这一页可能盖在别的浮层之上，只有"栈"能保证一次按键只关最上面那层。 */
  useEscape(onClose, mounted);

  /* ←/→ 翻页。不是 Esc，照旧挂在普通监听上。 */
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') flipTo(page + 1, 1);
      else if (e.key === 'ArrowLeft') flipTo(page - 1, -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, flipTo, page]);

  if (!mounted) return null;

  const entry = page > 0 ? DIARY_ENTRIES[page - 1] : null;

  /**
   * 纸面内容（封面 / 日记页）—— 写一份描述，由 12 条竖带各渲染一次。
   * React 元素是不可变的描述对象，同一个元素用在多个位置是安全的（React 内部自己 clone）；
   * 里面的 `<img src>` 也是同一个 URL，走同一份解码缓存，不会真下 12 遍。
   * 抽出成变量的唯一原因是**别把这段 JSX 复制 12 份**在 return 里。
   */
  const sheet =
    page === 0 ? (
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
    );

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
          {/* 点阵花朵 / 星 / 花体字母（2026-09-17 / 用户第 1 条"美化子页面"）。
              挂在**同一层**里（.diary-watermarks 是 z 0、纸面内容的 .diary-flip 是 z 1）：
              于是它和手写水印同属"纸的底纹"，永远在字下面。
              摆位刻意避开上面那四个水印的位置，免得两套字叠在一起。 */}
          <PageDecor variant="diary" />
        </div>

        {/* 翻页层（2026-09-16 第三轮：真·卷曲）——
            flip（透视 + 裁切）＞ turn（整页绕左书脊公转）＞ band×N（每条各自自转 = 弯曲）＞ sheet。
            这 N 条带各渲染**同一份** sheet：各自 clip 出自己那一条，再各自绕自己转一小角，
            合起来就是一段连续弧面。单个元素做不到 —— 仿射变换下平面矩形永远弯不起来。 */}
        <div className="diary-flip" ref={flipRef}>
          <div className="diary-turn" ref={turnRef}>
            {Array.from({ length: BAND_COUNT }).map((_, bi) => (
              <div
                className="diary-band"
                key={bi}
                ref={(el) => {
                  bandRefs.current[bi] = el;
                }}
                /* 只有第 0 条留给无障碍：其余 11 条是同一张纸的视觉切片，
                   不 aria-hidden 的话读屏会把整篇日记念 12 遍。 */
                aria-hidden={bi === 0 ? undefined : true}
              >
                <div className="diary-sheet" key={page}>
                  {sheet}
                </div>
                <span className="diary-band-sheen" aria-hidden="true" />
              </div>
            ))}
          </div>
          {/* 翻页时的动态阴影：翻出加深、翻入淡出。
              **不放进 .diary-turn** —— 它是屏幕空间的一层遮罩，跟着纸一起转会变成
              "纸面上有块黑斑跟着一起转"。 */}
          <div className="diary-shade" ref={shadeRef} aria-hidden="true" />
        </div>

        {/* 底部中间页码（保留手账页码；翻页键 2026-09-16 按用户要求改成圆圈箭头，
            位置见 .diary-nav 的注释 —— 第三轮已从"半出页面外"收进纸内 20px） */}
        <div className="diary-pager">
          <span className="diary-pager-num">
            {pad2(page + 1)} / {pad2(TOTAL)}
          </span>
        </div>

        {/* 圆圈右箭头 = 下一页：钉在本子右下角（收在纸面内侧，见 .diary-nav 注释） */}
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

      {/* 左上进度胶囊（参考示例 3/5 Notes 的位置）。
          2026-09-16：往下挪了 52px —— 顶上那条让给统一外壳的「RETURN TO STUDIO」
          了（第一档改造 ①），原来它俩会正面撞上。 */}
      <div className="diary-progress">
        <span className="diary-progress-num">
          {pad2(page + 1)}/{pad2(TOTAL)}
        </span>
        <span className="diary-progress-unit">篇</span>
      </div>

      {/* 统一外壳（第一档改造 ①）：左上「RETURN TO STUDIO」+ 右上「MENU」。
          原来右上那颗 ✕ 交还给外壳的 MENU —— 四个物件从此共用同一套退出口。
          遮罩点击 / Esc 仍然可以关。
          tone=dark：线圈本的纸面几乎铺满全屏，奶白字压在纸上会直接看不见
          （实测截图确认过，不是想当然）。 */}
      <StudioChrome label="Return to Studio" onBack={onClose} tone="dark" />
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
