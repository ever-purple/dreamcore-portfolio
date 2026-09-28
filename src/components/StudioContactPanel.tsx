import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useEscape } from '@/lib/escape-stack';
import { AsciiFlower } from '@/components/AsciiFlower';
import { PageDecor } from '@/components/PageDecor';
import { ShareCardOverlay } from '@/components/ShareCardOverlay';
import { CONTACT } from '@/data/contact';

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
 * ## 滚轮揭示：连续累加（2026-09-17 改，对齐参考站 ilcapoproduction 的丝滑感）
 * 灵敏度 `SENS = 1/(NOTCH*NOTCHES)`：标准滚轮一格 deltaY≈100 时约 12 格到顶 ——
 * 但**是连续揭示，不再锁死 12 级**。之前 `target` 按 1/NOTCHES 跳，弹簧只在每级之间缓一下、
 * 级间静止 → 鼠标一格一格蹦、不丝滑；现在滚多少走多少，弹簧去追一个持续移动的目标 → 连续无阶梯。
 * ⚠️ 之前"按事件数数、每事件最多 1 格"的规则（为了不同鼠标都≈12 格）被**舍弃**了：
 *    参考站本就是连续滚动 scrub、从不在意"精确几格"，连续后不同鼠标只是"到顶圈数"略有差异，
 *    但因为连续 + 弹簧追得顺，体感一样丝滑。即"用精确 12 格换丝滑"。
 * ⚠️ 2026-09-17 进一步升级为**惯性虚拟滚动**（`push()` 不再直接写 target，而是给 `velRef`
 *    喂速度冲量，主循环每帧 `vel*=V_FRICTION; target+=vel`）：大甩只开一点、松手还滑一段、
 *    要到底得持续滚 —— 用户要的"阻尼感 + 惯性 + 一次滚很多格也不完全展开"就来自这一层，
 *    再加上下面三套位置弹簧再追目标 = 双重平滑。封顶见 V_STEP / V_MAX。
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
 * 命令式句柄：让外部（菜单的 Contact 项）能直接"跳到联系方式"，
 * 而不必真的滚 12 格。reveal 把主量钉到 1，主循环会用同一套弹簧把它推上来；
 * retract 钉回 0（与滚轮向上回退等价）。
 * ⚠️ 只动 targetRef，不碰 rAF / 监听器 —— 复用面板已有的动画，不重挂副作用。
 * ⚠️ `reveal()` 在**被浮层盖住**时不会立刻生效：改为挂起，等 blocked 落下去自动补发
 *    （见 pendingRevealRef 那段注释 —— 菜单自己也算一层，点 Contact 那一刻必然处于
 *    "被盖住"状态，早期版本直接 return，表现就是"点了没反应"）。
 */
