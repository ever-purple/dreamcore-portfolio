import { useEffect, useRef, useState } from 'react';
import { EASE } from '@/lib/ease';
import { HOME_FIRST_FRAME } from '@/lib/placeholderFrames';
import gsap from 'gsap';

interface HomeSectionProps {
  /** 稀疏数组：没加载到的位置是空槽，绘制端自行跳过并「停住不动」 */
  images: HTMLImageElement[];
  /** 首个窗口就绪。滚动动画用它当门禁 —— 不能用「全部下完」，那要等 64MB 才动 */
  ready: boolean;
  entered: boolean;
  onOpen: () => void;
  /** 通知外层「我滚到第几帧了」，用于驱动窗口式预加载 */
  onFrameFocus: (frame: number) => void;
  setDownBlocked: (blocked: boolean) => void;
  /**
   * 帧定案计数器：每有一张帧加载成功/失败就 +1（见 useWindowedFrames.revisionRef）。
   * tick 靠它知道「有迟到的帧到了」并补画一次 —— 否则下面那条「进度不变就不重绘」
   * 的门禁会让迟到的帧**永远画不出来**（门永远不开的根因）。
   */
  framesRevision: { current: number };
}

const TOTAL_FRAMES = 120;
// OPEN / bell trigger at 90% scroll progress
const THRESHOLD_FRAME = Math.floor(0.9 * (TOTAL_FRAMES - 1)); // 107

// 帧过渡平滑系数：越大越跟手，越小越"滑"。14 ≈ 70ms 时间常数，
// 配合下面的 1-exp(-k·dt) 做帧率无关的指数跟随，丝滑且不拖影。
const SMOOTH_K = 14;

// 站点级单例：铃声音频在整个会话内常驻，组件卸载后也能播完，保证用户一定听到
let sharedBell: HTMLAudioElement | null = null;
function getBell(): HTMLAudioElement {
  if (!sharedBell) {
    sharedBell = new Audio('/bell.mp3');
    sharedBell.preload = 'auto';
  }
  return sharedBell;
}

