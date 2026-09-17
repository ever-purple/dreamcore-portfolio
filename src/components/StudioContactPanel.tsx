import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useEscape } from '@/lib/escape-stack';
import { AsciiFlower } from '@/components/AsciiFlower';
import { PageDecor } from '@/components/PageDecor';

/**
 * 工作室房间 → 向下滚动露出「联系方式」（2026-09-16 第六轮 / 用户第 2 条需求）。
 *
 * ## 需求与参考
 * 用户：把这个房间「向下滚动出现联系方式」，参考两段录屏
 * （`屏幕录制 2026-09-16 173605.mp4` / `174451.mp4`），确认了
 * **面板从下方推上来、有视差地向上出来**，并追加两条：
 *   · **要有阻尼感和滚动视差**  → 见下面「三层三套弹簧」
 *   · **学习 ilcapoproduction.com 的联系方式** → 见下面「版式取自参考站」
 *   · **滚轮滚 12 下才完全出来** → 见 NOTCHES
 *   · **快速划过去后有惯性在的感觉** → 见 INERTIA（额外位移那一层）
 * 配色点名「跟 menu 一样，薄巧色」→ 复用菜单那套：巧克力底 `--pal-veil` + 薄荷字 `--pal-mint`。
 *
 * ## 版式取自参考站（ilcapoproduction.com/project/notes-on-gucci 的页脚）
 * 扒了那页的 HTML，它的联系区块长这样（文案原样）：
 *     Contacts  / info@ilcapoproduction.com     ← 小标签（15~21px, 无衬线）
 *     Follow    / @ilcapo_production            ← 值（**32~45px, 衬线, 全大写**）
 *     ©2026 - P.IVA 02793910395   Credits       ← 底部极小字 + 一条 1px 发丝线
 * 三个可学的点，都落到这里了：
 *   ① **成对排版**：上面一行小标签、下面一行大字，两组并排（`justify-around`），
 *      而不是"标签在左、值在右"的表格感；
 *   ② **大字是全大写衬线**，而且是主角 —— 参考站的邮箱/账号比标签大 2~3 倍；
 *   ③ **逐字上浮**：它每个字母都包在 `relative inline-block overflow-hidden` 里，
 *      内层再位移 —— 这正是"从下往上出来"的最小单位。这里做成
 *      **滚轮进度驱动**（不是 hover 触发），每个字包在 overflow:hidden 里、
 *      用各自的系数错峰升上来；顺带用 `py-[0.25em] -my-[0.25em]` 抵消裁切吃掉的
 *      上下沿（参考站也这么干的），否则中文的下半截会被切掉。
 *
 * ## 阻尼与视差：三层三套弹簧（这是"有阻尼感"和"真视差"的落点）
 * 只有一个主量 + 静态倍率，只能做出"整体平移"的观感。真正的视差要有**速度差**：
 * 近的东西先到、远的东西还在路上 —— 也就是每层自己的**惯性**。
 * 所以给同一份滚轮输入跑了**三套弹簧**（参数是数值模拟挑的，不是手感瞎调）：
 *
 *   变量           层            刚度/阻尼        到位(t99)  过冲   角色
 *   --contact-pi   正文 / 逐字   0.023 / 0.85     0.28s     12%    最轻 → **抢在纸前面**
 *   --contact-p    巧克力纸      0.010 / 0.88     0.50s      6%    主体位移
 *   --contact-pg   幽灵大字      0.004 / 0.915    0.87s      4%    最重 → **落在纸后面**
 *
 * 到位时间差 3 倍，所以"纸已经停了、幽灵大字还在往上走"是能看见的 —— 这就是滚动视差；
 * 三层都是弹簧（不是线性映射），所以松手后还有惯性、不是硬停 —— 这就是阻尼感。
 * ⚠️ 三层收到的是**同一份** target，最终必定一起落到同一个值（p=1 时所有额外偏移归零 →
 *    **静态排版就是设计稿本身**，不需要另一套"停止态"样式）。
 *
 * ## 滚轮要滚几格（用户："滚轮有 12 格才完全出现"）
 * `NOTCHES = 12`，每"下"推进 1/12。
 * ⚠️ **"一下"是按事件数数的，不是按 deltaY 累积的** —— 这条是踩过坑才改的：
 *    第一版按"累积满 100px = 一格"，结果同一段代码在不同鼠标上得出 5 格 / 10 格
 *    两种答案（一次滚动的 `deltaY` 根本不统一：100 / 120 / 53 / 50 都见过），
 *    用户实测说"不是五格，一共 10 格"就是撞上了这个。现在的规则：
 *      · 单次事件幅度 ≥ NOTCH × 0.45 → 直接算**一整格**（各档位鼠标都对得上"一下 = 一格"）；
 *      · 幅度更小的碎事件（触控板 / 惯性平滑滚动）→ 先累加零头，攒够一格的量才走一格。
 * ⚠️ 不管走哪条路，**每个事件最多只走一格**：不然甩一下就到底了 ——
 *    用户要的是"有阻力、要滚几下"，不是"一甩就到"。
 *
 * ## 为什么不能靠原生滚动
 * 工作室房间是 `h-screen` + `overflow-hidden`（整屏房间、没有可滚内容），
 * 而且 App 在 studio 这一档会 `lenis.stop()`。所以这里的"滚动"是**自己攒的**：
 * 把 wheel 的 deltaY 累加进一个 0..1 的主量，再由主量驱动位移 ——
 * 本质是"滚轮驱动的进度条"，不是页面滚动。好处是松手就能自然停住，
 * 也永远不会把房间顶出去。
 *
 * ## 三个坑（都写在这里，别改回去）
 *  1. **只在真的要动的时候 `preventDefault`**：p 已经是 1 还往下滚、或 p 是 0 还往上滚，
 *     都不该吃掉事件 —— 否则会出现"滚轮莫名其妙失灵"的体感。
 *  2. **滚轮监听要挂捕获阶段**：App 那个全局 Lenis 也听 window 上的 wheel。
 *     捕获阶段先跑，处理时 `stopPropagation` 才能保证它不跟着一起动。
 *  3. **`blocked` 时不接滚轮**：菜单 / 线圈本 / 木马 / 落地页盖在上面时，
 *     滚轮归它们；而且一旦被盖住就主动把面板收回去。
 *
 * ## 调试（沿用 `?lensreveal=` / `?roompar=` 的约定）
 *   `?contact=0.6`   把三层的**位置**进度一起钉住
 *   `?contactv=0.08` 把三层的**惯性额外位移**一起钉住（只给 contactv 时位置按 1 算）
 * 无头环境里没有滚轮也没有连续的 rAF，只有钉住才能确定性地验证各层位移、
 * 以及 CSS 里那道 `min(1, …)` 夹子到底有没有生效。
 */

