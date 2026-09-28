import type { CSSProperties } from 'react';
import { SHAPE, TILE_STARS, type ShapeName } from '@/components/decorShapes';
import { ASCII_BLOOM, type BloomKind } from '@/components/bloomAsciiArt';

/**
 * 子页面背景装饰层（2026-09-17 / 第二轮重构）
 * =============================================================================
 * 用户看完第一轮后的反馈（原话）：
 *   · 「我想要这种大一点的花，最好是有颜色的，颜色要与背景搭配」
 *   · 「我想要波点、星星、格子元素均匀铺满」
 *   · 「我想要这样的英文字」（图6 Angel Girl / 图7 星星花体 / 图8 点阵 Sweet Thing）
 *   · 「现在的装饰很分散，没有 ins 风美感」
 *   · 「巧克力色和薄荷色的对比度不高…也可能是拉了透明度的原因」
 *
 * ## 逐条落法
 *   1. **大而有色的花** —— 尺寸 clamp 上调到 220~340px，浓度从 0.2 提到 0.45~0.7
 *      （点阵在半实色时读起来就是"有颜色的花"，参考图1/图3 都是这么亮的）；
 *      主花颜色用薄荷深（浅底）/ 薄荷（深底），灰调的 green/base 降为辅助。
 *   2. **均匀铺满** —— grain 散点层（中间挖空）换成 tiled 平铺层：
 *      polka（波点布）/ stars（星星阵，SVG tile 遮罩）/ grid（方格蕾丝）三种，
 *      真正铺满整页。不抢字的保险改成"细 + 淡"：线 1px、点 1~2px。
 *   3. **英文字** —— 字体从 Caveat 换成 **JheriCurls**（首页 Portfolio 大字同款卷曲花体，
 *      正文不敢用它是因为小字号不可读，装饰字母都在 88px+，卷曲感正是要的）。
 *   4. **聚拢成簇** —— 每页收敛成 **两簇**（对角各一），簇 = 大花 + 花体字母/蕾丝件
 *      + 1~2 颗星互相咬合（元素之间允许重叠，才有"拼贴"的 ins 感）；
 *      游离的散星从 8~10 颗砍到 2~3 颗。
 *   5. **对比度** —— 全部透明度上调：大花 0.45~0.7 · 字母 0.4~0.5 · 星 0.6~0.85 ·
 *      平铺层 0.10~0.16（浅底）/ 0.24~0.3（巧克力底，照图5 的实色星阵）。
 *
 * ## "不遮挡主体内容"的机制（不变）
 *   整层 z-index:-1 —— 物理上画在父级背景之上、正常流内容之下，不可能盖住任何字。
 *   大簇贴边角、中心留白；平铺层靠"细 + 淡"保正文。
 *
 * ## 遮罩手法（不变）
 *   SVG data-URI 读不到 CSS 变量 → 形状只留 alpha 当 mask-image，
 *   颜色与浓度全在 CSS 变量上。⚠️ 用户明确"不要牵牛花"（那是 AsciiFlower 的主角）。
 */

type Tone = 'mint' | 'mintdeep' | 'base' | 'green' | 'paper' | 'choc' | 'lilac';
type Kind = ShapeName | 'softstar' | 'letter';
type TiledKind = 'polka' | 'stars' | 'grid';

type Orn = {
  k: Kind;
  /** 中心点（页面百分比，允许越界值 → 只露半朵，像印上去被裁了边） */
  x: number;
  y: number;
  /** 宽度；`letter` 这一档给的是字号 */
  w: string;
  rot?: number;
  tone: Tone;
  op: number;
  /** 覆盖点阵网格尺寸 / 点半径（不填走 DOTS 里按形状定的默认值） */
  dot?: string;
  r?: string;
  /** softstar 的虚焦量 */
  blur?: string;
  /** letter 的文字 */
  text?: string;
  /** 窄屏隐藏 */
  sm?: boolean;
  /**
   * 用**点阵当墨**：花由一颗颗点拼出来 = 参考图3/4/5 那种 halftone / ASCII 质感。
   * ⚠️ 不填 = 纯色实块（2026-09-17 第三轮用户要"颜色纯"才改的，子页那批花还在用）。
   *    所以这一档收成 **opt-in**：只有点了 `dots` 的花变点阵，其余页面不受影响。
   */
  dots?: boolean;
  /**
   * 换成 **ASCII 字符花**（真字符排出来的，见 bloomAsciiArt.ts）。
   * 填了它就**不再走 SVG 遮罩**，`k` 变成占位（helper `b()` 会给个 dummy）。
   * ⚠️ 这一档和 `dots`/实块互斥：字符画本身就有颗粒感，再叠点阵没意义。
   */
  bloom?: BloomKind;
};