export function HomeSection({
  images,
  ready,
  entered,
  onOpen,
  onFrameFocus,
  setDownBlocked,
  framesRevision,
}: HomeSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const targetProgressRef = useRef(0);
  const displayedRef = useRef(0);
  // 是否已经真的往 canvas 上画过一次。
  // 静止时 tick 认为「进度没变」就不重绘，若此刻首帧还没解码完，canvas 会一直
  // 保持纯黑（实测进首页后黑屏约 2 秒）。用它保证「只要画得出来就一定画一次」。
  const paintedRef = useRef(false);
  /** 上一次重绘时的「帧定案版本号」。版本变了 → 有迟到的帧到了 → 补画一次 */
  const paintedRevisionRef = useRef(-1);
  /**
   * 内联兜底帧 —— 用户明确要求的「垫一帧」。
   * 第一张真帧还没解码完时画它，绝不让 canvas 停在纯黑。
   * 它是打包进 JS 的 data URI，零请求、零等待（见 lib/placeholderFrames.ts）。
   */
  const fallbackRef = useRef<HTMLImageElement | null>(null);
  const lastTsRef = useRef(0);
  const dimsRef = useRef({ width: 0, height: 0, dpr: 1 });
  const atEndRef = useRef(false);
  const wasAtThresholdRef = useRef(false);
  const lastFocusRef = useRef(-1);
  const bellRef = useRef<HTMLAudioElement | null>(null);
  const portfolioRef = useRef<HTMLDivElement>(null);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const portfolioLineRef = useRef<HTMLSpanElement>(null);

  const [showOpen, setShowOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Prepare the bell sound (played on OPEN click — a guaranteed user gesture)
  useEffect(() => {
    bellRef.current = getBell();
  }, []);

  /**
   * 内联兜底帧：mount 时就建好。
   * data URI 的解码在当前任务后完成，而下面的 tick 每帧都会重试（`!paintedRef.current`），
   * 所以最迟第 2 帧就能画上 —— 相对网络上的第 1 帧（冷缓存要 0.15~1s）是数量级的提前。
   */
  useEffect(() => {
    const img = new Image();
    img.src = HOME_FIRST_FRAME;
    fallbackRef.current = img;
    return () => {
      fallbackRef.current = null;
    };
  }, []);

  // cover-fit 矩形：基于画布尺寸与单帧宽高比
  const getRect = (img: HTMLImageElement) => {
    const { width, height } = dimsRef.current;
    const canvasAspect = width / height;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    let drawW: number, drawH: number, drawX: number, drawY: number;
    if (imgAspect > canvasAspect) {
      drawH = height;
      drawW = height * imgAspect;
      drawX = (width - drawW) / 2;
      drawY = 0;
    } else {
      drawW = width;
      drawH = width / imgAspect;
      drawX = 0;
      drawY = (height - drawH) / 2;
    }
    return { drawW, drawH, drawX, drawY };
  };

  // Resize canvas to match viewport at device pixel ratio
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (dimsRef.current.width === width && dimsRef.current.height === height && dimsRef.current.dpr === dpr) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    dimsRef.current = { width, height, dpr };

    drawCrossfade(displayedRef.current);
  };

  // 找「当前进度之前、最近一张已下完的帧」做兜底：冷加载（首访 / CDN 冷）时后面的帧
  // 还没流到，用最近的已下载帧绘制，推镜就会一直往前走、而不是卡在开头几帧 —— 否则
  // 看起来就是「一下就到」、时好时坏（缓存热了才正常）。热路径（全下完）下这个兜底
  // 恒等于原帧号，行为完全不变。
  const nearestLoadedLE = (idx: number): number => {
    for (let i = Math.max(0, idx); i >= 0; i -= 1) {
      const im = images[i];
      if (im && im.naturalWidth > 0) return i;
    }
    return -1;
  };

  /**
   * 「已缓冲前沿」：从第 0 帧起**连续**就绪的最深一帧（-1 = 一张都没有）。
   *
   * ---------------------------------------------------------------------------
   * 为什么需要它（2026-09-29 20:15 用户录屏：「中间滚动动画断了、直接跳到门开」）
   * ---------------------------------------------------------------------------
   * 上面那个 `nearestLoadedLE` **只向下兜底**，而帧是按优先级**乱序**到位的
   * （首窗 1-8 + 末窗 105-120 先来，中间最后到）。于是：
   *
   *     目标滚到第 66 帧 → 最近就绪的还在第 47 帧 → 画面**冻住**
   *     目标滚到第 103 帧 → 仍然冻在第 49 帧（约 0.7 秒画面完全不动）
   *     目标第 110 帧 → 末窗到了 → **一步跳 61 帧**（= 直接跳到「门开」）
   *
   * 实测轨迹（`_verify-load-fix.mjs` G6，3.5 Mbps，`目标→显示`）：
   *     `0→0  29→29  66→47  89→49  103→49  110→110`
   *
   * **这是「末窗优先」这个优化引入的副作用**：它保住了结局帧，代价是中间帧被推后，
   * 而只向下兜底的取帧逻辑把「中间没到」放大成了「冻住 + 跳过去」。
   *
   * ---------------------------------------------------------------------------
   * 修法：把影片位置夹到前沿上 —— 影片只能播到已经缓冲的地方
   * ---------------------------------------------------------------------------
   * 用户滚得再快，画面也**不会越过前沿**；前沿随下载推进，影片就跟着**连续**推进。
   * 最坏情况从「冻住再跳」退化成「推镜走得慢」——这是诚实的、可接受的降级。
   * 全部帧到齐后前沿 = 末帧，夹取完全不生效，行为与优化前逐像素一致
   * （**热访问零影响**，而帧 URL 带 `immutable` 一年，回访就是热访问）。
   *
   * ⚠️ 上面三处（Portfolio 文案 / OPEN 按钮 / 到底拦截）**必须**跟着夹取后的
   * `film` 走、而不是跟着原始滚动位置走，否则会出现「影片还在 30%，Open 已经冒出来」。
   */
  const bufferedProgress = (): number => {
    let i = 0;
    const n = images.length;
    for (; i < n; i += 1) {
      const im = images[i];
      if (!im || im.naturalWidth === 0) break;
    }
    return i === 0 ? 0 : (i - 1) / (TOTAL_FRAMES - 1);
  };

  // 帧间溶解绘制：相邻两帧按小数权重叠加，消灭逐帧硬切的阶梯感
  // 返回是否真的画上去了（false = 连一张能用的帧都没有，canvas 还是黑的）
  const drawCrossfade = (progress: number) => {
    const canvas = canvasRef.current;
    if (!canvas || images.length === 0) return false;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return false;

    const { dpr } = dimsRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const N = images.length - 1;
    const f = Math.max(0, Math.min(N, progress * N));
    const i0 = Math.floor(f);
    // 兜底帧：冷加载时 i0 可能还没下完，落到最近已就绪的那张，避免整段冻结
    const i0r = nearestLoadedLE(i0);

    // 连一张真帧都没有 → 画内联兜底帧（「垫一帧」）。
    // 这个窗口在慢网下是真实存在的：线上实测第 1 帧 62KB / 链路 430 KB/s ≈ 0.15s，
    // 而「首访冷缓存」时首窗那 8 张要 1~2 秒 —— 原来这里直接 return false，
    // canvas 就停在纯黑，用户看到的「背景出不来」正是这一段。
    if (i0r < 0) {
      const fb = fallbackRef.current;
      if (!fb || fb.naturalWidth === 0) return false; // 兜底帧本身还没解码好，下一帧再试
      const rf = getRect(fb);
      ctx.globalAlpha = 1;
      ctx.drawImage(fb, rf.drawX, rf.drawY, rf.drawW, rf.drawH);
      return true;
    }

    const img0 = images[i0r];
    const t = f - i0r; // 相对兜底帧的小数进度
    const i1 = Math.min(N, i0r + 1);
    const r0 = getRect(img0);
    ctx.globalAlpha = 1;
    ctx.drawImage(img0, r0.drawX, r0.drawY, r0.drawW, r0.drawH);

    // 下一帧若已就绪就做溶解过渡；未就绪则只画当前兜底帧（仍随进度往前走）
    const img1 = images[i1];
    if (img1 && img1.naturalWidth > 0 && t > 0.001) {
      const r1 = getRect(img1);
      ctx.globalAlpha = Math.min(1, t);
      ctx.drawImage(img1, r1.drawX, r1.drawY, r1.drawW, r1.drawH);
    }
    ctx.globalAlpha = 1;
    return true;
  };

  // 滚动驱动：逻辑用原始进度（响应即时），视觉用帧率无关指数平滑（丝滑）
  useEffect(() => {
    if (!entered || !ready || !containerRef.current) return;

    const container = containerRef.current;

    const computeProgress = () => {
      const rect = container.getBoundingClientRect();
      const maxScroll = rect.height - window.innerHeight;
      const raw = maxScroll > 0 ? -rect.top / maxScroll : 0;
      return Math.max(0, Math.min(1, raw));
    };

    // "Portfolio" fades in at 10%, fully out before OPEN appears (90%)
    const updatePortfolio = (p: number) => {
      const el = portfolioRef.current;
      if (!el) return;
      const IN_START = 0.10, IN_END = 0.22;
      const OUT_START = 0.80, OUT_END = 0.88;
      let o = 0;
      if (p <= IN_START || p >= OUT_END) o = 0;
      else if (p >= IN_END && p <= OUT_START) o = 1;
      else if (p < IN_END) o = (p - IN_START) / (IN_END - IN_START);
      else o = 1 - (p - OUT_START) / (OUT_END - OUT_START);
      el.style.opacity = String(Math.max(0, Math.min(1, o)));
      el.style.transform = `translateY(${(p - 0.5) * -28}px)`;

      // 遮罩上滑揭示
      const line = portfolioLineRef.current;
      if (line) line.classList.toggle('is-revealed', o > 0.02);
    };

    const tick = (now: number) => {
      const dt = lastTsRef.current ? Math.min((now - lastTsRef.current) / 1000, 0.05) : 0.016;
      lastTsRef.current = now;
      // 「影片位置」= min(滚动位置, 已缓冲前沿)。下面 Portfolio / OPEN / 滚轮拦截
      // 全部读这个值 —— 影片还没播到那儿，就不该出现那儿的 UI。见 bufferedProgress()。
      const scrollP = computeProgress();
      const buffered = bufferedProgress();
      const raw = Math.min(scrollP, buffered);
      targetProgressRef.current = raw;

      updatePortfolio(raw);

      const targetFrame = Math.floor(raw * (TOTAL_FRAMES - 1));
      // 告诉预加载器「我大概在第几帧」，它据此展开前后窗口
      if (targetFrame !== lastFocusRef.current) {
        lastFocusRef.current = targetFrame;
        onFrameFocus(targetFrame);
      }
      // 「滚轮只推进到已缓冲处」—— 用户选的「锁住滚动」。
      //
      // 为什么需要：影片位置被夹到前沿之后，用户仍然可以把**滚动位置**甩到底
      // （Lenis 自己的 1.15s 缓动就能带过去）。那样输入和画面就脱节了 ——
      // 观感是「我早就甩到底了，画面还在自己慢慢往前推」，像坏了。
      // 所以在「滚动位置已经追上缓冲前沿」时拦掉继续向下的滚轮，
      // 让两者**始终 1:1**：用户跟着影片走，影片走多快由带宽决定。
      //
      // 复用 App 里已有的那条 `virtualScroll` 拦截（只挡 deltaY > 0，向上永远放行）。
      // 全部帧到齐时 buffered = 1，这条退化成原来的「滚到 100% 处拦截」。
      // `buffered > 0` 是安全阀：帧全 404 时前沿恒为 -1，若照样拦就会把用户
      // 永久锁死在首页（此时宁可让他滚到底看内联兜底帧）。
      const caughtUp = buffered > 0 && scrollP >= buffered - 1e-4;
      if (caughtUp !== atEndRef.current) {
        atEndRef.current = caughtUp;
        setDownBlocked(caughtUp);
      }

      // OPEN button appears at 90% (the bell now rings on OPEN click, see handleOpen)
      const atThreshold = targetFrame >= THRESHOLD_FRAME;
      if (atThreshold && !wasAtThresholdRef.current) {
        setShowOpen(true);
      } else if (!atThreshold && wasAtThresholdRef.current) {
        setShowOpen(false);
      }
      wasAtThresholdRef.current = atThreshold;

      // 帧率无关指数平滑：displayed 跟随 raw，但每帧只走 1-exp(-k·dt) 的比例，
      // 任何帧率下观感一致，且不会因掉帧而阶跃。
      const prev = displayedRef.current;
      displayedRef.current += (raw - prev) * (1 - Math.exp(-SMOOTH_K * dt));
      // 三个重绘条件，缺一不可：
      //   ① 进度真的变了（正常滚动）；
      //   ② 还没成功画过一次（进首页时的黑屏保护）；
      //   ③ **帧定案版本变了** —— 说明有迟到的帧刚到。
      // ③ 是必须的：平滑后的 displayed 会无限逼近 raw，用户一停手 ① 就恒为假，
      // 此时若「滚到的那一帧」才刚下完，它永远等不到一次重绘 ——
      // 表现就是「滚到最后还是那张糊帧」「门开露黄光死活不出现」。
      const rev = framesRevision.current;
      if (
        Math.abs(displayedRef.current - prev) > 1e-4 ||
        !paintedRef.current ||
        rev !== paintedRevisionRef.current
      ) {
        if (drawCrossfade(displayedRef.current)) {
          paintedRef.current = true;
          paintedRevisionRef.current = rev;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    // Blocking further DOWN scrolling at 100% is handled by Lenis (virtualScroll hook)

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    // 复位「到底拦截向下」。这个标志住在 App 里、跨 HomeSection 挂载存活，
    // 从工作室回来时若还留着上次到底置的 true，整个首页就再也滚不动了
    // （HomeSection 只在 atEnd 变化时才下发复位，重挂载后两边都是 false 就永远不复位）。
    atEndRef.current = false;
    setDownBlocked(false);
    displayedRef.current = Math.min(computeProgress(), bufferedProgress());
    if (drawCrossfade(displayedRef.current)) paintedRef.current = true;
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(rafRef.current);
    };
  }, [entered, ready, images, setDownBlocked, onFrameFocus]);

  // 待机呼吸：房间在静止时也缓慢缩放，像在"呼吸"，消除死板感
  useEffect(() => {
    if (!entered || !ready || !canvasRef.current) return;
    const tween = gsap.to(canvasRef.current, {
      scale: 1.02,
      duration: 6,
      ease: EASE.io,
      yoyo: true,
      repeat: -1,
      transformOrigin: 'center center',
    });
    return () => { tween.kill(); };
  }, [entered]);

  // OPEN 按钮：GSAP 弹性入场 + 磁吸跟随
  useEffect(() => {
    if (!showOpen) return;
    const btn = openBtnRef.current;
    const inner = innerRef.current;
    if (!btn || !inner) return;

    // 用 GSAP 接管 transform 来居中，替代 Tailwind 的 -translate
    gsap.set(btn, { xPercent: -50, yPercent: -50 });
    const enter = gsap.fromTo(
      btn,
      { opacity: 0, scale: 0.85 },
      { opacity: 1, scale: 1, duration: 0.6, ease: EASE.pop },
    );

    const onMove = (e: MouseEvent) => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist < 180) {
        gsap.to(btn, { x: dx * 0.3, y: dy * 0.3, duration: 0.4, ease: EASE.world });
      } else {
        gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: EASE.world });
      }
    };
    const onLeave = () => gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: EASE.world });

    inner.addEventListener('mousemove', onMove);
    inner.addEventListener('mouseleave', onLeave);
    return () => {
      enter.kill();
      inner.removeEventListener('mousemove', onMove);
      inner.removeEventListener('mouseleave', onLeave);
    };
  }, [showOpen]);

  const handleOpen = () => {
    // 点击 OPEN 是用户手势，播放铃声一定被允许
    const a = bellRef.current;
    if (a) {
      a.currentTime = 0;
      a.play().catch(() => {});
    }
    // 旧页面先淡出（300ms），快消失时由 App 的 flash 白光接手
    setLeaving(true);
    window.setTimeout(onOpen, 350);
  };

  return (
    <section id="home" ref={containerRef} className="relative h-[300vh]">
      <div
        ref={innerRef}
        className={`sticky top-0 h-screen w-full overflow-hidden bg-[#0a0a0a] transition-opacity duration-300 ${
          leaving ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* 画面层 = 这只 canvas（120 帧门厅推镜）。2026-09-16：
            ① `world-grade` 是"日剧调色滤镜"的挂点 —— 只作用于**画面**，
               不碰纸面（见 index.css 的 .world-grade）；
            ② 这套 120 帧 jpg 本身的色彩已经很重（实测那扇门 #540808，
               饱和度 82%），滤镜要把它们统一压到日剧那种低饱和暖调里。 */}
        <canvas
          ref={canvasRef}
          className="world-grade absolute inset-0 w-full h-full"
          style={{ willChange: 'transform', transform: 'translateZ(0)' }}
          aria-label="Scroll-driven room animation"
        />

        {/* Dark vignette overlay */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.4)_100%)]" />

        {/* "Portfolio" — 遮罩上滑揭示 + 淡入，10% 进场、90% 前离场 */}
        <div
          ref={portfolioRef}
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          style={{ opacity: 0 }}
        >
          {/* 配色沿革（三轮，结论见第三轮）：
              ① 初版霓虹青 #76F0CA
              ② 换 --pal-mint（当时那支鼠尾草绿，2026-09-17 已校正为 #b5e3d6）→ 用户"不好看"
              ③ 换 --pal-paper #e8e6e0 奶油白 + 暗投影（怕 16vw 饱和色变成"海报贴纸"）
              ④ **2026-09-16 晚（现行）：用户指定「换成原来的薄荷绿」**，
                 并在两种薄荷里明确选了**原版霓虹薄荷 #7ee8c7**
                 —— 于是 ③ 的判断被推翻，回到荧光绿。
              ⑤ **2026-09-16 深夜：投影整个去掉**（用户指截图原话：「字周围有矩形阴影，
                 而且字好像也有阴影，去掉」）。
                 根因是 .reveal-mask 带 `overflow: hidden`（那是给遮罩上滑揭示用的），
                 它按 **padding box 裁剪** —— 44px 模糊的投影铺得比盒子宽，被裁出**直角边**，
                 于是"字形的柔和投影"看起来成了"一圈矩形阴影"。字本身的投影是同一个值。
                 去掉后两个症状一起消失：投影是唯一来源，不需要分别处理。
                 代价：薄荷字压在亮奶油墙上对比度变低。用户明确要纯净字形，就这样。 */}
          <span className="reveal-mask" style={{ fontSize: '16vw' }}>
            <span
              ref={portfolioLineRef}
              className="reveal-line font-jheri text-[color:var(--pal-mint-neon)] leading-[1.15] select-none whitespace-nowrap"
            >
              Portfolio
            </span>
          </span>
        </div>

        {/* OPEN button at the center of the door (appears at 90%)
            2026-09-16 字体统一：原来是 `font-body`（Inter/Noto 无衬线）+ 0.5em 大字距的
            **全大写 ON/OFF 式按钮**，和全站"屏幕外英文 = Caveat 手写体"的规则不符 ——
            进门前后一个是无衬线全大写、一个是手写体，像两个网站。
            改成 Caveat + Title Case「Open」（规则 ②：屏幕外一律 Title Case），
            字号/字距的分寸见 index.css 的 .home-open。 */}
        {showOpen && (
          <button
            ref={openBtnRef}
            onClick={handleOpen}
            className="home-open absolute left-1/2 top-1/2 z-20 flex items-center justify-center px-10 py-3 border border-cream/70 bg-black/30 backdrop-blur-sm text-cream transition-colors duration-500 hover:bg-cream hover:text-wine"
          >
            Open
          </button>
        )}

        {/* Scroll indicator (hidden once OPEN appears) —— 同 OPEN，归 Caveat */}
        {!showOpen && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 text-cream/60">
            <span className="home-scroll">Scroll</span>
            <span className="w-px h-10 bg-cream/40 animate-pulse" />
          </div>
        )}
      </div>
    </section>
  );
}