type Props = {
  /** 工作室上有别的浮层盖着（菜单 / 线圈本 / 木马 / 报刊亭 / 落地页 / About） */
  blocked: boolean;
};

/**
 * 一"格"的**参考幅度**（px）。⚠️ 只用来做两件事：
 *   ① 判断"这次事件够不够大、算不算一整个物理格"（`NOTCH * NOTCH_BIG`）；
 *   ② 触控板碎事件攒零头、以及触屏换算行程。
 * **不**用来数"滚了几下"（见文件头那段 —— 按 deltaY 累积会在不同鼠标上给出不同答案）。
 */
const NOTCH = 100;
/** 要滚满几格才完全露出 —— 用户："滚轮有 12 格才完全出现" */
const NOTCHES = 12;
/** 幅度达到这个比例就认定"这是一整个物理格"（0.45 是为了兜住 50 / 53 这类小格鼠标） */
const NOTCH_BIG = 0.45;
/** 触屏：手指要滑过的总行程（px），按"10 格 × 100px"折算 */
const TOUCH_TRAVEL = NOTCH * NOTCHES;

/**
 * 三层弹簧。`k` = 刚度，`f` = 每帧速度保留率（越小越黏）。
 * ⚠️ 改这三个数之前先跑一遍 `_springsim2.mjs` 那套模拟：
 *    手调很容易调出"过冲 30%、0.15s 到位"那种又弹又急的曲线（第一版就是）。
 */