/**
 * ASCII 字符花的 helper。`size` 是**字号**（不是宽度）—— 字符画按
 * `列数 × 0.6 × 字号` 撑开，和 `letter` 那一档一样用字号定位大小。
 * `k` 这里给 `'star'` 纯属占位：`bloom` 分支在 OrnSpan 里会提前 return，用不到 k。
 */
const b = (
  kind: BloomKind,
  x: number,
  y: number,
  size: string,
  tone: Tone,
  op: number,
  extra: Omit<Orn, 'k' | 'x' | 'y' | 'w' | 'tone' | 'op'> = {},
): Orn => ({ k: 'star', bloom: kind, x, y, w: size, tone, op, ...extra });

/** 点阵密度：面状 5px 网格 ≈ 43% 覆盖；星/字母 3px 更密才够实。 */
const DOTS: Record<Kind, { dot: string; r: string }> = {
  blossom: { dot: '5px', r: '1.85px' },
  blossomThin: { dot: '5px', r: '1.85px' },
  sprig: { dot: '5px', r: '1.85px' },
  spray: { dot: '4px', r: '1.5px' },
  lily: { dot: '3px', r: '1.2px' },
  oval: { dot: '3px', r: '1.15px' },
  bow: { dot: '3px', r: '1.05px' },
  star: { dot: '3px', r: '1.35px' },
  sparkle: { dot: '3px', r: '1.35px' },
  softstar: { dot: '5px', r: '1.8px' },
  letter: { dot: '3px', r: '1.25px' },
};

type Variant = {
  /** 平铺层：波点 / 星星 / 格子，均匀铺满整页 */
  tiled?: { kind: TiledKind; tone: Tone; op: number };
  orn: Orn[];
};

const o = (
  k: Kind,
  x: number,
  y: number,
  w: string,
  tone: Tone,
  op: number,
  extra: Omit<Orn, 'k' | 'x' | 'y' | 'w' | 'tone' | 'op'> = {},
): Orn => ({ k, x, y, w, tone, op, ...extra });

/** 簇内的小亮星：比第一轮大一号、亮一档（0.6~0.85），跟大花咬合出"拼贴感" */
const tiny = (x: number, y: number, w: string, tone: Tone, op: number, rot = 0, sm = false): Orn =>
  o('star', x, y, w, tone, op, { rot, sm });