export type StudioContactHandle = {
  reveal: () => void;
  retract: () => void;
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
/** 触屏：手指要滑过的总行程（px），按"10 格 × 100px"折算 */
const TOUCH_TRAVEL = NOTCH * NOTCHES;

/**
 * 惯性虚拟滚动（2026-09-17 / 用户最新需求："大甩动也不一脚到底、要阻尼和惯性"）。
 * 滚轮**不再直接写目标**，而是给 `velRef` 喂"速度冲量"；主循环每帧
 *   vel *= V_FRICTION^dtF ;  target = clamp(target + vel*dtF)
 * 于是：
 *   · 单次大甩 = 一脚大速度，但摩擦很快吃掉 → **只开一点就不走了**（不会一脚到底）；
 *   · 松手后速度还在按摩擦衰减 → 目标继续往前滑一小段 = **惯性**；
 *   · 要到底得**持续滚**（每帧都在补速度），而不是甩一下。
 * 这层"速度→目标"的积分是额外的阻尼 / 惯性；下面三套位置弹簧再追这个目标，
 * 等于**双重平滑**，手感比纯改 target 更黏更稳（也对齐参考站 ilcapoproduction 的 scrub 感）。
 * ⚠️ 单事件冲量封顶 V_STEP、速度封顶 V_MAX：否则一根巨量惯性直接把目标顶到 1（一脚到底）。
 */
const SENS_V = 0.0002; // 一格 deltaY≈100 → 约 0.02 速度冲量
const V_STEP = 0.025; // 单次滚轮事件冲量封顶（进度 / 帧）
const V_FRICTION = 0.9; // 速度每帧保留率（越小衰减越快、越黏）
const V_MAX = 0.04; // 速度绝对值封顶

/**
 * 三层跟随速率（2026-09-17 二改：把「弹簧」整套换成「指数平滑」，彻底去掉回弹）。
 *
 * 之前是弹簧（刚度 k + 速度保留 f），弹簧**必然过冲** —— 实测 inner 过冲 11.6%、
 * sheet 6.8%，再叠一层会"过零反向摆回"的惯性冲量，用户反馈「弹性太大」。
 * 而参考站 ilcapoproduction 是 Lenis 平滑滚动 + 直接 scrub：
 * **位置永远单调逼近目标，一次都不过冲**。要"完全一样"就必须零过冲。
 *
 * 所以改成指数平滑：`cur += (target - cur) * (1 - exp(-rate*dt))`。
 * `1 - exp(-rate*dt)` 恒在 (0,1)，cur 每次只朝 target 挪一部分 ——
 * **数学上不可能越过 target** → 零过冲、零回弹。
 * 三层 rate 不同 → 迟滞不同 → 视差仍然在（近的先到、远的还在路上）。
 *
 * 阻尼感 / 惯性不再来自弹簧，而来自上面那层「速度积分」(velRef)：
 * 松手后目标还在按摩擦往前滑一段、各层再慢半拍跟上 ——
 * 这是**过阻尼**系统（滑过去 → 收住 → 停），不是弹簧（弹过去 → 弹回来）。
 */
const FOLLOW = {
  inner: 12, // 最快 → 抢在纸前面（τ≈0.08s）
  sheet: 7,  // 主体（τ≈0.14s，接近 Lenis 默认的每帧 ~10% lerp）
  ghost: 4,  // 最慢 → 落在纸后面（τ≈0.25s）
} as const;

/**
 * ## 惯性层（2026-09-17 二改：**冲量已停用**）
 * ⚠️ 这一层现在**只在 `?contactv=` 钉值时才动**（回归脚本 `verify-contact-panel.mjs`
 *    的 D 段要靠它确定性地验证层间位移差，真滚轮做不到精确复现）。
 *    正常滚动下 `kick()` **已不再被调用** → `ex` 恒为 0 → **不会回弹**。
 *    用户反馈「弹性太大、要和参考站完全一样」，而参考站根本没有"踢一脚再摆回来"这回事；
 *    惯性改由 velRef 那层速度积分提供（滑过去、收住、停，不弹）。
 *
 * 以下是停用前的设计说明，保留作存档 —— 别照着它把 kick 加回来：
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

/**
 * ⚠️ `KICK_MAX` 已删除（2026-09-17 二改）：随 `kick()` 一起停用，见 INERTIA 那段注释。
 */

/**
 * 进度超过这个值就让 `LisaHud` 交出指针事件（用户第 2 条需求连带）。
 * 0.42 = 比"完全消失"的 0.5 早一格：那时遮罩已经把下半截吃掉、只剩顶部两三行，
 * 它不该再吃鼠标。见下面 tick 里的 `rising`。
 */
const POINTER_FREE_AT = 0.42;

type Pair = {
  label: string;
  value: string;
  /** 逐字错峰的**起始延迟**（0..1 的整体揭示进度） */
  base: number;
  /** 这一串字从头到尾的错峰跨度（0..1） */
  span: number;
};

/**
 * 两栏「小标签 + 大字」：Contacts（邮箱）+ Share（分享网站，可点）。
 * 2026-09-27：Follow 栏整体删除（用户要求），分享入口顶替它占右侧。
 * `base` 越大 = 这一组越晚开始显出 —— kicker → 标题 → 邮箱 → 分享 的级联。
 *
 * 联系邮箱来自 src/data/contact.ts（唯一数据源）。
 */
const CONTACT_PAIRS: Pair[] = [
  { label: 'Contacts', value: CONTACT.email, base: 0.32, span: 0.2 },
  /* 右侧这栏可点：点它**蹦出分享卡浮层**，浮层里那枚「转发卡片」才真的把图片发出去
     （2026-09-28 改；原来这里是直接 navigator.share，发出去的只有链接，见下面 onShare） */
  { label: 'Share', value: '分享网站', base: 0.5, span: 0.16 },
];

export const StudioContactPanel = forwardRef<StudioContactHandle, Props>(function StudioContactPanel(
  { blocked },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /**
   * 分享卡浮层开着吗（2026-09-28）。
   *
   * ⚠️ 这个状态**不能**并进 `blocked`：`blocked` 那条 effect 会顺手把面板
   *    `targetRef` 归零（"被别的浮层盖住就主动收回"）—— 而分享卡是从面板里长出来的，
   *    打开它绝不该把面板收回去。所以单独一个状态 + 一个 ref，
   *    ref 供 rAF 外面那几个事件处理函数同步读（见 onWheel / onTouchMove 的注释）。
   */
  const [shareOpen, setShareOpen] = useState(false);
  const shareRef = useRef(false);

  /** 滚轮目标（被弹簧追的"滚动进度"）。放 ref 里 —— 每帧都要读写，进 state 会把整棵树重渲 60 次/秒。 */
  const targetRef = useRef(0);
  /** 惯性虚拟滚动的速度（进度/帧）。滚轮喂冲量、每帧按摩擦衰减 → 阻尼 + 惯性。 */
  const velRef = useRef(0);
  const openRef = useRef(false);
  const blockedRef = useRef(blocked);
  /** 「菜单里点 Contact」这类请求要先挂起（2026-09-17 用户报「点菜单的 contact 没跳转」）：
      点击那一刻菜单**自己**还占着 blocked（StudioSection 的 layerOpen 含 menuOpen，
      而 setMenuOpen(false) 是异步的，同一 tick 里 blockedRef 仍是 true）→ 直接被闸门吞掉。
      所以拦下来时记一笔，等 blocked 落下去由下面那个 effect 补发。 */
  const pendingRevealRef = useRef(false);

  useEffect(() => {
    blockedRef.current = blocked;
    // 被别的浮层盖住 → 主动收回（见文件头「坑 3」）
    if (blocked) {
      targetRef.current = 0;
      velRef.current = 0;
      // 又被盖住 → 之前挂起的"请把面板推上来"作废（否则关掉浮层会莫名其妙弹出来）
      pendingRevealRef.current = false;
    } else if (pendingRevealRef.current) {
      /* 请求补发：菜单里点 Contact 时被闸门拦下的那一次，在这里兑现。
         ⚠️ 不能改成"点击时延后一帧再调 reveal()" —— 那要看 React 何时 flush
         passive effect（跟 rAF/setTimeout 的先后没有保证），不如把状态挂在 ref 上可靠。 */
      pendingRevealRef.current = false;
      targetRef.current = 1;
      velRef.current = 0;
    }
  }, [blocked]);

  /** 命令式句柄：菜单的 Contact 项点一下就能直接把面板推到顶（或收回）。 */
  useImperativeHandle(
    ref,
    () => ({
      reveal: () => {
        if (blockedRef.current) {
          pendingRevealRef.current = true;
          return;
        }
        targetRef.current = 1;
        velRef.current = 0;
      },
      retract: () => {
        targetRef.current = 0;
        velRef.current = 0;
      },
    }),
    [],
  );

  /** Esc 收回。走全站统一的 Esc 栈，只有面板确实开着时才占用这一次按键。 */
  const retract = useCallback(() => {
    targetRef.current = 0;
    velRef.current = 0;
  }, []);
  useEscape(retract, open);

  /**
   * 分享这个网站（2026-09-28 改）：点一下只做一件事 —— **把分享卡浮层打开**。
   *
   * ## 为什么不再直接分享
   * 旧实现是 `navigator.share({ title, text, url })`，桌面没有 `navigator.share`
   * 时退化成 `clipboard.writeText(url)`。用户实测后原话：
   *   「分享卡根本就看不见……只能复制链接，把链接发给好友只是链接不是图片，
   *     我希望是点击转发网站的时候就蹦出分享卡，分享卡里的按钮点击后就可以
   *     分享图片到其他地方微信小红书等等」
   * 症结是那条路径**永远只发链接**，而这个站"值得被转发的东西"其实是一张图。
   * 所以现在把"发什么"交回给用户：浮层里展示那张卡，浮层自己的「转发卡片」再走
   * `navigator.share({ files })` → 写剪贴板 → 下载 三级降级（见 src/lib/shareCard.ts）。
   * 配套地，面板里原来那个 `.studio-contact__share-hint`（"链接已复制 ✓"）
   * 连同 `shared` 状态一起退休了 —— 反馈统一交给浮层自己的提示行。
   *
   * ⚠️ `shareRef` 要**同步**写，不能只靠 `useEffect` 跟着 `shareOpen` 走：
   *    浮层打开那一瞬间如果正好有一记滚轮/触屏事件排在队列里，
   *    面板挂在 window 上的捕获监听（见文件头「坑 2」）可能先跑到 —— 那时 effect 还没执行。
   *    而它一旦跑到，就会把这记滚轮算成"收回面板"，浮层会莫名其妙跳一下。
   */
  const onShare = useCallback(() => {
    shareRef.current = true;
    setShareOpen(true);
  }, []);

  /** 关浮层。Esc / 点背幕 / 点关闭按钮都走这里（Esc 由浮层自己的 useEscape 入栈触发）。 */
  const closeShare = useCallback(() => {
    shareRef.current = false;
    setShareOpen(false);
  }, []);

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
     * 一层 = 一个位置变量（指数平滑追 target）+ 一个惯性变量（已停用，见 INERTIA 注释）：
     *   pos + rate → 位置进度，按 `1-exp(-rate*dt)` 单调逼近（零过冲）
     *   ex / evel  → 惯性额外位移，只在 `?contactv=` 钉值时才非零
     * 两个写入值各自量化去重（鼠标静止时零开销）。
     * `share` = 这一层的进度要不要同时写到 scope 上（只有主体那层需要）。
     */
    const mk = (pos: string, ext: string, rate: number, ip: Inertia, share = false) =>
      ({ pos, ext, rate, ip, share, cur: 0, posLast: '', ex: 0, evel: 0, exLast: '' });
    const layers = [
      mk('--contact-p', '--contact-pv', FOLLOW.sheet, INERTIA.sheet, true),
      mk('--contact-pg', '--contact-pgv', FOLLOW.ghost, INERTIA.ghost),
      mk('--contact-pi', '--contact-piv', FOLLOW.inner, INERTIA.inner),
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
     * ⚠️ `kick()` 已删除（2026-09-17 二改）。
     * 它每次滚轮都给惯性弹簧踢一脚，而弹簧会**过零反向摆回** —— 这就是用户说的
     * "弹性太大"。参考站没有这回事，惯性改由 velRef 的速度积分提供（见 V_* 常量）。
     * 惯性弹簧本体保留，只服务 `?contactv=` 钉值（回归脚本 D 段）。
     */

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

    /**
     * 滚轮灵敏度：标准滚轮一格 deltaY≈100。
     * 连续 + 惯性虚拟滚动（2026-09-17 改，见文件头「滚轮揭示」+ 上面 V_* 常量）：
     * 滚轮不直接写目标，而是给速度加冲量 → 主循环积分出目标。
     * 这样"滚多少走多少、大甩只开一点"，弹簧去追一个持续移动的目标 → 连续无阶梯、对齐参考站丝滑感。
     */

    /**
     * 吃掉一次滚轮输入。返回 true 表示这次事件真的在推动进度
     * （→ 调用方据此决定要不要 preventDefault / stopPropagation）。
     * ⚠️ 不直接改 target：只给速度加一脚冲量，目标由 tick 每帧积分（见 V_* 常量那段）。
     */
    const push = (delta: number): boolean => {
      const dir = Math.sign(delta);
      if (!dir) return false;
      // 滚轮不直接写目标，而是给速度加一脚冲量（见上面「惯性虚拟滚动」）
      const add = Math.max(-V_STEP, Math.min(V_STEP, delta * SENS_V));
      velRef.current = Math.max(-V_MAX, Math.min(V_MAX, velRef.current + add));
      return true;
    };

    const onWheel = (e: WheelEvent) => {
      // shareRef = 分享卡浮层盖在上面。理由同「坑 3」，但那层不在 blocked 里：
      // 它是从面板里长出来的，blocked 一开就会把面板收回去（见 shareOpen 那段注释）。
      if (blockedRef.current || shareRef.current) return;
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
      if (blockedRef.current || shareRef.current) return;
      touchY = e.touches[0]?.clientY ?? null;
      touchStartP = targetRef.current;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (blockedRef.current || shareRef.current || touchY === null) return;
      const y = e.touches[0]?.clientY ?? touchY;
      const next = Math.min(1, Math.max(0, touchStartP + (touchY - y) / TOUCH_TRAVEL));
      const dP = next - targetRef.current;
      if (!dP) return;
      // 触屏也走同一套速度积分：手指每帧走的进度当成速度冲量喂进去（和滚轮一路）
      const add = Math.max(-V_STEP, Math.min(V_STEP, dP * 4));
      velRef.current = Math.max(-V_MAX, Math.min(V_MAX, velRef.current + add));
      if (e.cancelable) e.preventDefault();
    };
    const onTouchEnd = () => {
      touchY = null;
    };

    /* ---- 主循环：三套位置弹簧 + 三套惯性弹簧，同时跑同一份 target ---- */
    let raf = 0;
    let lastT = 0;
    const tick = (t: number) => {
      // 帧率无关：dt 取秒（夹到 50ms，防标签页切回来时一大跳）
      const dtSec = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60;
      lastT = t;
      const dtF = dtSec * 60; // 折算成"60fps 帧数"，摩擦按帧衰减用

      // 惯性虚拟滚动：速度按摩擦衰减，目标每帧 += 速度（封顶在 0..1）。
      // ⚠️ 这是"大甩不一脚到底 + 松手还滑一段"的核心（见 V_* 常量那段）。
      velRef.current *= Math.pow(V_FRICTION, dtF);
      if (Math.abs(velRef.current) < 0.00015) velRef.current = 0;
      const nt = targetRef.current + velRef.current * dtF;
      targetRef.current = nt < 0 ? 0 : nt > 1 ? 1 : nt;

      for (const l of layers) {
        // ① 位置：**指数平滑**追 target（零过冲 —— 见 FOLLOW 常量那段）
        const d = targetRef.current - l.cur;
        if (Math.abs(d) < 0.0003) {
          // 足够近就**精确贴合** —— 否则无限逼近，write() 永远有新值可写
          l.cur = targetRef.current;
        } else {
          l.cur += d * (1 - Math.exp(-l.rate * dtSec));
        }
        write(l, 'pos', l.cur);

        // ② 惯性额外位移：弹簧本体保留（只服务 `?contactv=` 钉值 / 回归脚本 D 段），
        //    正常滚动下没人踢它 → 收敛到 0 并停在那 → 不产生任何回弹。
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

  /**
   * 逐字揭示：每个字包一层 overflow:hidden，内层从下方升上来 + 同步放大。
   * ⚠️ `base` / `span` 是**归一化的 0..1 整体进度**，不是"第几个字 × 步长"：
   *    邮箱有 17 个字，按字数累加会把最后一个字推到 p≈1 才露头（长串直接崩）。
   *    归一化成"这串字占整体进度的哪一段"后，长短串的错峰时长一致，只改 base/span。
   */
  const Roll = ({ text, base = 0, span = 0.24 }: { text: string; base?: number; span?: number }) => (
    <>
      {[...text].map((ch, k) => {
        const t = text.length > 1 ? k / (text.length - 1) : 0;
        return (
          <span
            key={`${ch}-${k}`}
            className="studio-contact__roll"
            /* --d = 这个字的错峰延迟（0..1）→ CSS 里据它算出这个字自己的揭示进度 --cp */
            style={{ '--d': base + t * span } as CSSProperties}
          >
            <i>{ch}</i>
          </span>
        );
      })}
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
            <Roll text="Let's Talk" base={0} span={0.18} />
          </p>
          <h2 className="studio-contact__title">
            <Roll text="联系方式" base={0.08} span={0.22} />
          </h2>
          <span className="studio-contact__rule" aria-hidden="true" />

          {/* 成对排版：上小标签、下大写大字，Contacts 贴左、Share 贴右 */}
          <div className="studio-contact__pairs">
            {CONTACT_PAIRS.map((pair) => (
              <div
                className={`studio-contact__pair${
                  pair.label === 'Share' ? ' studio-contact__pair--share' : ''
                }`}
                key={pair.label}
              >
                <span className="studio-contact__pair-label">{pair.label}</span>
                <span className="studio-contact__pair-value">
                  {/*
                    Share 栏：<button> 包在 Roll 外面（理由同当年 <a> 的注释 ——
                    Roll 会把字拆成一个个 <span>，交互元素必须包在外层才不至于碎掉）。
                    pair-link 只负责"可点"的观感：继承墨色、无下划线、悬停淡一档。
                  */}
                  {pair.label === 'Share' ? (
                    <button
                      type="button"
                      className="studio-contact__pair-link"
                      onClick={onShare}
                      aria-label="分享网站"
                    >
                      <Roll text={pair.value} base={pair.base} span={pair.span} />
                    </button>
                  ) : (
                    <Roll text={pair.value} base={pair.base} span={pair.span} />
                  )}
                </span>
                {/* 这里原本有个「链接已复制 ✓」提示（shared 状态）。2026-09-28 起
                    点 Share 不再复制链接、而是开分享卡浮层，反馈统一由浮层自己的
                    提示行给 —— 所以连同 .studio-contact__share-hint 一起删掉了，
                    别再加回来（那条 CSS 也一起删了）。 */}
              </div>
            ))}
          </div>

        </div>

        {/* 压在纸底的那一行小字 + 发丝线（同参考站页脚） */}
        <div className="studio-contact__meta">
          <span className="studio-contact__meta-line" aria-hidden="true" />
          {/* 2026-09-17 用户：「把联系方式页面下面的 2026待填删掉」——
             左格「©2026 — 待填」已删，只留 Credits。
               ⚠️ 连 CSS 一起改：那条原本是 justify-content: space-between，
                  少一个兄弟后 Credits 会被甩到左端；已改成 flex-end 让它留在原位。 */}
          <div className="studio-contact__meta-row">
            <span>Credits</span>
          </div>
        </div>
      </div>

      {/*
        分享卡浮层。挂在这里只是为了"离按钮近好读"，它自己是 `createPortal` 到 body 的
        （见 ShareCardOverlay 文件头第 1 条）—— 所以不受这张巧克力纸的
        overflow:hidden / 层叠上下文影响，也不会被 aria-hidden 连带。
      */}
      <ShareCardOverlay open={shareOpen} onClose={closeShare} />
    </div>
  );
});