const SPRINGS = {
  // ⚠️ 下面的到位时间/过冲是**无头逐帧实测**值（一格阶跃、按帧序，
  //    见 `scripts/verify-contact-panel.mjs` 的 C 段），
  //    不是估算 —— 尤其 ghost 那行，原来手写的"过冲 4%"是错的。
  inner: { k: 0.023, f: 0.85 },  // 第 17 帧到位（284ms@60fps）/ 过冲 11.6%
  sheet: { k: 0.01, f: 0.88 },   // 第 30 帧到位（501ms@60fps）/ 过冲 6.8%
  // ⚠️ ghost 是**过阻尼**：k 只有 0.004、周期约 99 帧，而每帧掉 8.5% 速度 →
  //    根本振荡不起来，实测过冲 -0.4%（= 没有过冲，只是纯粹地慢）。
  //    这正好是"最远层"该有的样子：不弹，只是迟迟不到。
  ghost: { k: 0.004, f: 0.915 }, // 第 52 帧到位（868ms@60fps）/ 无过冲
} as const;

type Spring = { k: number; f: number };

/**
 * ## 惯性（用户："快速划过去后有惯性在的感觉"，2026-09-17 加）
 * 光有"位置弹簧"是不够的：弹簧只负责**追上**滚轮攒出来的 target，滚轮一停它就收工 ——
 * 观感是"停住"，不是"滑过去"。真正的惯性要的是**滚轮停下之后位移还在走**。
 * 所以在上面的位置之外，再叠一层"额外位移"：
 *
 *   · 它的目标**恒为 0**（每帧都往 0 收）→ 静止时的排版与加惯性之前**完全一样**，
 *     不会破坏"静态排版就是设计稿本身"这条不变量；
 *   · 每次滚轮/触屏输入给它一脚**冲量**（滚得越猛、一脚越大，上限 KICK_MAX 倍）；
 *   · 然后它自己按下面的弹簧滑回 0 —— 这一小段"没人推、它自己还在动"就是惯性。
 *
 * 三层的参数是**数值模拟**挑的（不是手感瞎调），刻意让滑行时长排开：
 *
 *   层      k      f      每脚冲量   单格峰值   连滚峰值   滑行时长   角色
 *   inner   0.26   0.84   0.007      ~1.1%     ~1.2%      ~0.63s     最轻 → 先收住
 *   sheet   0.09   0.86   0.010      ~2.3%     ~4.2%      ~0.68s     主体
 *   ghost   0.028  0.925  0.007      ~3.0%     ~9.3%      ~0.75s     最重 → 滑最久
 *
 * 所以"快速滚过去"的时候，纸先稳住、大字还在飘 —— 惯性也参与视差。
 * ⚠️ 弹簧是会**反向摆回来**的：冲量踢出去之后会过零、在负侧小摆一下才归零，
 *    所以别指望"停下后某一刻去看它还很大"（那一刻可能正好在过零点）。
 *    要量惯性只能**逐帧采峰值**，不是停下后抽查。
 * ⚠️ 别把 kick 调大：额外位移是直接加在进度上的，over 1 会顶到顶部边界
 *    （纸那边已经被 CSS 的 min(1, …) 夹住了，正文和幽灵没有，会真的飘出布局）。
 */
const INERTIA = {
  sheet: { k: 0.09, f: 0.86, kick: 0.01 },
  ghost: { k: 0.028, f: 0.925, kick: 0.007 },
  inner: { k: 0.26, f: 0.84, kick: 0.007 },
} as const;