const VARIANTS: Record<string, Variant> = {
  /* ======================= 媒体页（白底 · 卡片在中带）=======================
     2026-09-17 对比度一轮：白底上"薄荷深"读起来发灰，所以大花改**巧克力/暖褐**
     （深底压浅底 = 直接的高对比），薄荷只留作小星点缀 → 这才是"薄荷巧克力"。
     上下两条饰带各聚一簇，浓度整体抬高一档。 */
  mjp: {
    tiled: { kind: 'polka', tone: 'green', op: 0.18 },
    orn: [
      /* 左上簇：大花 + 花体字母咬合（字母压着花瓣边，才有拼贴感） */
      o('blossom', 5, 6, 'clamp(210px, 24vw, 340px)', 'choc', 0.72, { rot: -14 }),
      o('letter', 15, 15, 'clamp(88px, 10vw, 160px)', 'base', 0.78, { rot: -7, text: 'Reel' }),
      tiny(22, 4, 'clamp(24px, 2.6vw, 40px)', 'mintdeep', 0.88, -12),
      o('sparkle', 9, 20, 'clamp(26px, 2.8vw, 42px)', 'mint', 0.85),
      /* 右下簇：烟花花 + 蕾丝椭圆框在 2026-09-17 第二轮被删；这一角挂**淡紫 ASCII 彼岸花**
         （先走专用组件 AsciiLycoris，后并进通用 `b()` 通道，位置按旧 CSS 折成中心点）。
         ⚠️ 2026-09-17 晚有个坑，记在这别重犯：另一个会话收到用户一张截图 + 「删掉这种风格」，
            它把这里的删指**理解成了"删掉彼岸花 / ASCII 花整条链"**，于是删了
            `b('lycoris', …)` / lilac 色调 / 甚至文档注释。**用户随后澄清：要删的不是这个。**
            彼岸花与 ASCII 花是用户点名要的，恢复回来。 */
      b('lycoris', 80, 76, 'clamp(5px, 0.9vw, 13px)', 'lilac', 0.52),
      tiny(80, 78, 'clamp(20px, 2.2vw, 34px)', 'mintdeep', 0.88, 8),
      /* 顶带小星，压着标题栏的空白 */
      tiny(52, 4, 'clamp(14px, 1.5vw, 24px)', 'mintdeep', 0.85, 8),
      o('sparkle', 70, 9, 'clamp(18px, 2vw, 30px)', 'mint', 0.82, { rot: 22, sm: true }),
    ],
  },

  /* ======================= 文案页（暖米纸 · 星星阵饰带）=======================
     卡片是半透明白 → 平铺的星星阵会透出一层，正是"印在带底纹的纸上"。
     左上那一簇**只剩一颗小星**（巧克力大花 2026-09-22 已删，见下）；
     右下角只留花体字母 Copy（原本压着蝴蝶结，2026-09-17 晚
     那朵百合 + 蝴蝶结已按用户截图删掉），避开左上标题。 */
  cp: {
    tiled: { kind: 'stars', tone: 'mintdeep', op: 0.2 },
    orn: [
      /* ⚠️ 2026-09-22：这一角原来是 `o('blossom', 3, 9, 'clamp(220px, 25vw, 360px)', 'choc', 0.7, {rot:-12})`
         （巧克力实心大花）—— 用户贴截图说「不要遮挡」：实测它 333×333 压在 y 112~163 的
         `.cp-filters` 胶囊行上（相交 10043 px²），深色从**透明胶囊**里透出来，
         「文案」两字直接糊掉。用户要「删掉」，已删。
         （胶囊本身也补了页同色实底，双保险，见 index.css 的 .cp-filter。）
         别再以「左上太空」为由加回来：标题 + 筛选就在这一角，任何大块深色都会压字。 */
      tiny(23, 5, 'clamp(22px, 2.4vw, 36px)', 'mint', 0.82, 10),
      /* 2026-09-17 晚 / 用户截图「去掉这个花和蝴蝶结」：
         右下的实块百合（原 `o('lily', 96, 78, …)`）+ 巧克力蝴蝶结
         （原 `o('bow', 85, 91, …)`）**整对删掉** —— 它俩本来就是"结心压花"的组合，
         只删一个会剩个孤零件，一起走才干净。
         ⚠️ 字母 Copy 保留：它落在 x78/y86，和右边那颗小星仍能凑成一簇。 */
      o('letter', 78, 86, 'clamp(92px, 10.5vw, 170px)', 'base', 0.76, { rot: -5, text: 'Copy' }),
      tiny(90, 66, 'clamp(18px, 2vw, 30px)', 'mintdeep', 0.82, -16),
      tiny(50, 92, 'clamp(13px, 1.4vw, 22px)', 'mint', 0.8, 6),
      o('sparkle', 42, 4, 'clamp(22px, 2.4vw, 36px)', 'mintdeep', 0.78),
      /* 2026-09-17 晚 / 用户「其他地方可以加一下这种花，不要灰白色」：
         左下角本来是空的 —— 补一朵 ASCII 大丽花，巧克力色（暖米纸上对比最足），
         与左上那朵实块巧克力大花**同色对角**，构图立刻稳。 */
      b('dahlia', 10, 82, 'clamp(4px, 0.72vw, 10px)', 'choc', 0.5),
    ],
  },

  /* ======================= 项目详情页（左栏深棕 + 右栏纸面）=======================
     装饰只落纸面（stage 左缩一个栏宽，见 CSS）。右上一簇、左下一簇对角，
     平铺层用方格蕾丝——和详情页"策划案"的纸感最搭。白纸面用巧克力花保证对比。 */
  wkp: {
    tiled: { kind: 'grid', tone: 'green', op: 0.18 },
    orn: [
      o('spray', 94, 9, 'clamp(180px, 20vw, 300px)', 'choc', 0.68, { rot: 10 }),
      tiny(84, 18, 'clamp(20px, 2.2vw, 34px)', 'mintdeep', 0.88, 12),
      o('blossom', 7, 84, 'clamp(200px, 22vw, 330px)', 'base', 0.68, { rot: -10 }),
      o('letter', 17, 93, 'clamp(76px, 8.5vw, 140px)', 'choc', 0.78, { rot: -4, text: 'Plan' }),
      tiny(26, 74, 'clamp(18px, 2vw, 30px)', 'mint', 0.84, -8),
      /* 这一行原本是 `o('oval', 96, 52, …)`（巧克力色双层虚线椭圆）。
         2026-09-17 晚按用户「删掉线描空心图形」撤掉 —— `SHAPE.oval` 是
         `fill="none"` + `stroke-dasharray`，**纯描边、一点填充都没有**，正是被否掉的那一类。
         ⚠️ 别再以"压住右栏空角"为由加回来；要补空角就用有填充的形状（blossom / spray）。 */
      /* ⚠️ 2026-09-17 夜：这一角原本挂着一朵 ASCII 莲花，用户随后要求
         「把莲花放置左边区域左上角」→ 已挪成左栏自己的背景层
         （WorkProjectPage 的 `.wkp-rail-bloom` + index.css 里那条规则）。
         别再往这一角补花，先把下面这条实测结论读完：
         **这页装饰层是「视口固定 + z-index:-1」，而首屏整屏都不透明** ——
         `HEADER.wkp-hero`（实底 #f1efe9）+ `SECTION.wkp-band`（薄荷实底 #b5e3d6）
         把装饰整块挡住，所以首屏看不到任何装饰；滚过首屏后正文区块 bg 全是
         transparent，才透得出来。当初报「莲花没看到」就是这个原因，
         **不是没渲染、也不是浓度太低**（无头 Edge 开 `?works=1&wkp=0`，
         在字符画上逐点取 `elementsFromPoint` 量出来的）。
         本变体剩下的 spray / blossom / letter 同理：首屏不可见是结构如此。 */
    ],
  },

  /* ======================= 实习日记（牛皮纸本子内页）=======================
     纸面已有四条手写水印（keep going / 2026 / idea! / to be continued），
     两簇贴左上与右下角，字母 Diary 挂左中空白带——和四条水印全错开。
     巧克力花压在牛皮纸上对比足够，浓度略收一档避免显脏。

     ⚠️ 2026-09-17（拼贴版式）：一页被内容铺满后，「贴角 + 中心留白」的假设失效 ——
     左上那朵巧克力大花正好落在**手写标题**底下（实测截图：标题陷进花色里、对比度很差）。
     所以左上簇整体下移到 y≈30%（避开标题带 y 0~22% / x 8~30%），落进左侧板块卡后面；
     平铺层从 0.18 收到 0.15。其余保持原来的浓度与位置。 */
  diary: {
    tiled: { kind: 'polka', tone: 'base', op: 0.15 },
    orn: [
      o('blossom', 3, 30, 'clamp(190px, 21vw, 300px)', 'choc', 0.6, { rot: -14 }),
      tiny(15, 39, 'clamp(20px, 2.2vw, 34px)', 'mint', 0.8, 14),
      o('blossomThin', 90, 82, 'clamp(170px, 19vw, 280px)', 'base', 0.62, { rot: 10 }),
      /* 2026-09-17 用户要求删掉这里的蝴蝶结（原 `o('bow', 81, 93, …)`）：
         它正好叠在右下那朵瘦瓣花的下缘，「花 + 结」两件套在纸角上互相抢，
         而且 bow 是点阵遮罩画的、线条粗，在牛皮纸上读起来就是一坨灰。
         右下簇现在只留「瘦瓣花 + 一颗小星」，反而干净。
         ⚠️ 别再加回来。`SHAPE.bow` 这个形状**现在全站已无引用**（cp 变体那一对
            也在 2026-09-17 晚按用户截图删掉了）—— 形状本身留着不碍事，
            但别再造"结心压花"这种两件套，用户连着两处都要求删掉了。 */
      tiny(78, 70, 'clamp(16px, 1.8vw, 28px)', 'mintdeep', 0.82, -12, true),
      o('letter', 3, 62, 'clamp(72px, 8vw, 132px)', 'base', 0.6, { rot: -6, text: 'Diary' }),
      tiny(48, 90, 'clamp(13px, 1.4vw, 22px)', 'mint', 0.8, 20),
      /* 2026-09-17 晚 / 用户「其他地方可以加一下这种花」：
         右上角（x≈90）躲开了手写标题带（标题只占 x 8~30 / y 0~22）。
         浓度比别页再收一档（0.45）：牛皮纸底色本来深，字符画堆太实会显脏。
         窄屏隐藏 —— 本子内页窄屏是单栏滚动，装饰容易横穿正文。 */
      b('dahlia', 90, 18, 'clamp(4px, 0.68vw, 9px)', 'base', 0.45, { sm: true }),
    ],
  },

  /* ======================= 实习日记 · 内页（除第一页外的所有页）=======================
     2026-09-22 用户原话：「把实习日记中除了第一页，删掉其他页中的花朵、ascll 画、
     2026 元素」。这一档 = 上面 `diary` 那套**抽掉三样东西**：
       · 巧克力大花 blossom（x3 / y30）
       · 瘦瓣花 blossomThin（x90 / y82）
       · ASCII 大丽花 b('dahlia', 90, 18)（字符画）
     用户没点名的照旧留着：波点平铺层、三颗小星、花体字母 Diary ——
     内页不至于空到没有手账感，也不会再被花压到正文标题上。
     ⚠️ 第一页仍走 `diary`：用户明确说"除了第一页"，两套**别合并回一个变体**，
        合并等于全站删花，与要求相反。 */
  diaryPlain: {
    tiled: { kind: 'polka', tone: 'base', op: 0.15 },
    orn: [
      tiny(15, 39, 'clamp(20px, 2.2vw, 34px)', 'mint', 0.8, 14),
      tiny(78, 70, 'clamp(16px, 1.8vw, 28px)', 'mintdeep', 0.82, -12, true),
      o('letter', 3, 62, 'clamp(72px, 8vw, 132px)', 'base', 0.6, { rot: -6, text: 'Diary' }),
      tiny(48, 90, 'clamp(13px, 1.4vw, 22px)', 'mint', 0.8, 20),
    ],
  },

  /* ======================= 联系方式的巧克力纸（深底 · 薄荷当墨）=======================
     2026-09-17 第四轮：用户把实心花 + 点圈椭圆两张截图发来说「删掉，
     花我想要 ascii 风格的」（参考图3/4/5/7 —— 花由点拼成）。
     所以：椭圆圈**直接删**；两朵实心花换成**点阵花**（`dots: true`）——
     形还是参数化花枝/花瓣，墨从"一整块"换成"一颗颗点"。
     星星一颗不动（用户明确要留）。右上已有那朵 ASCII 牵牛花字符画，不重复摆花。 */
  contact: {
    tiled: { kind: 'stars', tone: 'mint', op: 0.32 },
    orn: [
      /* 这里原本是 `o('sprig', 5, 87, …)`（左下那枝薄荷色花枝）。
         2026-09-17 晚按用户「删掉线描空心图形」撤掉：`SHAPE.sprig` 的**茎是 `fill="none"`
         + `stroke`**，属于纯描边件（叶虽然实心，但整枝在纸面上读起来就是一根线）。
         ⚠️ 别再加回来。左下角真要压东西，用 `blossomThin` 或 `tiny()` 这种实心/点阵件。 */
      tiny(15, 71, 'clamp(22px, 2.4vw, 38px)', 'mint', 0.92, 10),
      o('blossomThin', 96, 76, 'clamp(160px, 18vw, 260px)', 'mint', 0.74, {
        rot: 6,
        sm: true,
        dots: true,
      }),
      tiny(84, 44, 'clamp(18px, 2vw, 30px)', 'mint', 0.92, -14),
      o('sparkle', 8, 38, 'clamp(20px, 2.2vw, 34px)', 'mint', 0.88, { rot: 18 }),
    ],
  },

  /* ======================= 工作室全屏菜单（巧克力覆盖层 · 薄荷当墨）=======================
     2026-09-17 第四轮：用户「菜单页面也换一下」—— 和联系方式同一套处理：
     点圈椭圆删掉，实色花换成**点阵花**（dots: true，花由点拼成）。
     星阵饰带与小星不动。菜单主体文字在正中，装饰只在四角与饰带，不抢字。 */
  menu: {
    tiled: { kind: 'stars', tone: 'mint', op: 0.28 },
    orn: [
      o('blossom', 6, 8, 'clamp(200px, 22vw, 320px)', 'mint', 0.78, { rot: -14, dots: true }),
      tiny(26, 4, 'clamp(22px, 2.4vw, 36px)', 'mint', 0.9, 10),
      o('spray', 94, 90, 'clamp(190px, 21vw, 320px)', 'mint', 0.74, { rot: 8, dots: true }),
      tiny(80, 76, 'clamp(20px, 2.2vw, 34px)', 'mint', 0.9, 8),
      /* 2026-09-17 晚 / 用户「其他地方可以加一下这种花」：
         左下角原本空的，补一朵 ASCII 三色堇。深底给薄荷亮色 + 高浓度（0.6）——
         照本文件浓度基准里"深底给亮色"那条，字符画细线在巧克力底上浓度低了会糊。 */
      b('pansy', 9, 87, 'clamp(4px, 0.75vw, 10.5px)', 'mint', 0.6),
    ],
  },
};