type Inertia = { k: number; f: number; kick: number };

/** 单次输入的冲量最多放大到这个倍数（一格 = 1×，猛甩封顶） */
const KICK_MAX = 2.5;

/**
 * 进度超过这个值就让 `LisaHud` 交出指针事件（用户第 2 条需求连带）。
 * 0.42 = 比"完全消失"的 0.5 早一格：那时遮罩已经把下半截吃掉、只剩顶部两三行，
 * 它不该再吃鼠标。见下面 tick 里的 `rising`。
 */
const POINTER_FREE_AT = 0.42;

type Pair = { label: string; value: string; /** 逐字错峰的起始系数 */ base: number };

/**
 * 两组「小标签 + 大写大字」，照参考站的 Contacts / Follow 两栏。
 * **内容是占位的**（用户："先不做内容，只搭出滚动出现的版式"）——
 * 以后把 `value` 换成真邮箱 / 账号即可，版式与动效都不用动。
 */
const PAIRS: Pair[] = [
  { label: 'Contacts', value: 'EMAIL@—', base: 0 },
  { label: 'Follow', value: '@—', base: 60 },
];

export function StudioContactPanel({ blocked }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  /** 滚轮目标。放 ref 里 —— 每帧都要读写，进 state 会把整棵树重渲 60 次/秒。 */
  const targetRef = useRef(0);
  const openRef = useRef(false);
  const blockedRef = useRef(blocked);

  useEffect(() => {
    blockedRef.current = blocked;
    // 被别的浮层盖住 → 主动收回（见文件头「坑 3」）
    if (blocked) targetRef.current = 0;
  }, [blocked]);

  /** Esc 收回。走全站统一的 Esc 栈，只有面板确实开着时才占用这一次按键。 */
  const retract = useCallback(() => {
    targetRef.current = 0;
  }, []);
  useEscape(retract, open);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    /**
     * 面板所在的整屏容器（.studio-scope）。**为什么要往上写变量**：
     * 这个进度以前只写在 .studio-contact 自己身上，于是**只有它的子树**读得到 ——
     * 而需要跟着这个进度变化的 `LisaHud` 是它的**兄弟**（见 StudioSection）。
     * CSS 自定义属性只往下继承、不横向流，兄弟之间没有通路。
     * 所以主进度额外往 scope 上写一份，全屏任意一层都能 `var(--contact-p)`。
     * ⚠️ 两份都要写：.studio-contact 自己那条规则里声明了 `--contact-p: 0`，
     *    它**盖过继承来的值**，只写 scope 的话纸自己反而不动了。
     */
    const scope = root.closest<HTMLElement>('.studio-scope');

    /**
     * 一层 = 两套弹簧 + 两个变量名：
     *   pos / vel  → 位置进度（追 target）
     *   ex  / evel → 惯性额外位移（目标恒为 0）
     * 两个写入值各自量化去重（鼠标静止时零开销）。
     * `share` = 这一层的进度要不要同时写到 scope 上（只有主体那层需要）。
     */
    const mk = (pos: string, ext: string, sp: Spring, ip: Inertia, share = false) =>
      ({ pos, ext, sp, ip, share, cur: 0, vel: 0, posLast: '', ex: 0, evel: 0, exLast: '' });
    const layers = [
      mk('--contact-p', '--contact-pv', SPRINGS.sheet, INERTIA.sheet, true),
      mk('--contact-pg', '--contact-pgv', SPRINGS.ghost, INERTIA.ghost),
      mk('--contact-pi', '--contact-piv', SPRINGS.inner, INERTIA.inner),
    ];

    /** 写到 scope 的那一份单独去重（和写在 root 上的值同源，但去重键要分开记） */
    let sharedLast = '';

    const write = (l: (typeof layers)[number], which: 'pos' | 'ex', v: number) => {
      const s = (Math.round(v * 1000) / 1000).toFixed(3);
      if (which === 'pos') {
        if (l.posLast === s) return;
        l.posLast = s;
        root.style.setProperty(l.pos, s);
        if (l.share && scope && sharedLast !== s) {
          sharedLast = s;
          scope.style.setProperty('--contact-p', s);
        }
      } else {
        if (l.exLast === s) return;
        l.exLast = s;
        root.style.setProperty(l.ext, s);
      }
    };

    /**
     * 给三层各踢一脚**惯性冲量**。`mag` 是"滚得多快/多猛"的归一化量（1 = 一次标准格）。
     * 这就是"快速划过去后有惯性在的感觉"的源头 —— 见 INERTIA 那段注释。
     */
    const kick = (dir: number, mag: number) => {
      const m = Math.min(KICK_MAX, mag);
      if (m <= 0) return;
      for (const l of layers) l.evel += dir * l.ip.kick * m;
    };

    /**
     * is-contact-rising 上一次的值（只在翻转时写 DOM，不给每帧添一次 classList 调用）。
     * ⚠️ 必须声明在下面的「调试钉值」分支**之前**：那条分支也会写它，
     *    放在后面就是 let 的 TDZ（`Cannot access before initialization`）。
     */
    let risingLast = false;

    /* ---- 调试：把三层一起钉住（见文件头「调试」） ---- */
    const qs = new URLSearchParams(window.location.search);
    const pinPos = qs.get('contact');
    const pinEx = qs.get('contactv');
    if (pinPos !== null || pinEx !== null) {
      const num = (raw: string | null, lo: number, hi: number, dflt: number) => {
        const v = Number.parseFloat(raw ?? '');
        return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
      };
      const p = num(pinPos, 0, 1, 1);      // 位置只在 0..1
      const ev = num(pinEx, -0.5, 0.5, 0); // 惯性额外位移可正可负
      targetRef.current = p;
      layers.forEach((l) => {
        l.cur = p;
        write(l, 'pos', p);
        l.ex = ev;
        write(l, 'ex', ev);
      });
      openRef.current = p > 0.995;
      root.classList.toggle('is-open', openRef.current);
      setOpen(openRef.current);
      /**
       * ⚠️ 钉值路径**也要**挂这个 class：这条分支 `return` 在 rAF 主循环之前，
       * 不补的话"钉住 p=0.5"时 HUD 虽然被遮罩抹掉了，却仍然吃着指针事件 ——
       * 而钉值正是回归测试唯一能确定性复现"6 格"的手段（真滚轮做不到精确 6 格）。
       */
      risingLast = p >= POINTER_FREE_AT;
      scope?.classList.toggle('is-contact-rising', risingLast);
      return;
    }

    /** 触控板 / 平滑滚动的零头，攒够一格的量才算走一格 */
    let acc = 0;


    /**
     * 吃掉一次滚轮输入。返回 true 表示这次事件真的推动了进度
     * （→ 调用方据此决定要不要 preventDefault / stopPropagation）。
     * ⚠️ 单次最多只走 1 格（见文件头「滚轮要滚几格」）。
     */
    const push = (delta: number): boolean => {
      const t = targetRef.current;
      const dir = Math.sign(delta);
      if (!dir) return false;

      let steps = 0;
      if (Math.abs(delta) >= NOTCH * NOTCH_BIG) {
        // 一次幅度明显的滚动 = 一整个物理格（deltaY 是 100 还是 50 都一样，这就是要点）
        acc = 0;
        steps = 1;
      } else {
        // 碎事件：换方向先把零头清掉，免得反向时拿上一次的余额走一格
        if (acc !== 0 && Math.sign(acc) !== dir) acc = 0;
        acc += delta;
        if (Math.abs(acc) >= NOTCH) {
          acc -= Math.sign(acc) * NOTCH;
          steps = 1;
        }
      }
      if (!steps) return false;

      const next = Math.min(1, Math.max(0, t + dir / NOTCHES));
      if (next === t) return false;
      targetRef.current = next;
      // 位置走一格的同时，按"这一下有多大"给惯性一脚（滚得越猛 → 滑得越远）
      kick(dir, Math.abs(delta) / NOTCH);
      return true;
    };

    const onWheel = (e: WheelEvent) => {
      if (blockedRef.current) return;
      const t = targetRef.current;
      // ⚠️ 已经是 1 还往下、或已经是 0 还往上 → 不吃事件（见文件头「坑 1」）
      if (e.deltaY > 0 ? t >= 1 : t <= 0) return;
      if (!push(e.deltaY)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    /* 触屏：手指上滑 = 继续露出，下滑 = 收回。用「起点 + 累计」而不是逐帧 deltaY，
       否则 touchmove 的高频小位移会被 TOUCH_TRAVEL 稀释成几乎不动。
       触屏没有"格"的概念，按整段行程算：手指滑过 1200px（= 12 格）算走满。 */
    let touchY: number | null = null;
    let touchStartP = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (blockedRef.current) return;
      touchY = e.touches[0]?.clientY ?? null;
      touchStartP = targetRef.current;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (blockedRef.current || touchY === null) return;
      const y = e.touches[0]?.clientY ?? touchY;
      const next = Math.min(1, Math.max(0, touchStartP + (touchY - y) / TOUCH_TRAVEL));
      const dP = next - targetRef.current;
      if (!dP) return;
      targetRef.current = next;
      // 手指甩得越快 → 这一帧走得越远 → 惯性越大（换成"格"的量级，和滚轮一路）
      kick(Math.sign(dP), Math.abs(dP) * NOTCHES * 0.4);
      if (e.cancelable) e.preventDefault();
    };
    const onTouchEnd = () => {
      touchY = null;
    };

    /* ---- 主循环：三套位置弹簧 + 三套惯性弹簧，同时跑同一份 target ---- */
    let raf = 0;
    const tick = () => {
      for (const l of layers) {
        // ① 位置：弹簧追 target
        const d = targetRef.current - l.cur;
        if (Math.abs(d) < 0.0006 && Math.abs(l.vel) < 0.0006) {
          // 收到位就**精确贴合**并清速度 —— 否则弹簧无限逼近，write() 永远有新值可写
          l.cur = targetRef.current;
          l.vel = 0;
        } else {
          l.vel = (l.vel + d * l.sp.k) * l.sp.f;
          l.cur += l.vel;
        }
        write(l, 'pos', l.cur);

        // ② 惯性：目标恒为 0，被 kick 踢出去之后自己滑回来（"没人推、它还在走"）
        if (Math.abs(l.ex) < 0.0004 && Math.abs(l.evel) < 0.0004) {
          l.ex = 0;
          l.evel = 0;
        } else {
          l.evel = (l.evel - l.ex * l.ip.k) * l.ip.f;
          l.ex += l.evel;
        }
        write(l, 'ex', l.ex);
      }
      // is-open 只认**主体**那一层（--contact-p）：纸没到位就不该接管指针事件
      const isOpen = layers[0].cur > 0.995;
      if (isOpen !== openRef.current) {
        openRef.current = isOpen;
        root.classList.toggle('is-open', isOpen);
        setOpen(isOpen);
      }
      /**
       * 让 LisaHud 让出指针（用户第 2 条需求连带）。
       *
       * 那层对话 HUD 是 z 100、纸是 z 45 → HUD 一直**压在纸上**。
       * 视觉上它会在 6 格时彻底消失（CSS 的遮罩，见 .lisa-hud-container），
       * 但它自己还挂在页面上，里面有一个真的 `<input>` ——
       * 不摘指针的话，纸升上来之后会点到/聚焦到一个**看不见的输入框**。
       * 阈值取 0.42（比"完全消失"的 0.5 早一格）：
       * 那是遮罩已经把下半截吃掉、只剩顶部两三行字的时刻，此时它已经不该再吃东西了。
       */
      const rising = layers[0].cur >= POINTER_FREE_AT;
      if (rising !== risingLast) {
        risingLast = rising;
        scope?.classList.toggle('is-contact-rising', rising);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      // 写在 scope 上的那一份要还回去，否则卸载后 LisaHud 会一直停在"已升起"的状态
      scope?.classList.remove('is-contact-rising');
      scope?.style.removeProperty('--contact-p');
    };
  }, []);

  /** 逐字上浮的每个字：包一层 overflow:hidden，内层按 k 错峰从下方升上来 */
  const Roll = ({ text, base = 0, step = 14 }: { text: string; base?: number; step?: number }) => (
    <>
      {[...text].map((ch, k) => (
        <span
          key={`${ch}-${k}`}
          className="studio-contact__roll"
          /* --k 是这个字"起始掉多深"的系数：越靠后掉得越深 → 升上来得越晚 */
          style={{ '--k': base + k * step } as CSSProperties}
        >
          <i>{ch}</i>
        </span>
      ))}
    </>
  );

  return (
    <div
      ref={rootRef}
      className="studio-contact"
      data-cursor-tone="dark"
      aria-hidden={!open}
      aria-label="联系方式"
    >
      {/* 那块从下方推上来的巧克力纸：整块位移由 --contact-p 驱动 */}
      <div className="studio-contact__sheet">
        {/* 幽灵大字：自己的弹簧比纸慢一倍 → 纸停了它还在走（视差最远层） */}
        <span className="studio-contact__ghost" aria-hidden="true">
          contact
        </span>

        {/* 右上角的牵牛花字符画 —— 和全屏 MENU 同一朵（同一份 flowerAsciiArt.ts）。
            这张纸的 overflow 是 hidden，所以让它稍微越界一点、只露大半朵，
            比整整齐齐摆一朵更像"印在纸上"。
            浓度 0.13 比菜单更低：这屏的主角是那几行联系方式。 */}
        <AsciiFlower className="ascii-flower--sheet" opacity={0.13} />

        {/* 点阵装饰（2026-09-17 / 用户第 1 条"美化子页面"）：这屏只有薄荷一种墨，
            所以装饰也全是薄荷档 —— 深底上浅色点阵 = 参考图1/图4 那种"蕾丝压在暗处"。
            只走左下 → 右侧这条线：右上角已经是那朵牵牛花字符画了。
            z-index:-1，压在纸底之上、联系方式之下（见 index.css 的 .pdecor 段）。 */}
        <PageDecor variant="contact" />

        <div className="studio-contact__inner">
          <p className="studio-contact__kicker">
            <Roll text="Let's Talk" step={10} />
          </p>
          <h2 className="studio-contact__title">
            <Roll text="联系方式" step={18} />
          </h2>
          <span className="studio-contact__rule" aria-hidden="true" />

          {/* 成对排版：上小标签、下大写大字，两组并排（照参考站的 Contacts / Follow） */}
          <div className="studio-contact__pairs">
            {PAIRS.map((pair) => (
              <div className="studio-contact__pair" key={pair.label}>
                <span className="studio-contact__pair-label">{pair.label}</span>
                <span className="studio-contact__pair-value">
                  <Roll text={pair.value} base={pair.base} step={16} />
                </span>
              </div>
            ))}
          </div>

          <p className="studio-contact__hint">滚轮向上返回 · Scroll up to return</p>
        </div>

        {/* 压在纸底的那一行小字 + 发丝线（同参考站页脚） */}
        <div className="studio-contact__meta">
          <span className="studio-contact__meta-line" aria-hidden="true" />
          <div className="studio-contact__meta-row">
            <span>©2026 — 待填</span>
            <span>Credits</span>
          </div>
        </div>
      </div>
    </div>
  );
}