/**
 * 一条装饰。`letter` 用 JheriCurls 花体 + 点阵填充（background-clip: text）——
 * 图7"星星拼成的花体字母"的落法：文字当遮罩、点阵当墨。
 * ⚠️ 不能在数据 URI 里写字：SVG 当图片渲染时页面 web font 用不上。
 */
function OrnSpan({ orn, word }: { orn: Orn; word?: string }) {
  const dots = DOTS[orn.k];
  const style = {
    left: `${orn.x}%`,
    top: `${orn.y}%`,
    '--rot': orn.rot ?? 0,
    '--pdecor-op': orn.op,
    '--pdecor-dot': orn.dot ?? dots.dot,
    '--pdecor-r': orn.r ?? dots.r,
    ...(orn.blur ? { '--pdecor-blur': orn.blur } : null),
  } as CSSProperties;

  const cls = `pdecor__orn pdecor--${orn.tone}${orn.sm ? ' pdecor__orn--sm-hide' : ''}${
    orn.dots ? ' pdecor__orn--dots' : ''
  }`;

  if (orn.bloom) {
    return (
      <pre
        className={`ascii-bloom pdecor--${orn.tone}${orn.sm ? ' pdecor__orn--sm-hide' : ''}`}
        style={{ ...style, fontSize: orn.w } as CSSProperties}
        aria-hidden="true"
      >
        {ASCII_BLOOM[orn.bloom]}
      </pre>
    );
  }

  if (orn.k === 'letter') {
    return (
      <span className={`${cls} pdecor__orn--letter`} style={{ ...style, fontSize: orn.w }} aria-hidden="true">
        {word || orn.text}
      </span>
    );
  }

  const shape = orn.k === 'softstar' ? SHAPE.star : SHAPE[orn.k];
  return (
    <span
      className={`${cls}${orn.k === 'softstar' ? ' pdecor__orn--soft' : ''}`}
      style={{ ...style, width: orn.w, '--pdecor-shape': `url("${shape}")` } as CSSProperties}
      aria-hidden="true"
    />
  );
}

/** 平铺层：polka/grid 的图案在 CSS 类里；stars 的 SVG tile 遮罩在这里内联传入
 *  （遮罩不烤色，颜色吃 .pdecor--tone 的 --pdecor-color）。
 *  2026-09-17 用户：「不要全部铺满，只要上下两个长条」—— 渲染成上下两条饰带。 */
function TiledLayer({ tiled }: { tiled: NonNullable<Variant['tiled']> }) {
  const style =
    tiled.kind === 'stars'
      ? ({
          '--pdecor-top': tiled.op,
          WebkitMaskImage: `url("${TILE_STARS}")`,
          maskImage: `url("${TILE_STARS}")`,
          WebkitMaskSize: '96px 96px',
          maskSize: '96px 96px',
          WebkitMaskRepeat: 'repeat',
          maskRepeat: 'repeat',
        } as CSSProperties)
      : ({ '--pdecor-top': tiled.op } as CSSProperties);

  return (
    <>
      <span
        className={`pdecor__tiled pdecor__tiled--top pdecor__tiled--${tiled.kind} pdecor--${tiled.tone}`}
        style={style}
      />
      <span
        className={`pdecor__tiled pdecor__tiled--bottom pdecor__tiled--${tiled.kind} pdecor--${tiled.tone}`}
        style={style}
      />
    </>
  );
}

export function PageDecor({ variant, word }: { variant: keyof typeof VARIANTS; word?: string }) {
  const cfg = VARIANTS[variant];
  if (!cfg) return null;

  return (
    <div className={`pdecor pdecor--${String(variant)}`} aria-hidden="true">
      <div className="pdecor__stage">
        {cfg.tiled ? <TiledLayer tiled={cfg.tiled} /> : null}
        {cfg.orn.map((orn, i) => (
          <OrnSpan key={`${orn.k}-${i}`} orn={orn} word={word} />
        ))}
      </div>
    </div>
  );
}
