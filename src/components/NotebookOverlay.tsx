import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { EASE } from '@/lib/ease';
import gsap from 'gsap';
import {
  DIARY_ENTRIES,
  DIARY_CHAPTER_PAGES,
  DIARY_COVER_EN,
} from '@/data/diary';
import { DiaryPage, BlankPage, TONES } from '@/components/DiaryPage';
import { PageDecor } from '@/components/PageDecor';
import { useEscape } from '@/lib/escape-stack';
import { useAdminMode } from '@/context/AdminContext';
import { DiaryEditorProvider, PageScope, useDiaryEditor } from '@/lib/diary-editor/context';
import { REF_W, type PaperKind } from '@/lib/diary-editor/types';
import {
  BACK_PAGE_ID,
  SHEET_BY_ID,
  pageLabel as labelOfPage,
  spreadPages,
  spreadCount,
  spreadOfPage,
} from '@/lib/diary-editor/pageId';
import { lighten } from '@/lib/diary-editor/layout';
import { LayerView, LiveVideoLayer } from '@/components/diary-editor/LayerView';
import { DiaryCanvas } from '@/components/diary-editor/DiaryCanvas';
import { DiaryToolbar } from '@/components/diary-editor/Toolbar';
import { EditableText } from '@/components/diary-editor/EditableText';
import { El } from '@/components/diary-editor/PageEl';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * 中缝（和封面左缘）的线圈圈数。
 * 2026-09-25：22 → **14**，配「塑料环」新样式（见 index.css 的 .notebook-ring）——
 * 塑料 wire-o 的孔距比钢丝圈大得多（约 3/4 英寸 ≈ 19mm），14 圈在当前纸面尺度下
 * 间距 ≈45px，正好是塑料环那种「一环一环分得开」的样子；再密就变回钢丝本了。
 */
const RING_COUNT = 14;
/**
 * 翻页时把纸**横切成多少条竖带**。
 * CSS 变换是仿射的 —— 单个元素无论怎么 rotateY/skew，平面矩形转完还是平面矩形，
 * 永远弯不起来（这就是用户说的「直直地翻过去」）。真弯曲只能「切条 + 每条各自转」
 * 拼出来，条数越多弧面越顺、代价是 DOM 越多（每条带 = 一份完整纸面）。
 * 12 条在 1920 宽下每条约 130px，弧线的折角在动态里看不出来，是实测的平衡点。
 *
 * ⚠️ 2026-09-23：**编辑态不切条**（单页平铺渲染，见 NotebookBody 的 renderStage）。
 *    12 份 DOM 里各有一个 contenteditable 会让"改一个字"变成改 12 个地方，
 *    而且拖拽手柄也会被复制 12 份。编辑只发生在"一张纸"上。
 */
const BAND_COUNT = 12;
/**
 * 相邻竖带互相重叠的像素数（2026-09-25）。
 * 折纸之后两带在 3D 里共边（见 applyPeel），但它们是两个独立的合成层，
 * 边缘各自的抗锯齿叠在一起仍会合成出一条发丝亮的缝。让出 1px 重叠吃掉它。
 * ⚠️ 别调大：重叠区的高光（--sheen0/1 渐变）会画两次，>2px 就能看出亮边。
 */
const BAND_BLEED = 1;
/**
 * 掀起的**峰值切向角** Θ（弧度）—— 第四轮的核心量。
 *   第三轮：Θ = φ =「圆弧的总圆心角」，曲率恒定（= φ/W），整张一样弯 = 硬卡纸被折；
 *   第四轮：切向角沿弧长按 **sin(πt)** 分布 —— 书脊处 0（平切着离开）、t=0.5 顶到 Θ、
 *          自由边又回到 0（放平）。于是
 *            曲率 κ(t) ∝ θ'(t) ∝ cos(πt) —— **中段为正、末段为负**（会拐弯）
 *            位置 z(t) = W∫₀ᵗ sin(Θ·sin πu) du —— **缓 → 陡 → 缓，中段有拐点**
 *          这就是软纸的 **S 形波浪**；圆弧的 z 是抛物线，没有拐点，所以看着是"折"不是"掀"。
 *
 * ⚠️ 别再退回"让 θ 增速变慢"那种写法（实测过：PEEL_RELAX 让 θ 峰值出现在 t=0.86，
 *    结果 Δz 仍然末段最大 —— 量出来末段 36.4 > 中段 23.4，和圆弧没区别）。
 *    S 形只能靠**θ 本身先升后降**，不能靠"升得慢一点"。
 *
 * ⚠️ 上限仍被**投影放大**卡住（和第三轮同一个约束）：
 *    z(1) ≈ W·Θ·2/π，透视（.diary-flip 的 1700px）再放大 `1700/(1700−z)` 倍。
 *    Θ=0.32 时 z≈270px、放大 ≈1.19×，与第三轮实测的 z≈240~310 同一量级，收得住。
 *
 * ⚠️ 2026-09-24 C：0.28 → **0.42**。用户原话「纸张完全是直着翻过去，没有弯曲」——
 *    0.28rad ≈ 16°，摊在整张纸上几乎看不出弧度；提到 24° 才明显是"纸被捏起来的"。
 *    z(1) ≈ 0.27W ≈ 110px（W≈420），放大 ≈1.07×，仍在上面的上限里。
 */
const PEEL_MAX = 0.42;
/**
 * 页面内容的**设计基准宽度**（px）—— 内页版式（dx-* 那套，文字块 / 拍立得 / 标签）
 * 是按"每张纸约这么宽"排出来的（改造前页面就是这么宽）。
 *
 * 新的 A4 页面更窄（同一视口高度下，A4 竖版只有旧页面的 ~74%），若让内容自然重排，
 * 列宽变窄 → 折行变多 → 实测 13/13 页全部超出纸张高度被裁。
 * 所以这里整块 `zoom` 回去：**构图等比保留**（和 REF_W 那套虚拟 px 同一思路，
 * 只是那一套只管贴纸、这一套管整页内容）。调这个值等价于调内页整体字号：
 * 越小 → 内容越大越容易溢出；越大 → 内容越小留白越多。
 */
const DESIGN_PAGE_W = 676;
/**
 * 设计基准高度（px）—— 由 DESIGN_PAGE_W 按 A4 竖版比例（210 : 297）推出来的。
 * `--dp-fit` 同时受宽与高约束（见 fitOf），正常情况下宽约束略严、高度只是兜底，
 * 用来防止将来改了边距之后内容纵向溢出纸面。
 */
const DESIGN_PAGE_H = 956;
/**
 * 这一页内容该缩到多小 —— **按 .diary-sheet 的内容盒算，不再按纸宽算**。
 *
 * ⚠️ 2026-09-24 C 修「所有页溢出纸面」的那一行：
 *    Chromium 里 `zoom` 参与布局 ⟹ 子元素"以为自己有多宽" = 父**内容盒**宽 ÷ fit。
 *    以前 fit = 纸宽/676(=0.72)，可内容盒被边距吃掉了一大截 ⇒ 子元素只以为自己有
 *    489px（应为 676）⇒ 折行暴涨 ⇒ 实测左叶内容 1088px 高 / 纸面 682px。
 *    换成内容盒宽做分子 ⟹ 子元素恒拿到 676px 的设计宽度，**构图逐像素保留**，
 *    改边距也不会破版。高度再兜一道底（将来动了边距不会纵向溢出）。
 */
function fitOf(host: HTMLElement): number {
  const sheet = host.querySelector<HTMLElement>('.diary-sheet');
  let w: number;
  let h: number;
  if (!sheet || !sheet.clientWidth) {
    /* 这一叶现在是空的（合着时的左页 / 末跨的右页）：没有 .diary-sheet 可量 */
    w = host.clientWidth;
    h = host.clientHeight;
  } else {
    const cs = getComputedStyle(sheet);
    w = sheet.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    h = sheet.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  }
  if (w <= 4 || h <= 4) return 1;
  return Math.min(w / DESIGN_PAGE_W, h / DESIGN_PAGE_H);
}
/** sin 分布的峰值就是 1（落在 t=0.5），高光归一化要用 */
const PEEL_PEAK = 1;
/**
 * 切向角沿弧长的分布 f(t)：f(0)=0、f(0.5)=1、f(1)=0。
 * 换成别的形状要同时满足两端归零（纸在书脊处平切离开、自由边放平），
 * 否则又变成"圆弧 + 快慢变化"，S 形立刻消失。
 */
function peelShape(t: number): number {
  return Math.sin(Math.PI * t);
}
/**
 * 卷曲量随翻页进度 p(0..1) 的变化曲线 —— **平台型**，不是 sin 单峰。
 *
 * 为什么不用 sin(πp)：它在 p=0.5 达到峰值，而 p=0.5 正好是纸转 54°、
 * 最"侧"的时候 —— 弯得最狠的时候偏偏最看不见（实测姿态截图就是这样）。
 * 改成 [0,0.25] 升到 1、[0.25,0.75] 保持 1、[0.75,1] 收回 0：
 * 纸从转到 27° 起就已经弯满，一直弯到 81°，整个可见窗口里"纸是弯的"这件事
 * 都成立；两端仍归零（平摊在书脊任一侧时不该是弯的）。
 * 2026-09-24 C：平台区间改成 **[0.12, 0.86]** —— 以前那版是按"只走 0°↔-90° 半程"
 * 调的；现在要扫满 180°，半程的比例全都要重算。放开到 0.12 起、0.86 收，
 * 一路到"纸已经砸下去之前"都保持弯着；**末段必须收回 0** —— 落定时纸是完全平的，
 * 带着弧度落到左边会看着像鼓了个包。
 */
function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
function curlBump(p: number): number {
  return smoothstep01(p / 0.12) * smoothstep01((1 - p) / 0.14) * PEEL_PEAK;
}

/**
 * —— 2026-09-24 C：翻页的三段时间（秒）——
 * 用户原话：「纸张完全是直着翻过去，没有弯曲，只有一半显示出来翻页效果，
 *            纸张落下的效果是没有的」。
 * 以前整套机构只走**可见的那半程弧** 0°↔-90°，后半程靠"提前把内容换成下一页"糊过去
 * —— 于是纸还在半空，字已经是下一页了；"落下"更是无从谈起。
 * 现在规规矩矩扫满 **180°**，并且拆成物理上不同的三段：
 *   lift    0°   → -90°    捏住页角把纸拉起来，越转越快（重力开始帮忙）
 *   fall   -90°  → -186°   过了竖直位置，纸自己往左砸下去，顺带**压过头** 6°
 *   settle -186° → -180°   落在纸堆上被顶回来 —— 这就是要的那一下"落下感"
 */
const FLIP_LIFT = 0.46;
const FLIP_FALL = 0.26;
const FLIP_SETTLE = 0.17;
const FLIP_TOTAL = FLIP_LIFT + FLIP_FALL + FLIP_SETTLE;
/** 落下的过冲角（度）：纸砸到纸堆上会压过去一点再弹回来 */
const FLIP_OVER = 6;

/**
 * 按总进度 u(0..1) 算出这一帧**整张纸**该转到的角度（度）。
 *   dir= 1 往前翻：右手这叶 ⟶ 左边（0 → -180）
 *   dir=-1 往回翻：左手这叶 ⟶ 右边（-180 → 0）
 * ⚠️ ±90° 是纸立起来的那一刻 —— 也是**正反面自动切换**的时刻（见 .diary-face）：
 *   那一刻纸在画面上收敛成一条线，换面看不见。
 */
function flipAngle(u: number, dir: 1 | -1): number {
  const A = dir === 1 ? 0 : -180; // 起点
  const B = dir === 1 ? -180 : 0; // 终点
  const M = (A + B) / 2; // -90，竖直那一瞬
  const O = B - FLIP_OVER * dir; // 落下的过冲终点
  const k1 = FLIP_LIFT / FLIP_TOTAL;
  const k2 = (FLIP_LIFT + FLIP_FALL) / FLIP_TOTAL;
  if (u <= k1) return A + (M - A) * (u / k1) * (u / k1);
  if (u <= k2) {
    const t = (u - k1) / (k2 - k1);
    return M + (O - M) * t * t;
  }
  const t = (u - k2) / (1 - k2);
  return O + (B - O) * (1 - (1 - t) * (1 - t));
}

/**
 * 一次翻页里**四个图层各搬哪一页**。整套新机构的地基 ——
 * 四个位置必须从「正在翻的那一张纸的两面」推导出来，而不是各算各的，
 * 否则就会出现「纸还没落到左边，左边已经显示好落定后的内容」那种错位。
 *
 * 记号：fs = 起手那一跨，ts = 落定那一跨。
 *   dir= 1：被翻的这张纸，正面 = fs.right（此刻正对着读者）、反面 = ts.left（落地后朝上）；
 *           右叶逐步露出的 = ts.right（纸抬起后露出的**下面那张**）；
 *           左叶维持 fs.left（被落下来的纸逐段盖住 —— 物理上就是这样）。
 *   dir=-1：同一张纸反着走 —— 此刻朝上的是 fs.left（= 反面），落地后朝上的是 ts.right（= 正面）；
 *           左叶逐步露出 ts.left；右叶维持 fs.right（被纸盖住）。
 * 封面进出也落在同一套公式里：封面那一跨只有 right（封面页），left 是 null。
 */
interface FlipPlan {
  dir: 1 | -1;
  from: number;
  to: number;
  /** 翻动那张纸的正面（朝向 = 落在右半边时朝上） */
  front: number | null;
  /** 翻动那张纸的反面（落在左半边时朝上） */
  back: number | null;
  /** 静止左叶显示哪一页（null = 什么都不画，露出巧克力封套内衬） */
  left: number | null;
  /** 静止右叶显示哪一页 */
  right: number | null;
}
function planFlip(dir: 1 | -1, from: number, to: number, total: number): FlipPlan {
  /* —— 2026-09-25：改成「按**跨配对**拼四个位置」，而不是「谁减一谁加一」 ——
     以前是 `左 = s−1 / 右 = s+1` 那种按下标加减的写法，隐含假设"相邻两页必属于
     相邻两跨"。加了封底之后这个假设破了：
       · 第 1 跨（左=1 右=2）        与  封面跨（只有右=0）  的页号只差 1~2；
       · 内容末跨（左=17 右=18）     与  封底跨（只有左=19） 也是。
     「内页第一页 ← 回封面」「末页 → 到封底」正是这两种"页号相邻但对开号只差 1"的情形。
     现在一律走 `spreadPages(跨号)` 取两页 —— 封面跨的左页、封底跨的右页本来就是 null，
     "那一叶没内容"这件事由数据自己表达，不需要任何特例分支。
     ⚠️ 2026-09-25 第二轮：封底现在是**独立的"合着的跨"**（见 pageId.ts 的说明），
        它的 `right === null` 且 `isClosed === true` —— 于是下面那两条特例分支
        全部可以删掉，走通用公式即可（`ts.left` 就是封底、`ts.right` 是 null）。 */
  const fs = spreadPages(spreadOfPage(from, total), total);
  const ts = spreadPages(spreadOfPage(to, total), total);
  return dir === 1
    ? { dir, from, to, front: fs.right, back: ts.left, left: fs.left, right: ts.right }
    : { dir, from, to, front: ts.right, back: fs.left, left: ts.left, right: fs.right };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 实习日记（2026-09-16 重写）—— 工作室笔记本物件的「手账翻页本」。
 *
 * 设计参考用户给的示例录屏（130919）：牛皮纸面 + 淡手写字水印 + 纸带标题贴 +
 * 手写编号标题 + 手绘下划线/箭头 + 拍立得相框（纸胶带、微旋转）+ 纸片 chips + 涂鸦。
 *
 * 内容 = src/data/diary.ts。分页口径演进：
 *   2026-09-17 上午：四篇按作者**真实简历**重写，一篇拆三区拼贴塞进**一张纸**。
 *   2026-09-17 下午：用户「字太小了，不需要一个实习一页，改成一段实习中的一个板块
 *     一页，但篇数是按照实习段数」→ 改为**篇的个数 = 实习段数（4 篇）**、
 *     **每篇内部一个板块一页**（篇首 + 板块页 ×N + 复盘页），字号随之放大。
 *     页表由 data/diary.ts 的 DIARY_SHEETS 摊平给出，本文件只管翻页机构与封面。
 *
 * ## 2026-09-23 作者模式可编辑（本轮）
 * 用户要求把日记做成「作者模式下可编辑的手账本」：
 *   · 编辑态 → **单页平铺**（不切 12 条带）+ 底部工具栏 + 图上手柄 + 文字可点改；
 *   · 改动防抖写 IndexedDB，刷新保留；阅读态读到的是同一份覆盖数据。
 * 分工：状态在 lib/diary-editor/context.tsx，图层渲染在 components/diary-editor/*，
 * 本文件只负责「把编辑器和翻页机构接起来 + 页序管理 + 编辑入口」。
 *
 * 交互（用户要求）：**翻页**，不做长滚动。
 *
 * ## 翻页动效的三轮演进（别往回退）
 *   第一轮：整张纸一个元素绕左书脊 `rotateY` —— 用户否掉了：
 *     「没有翻页时的弯曲感，现在是直直地翻过去的」。
 *     根因是 CSS 变换**仿射**：平面矩形转完还是平面矩形，不可能弯。
 *   第三轮：**切条 + 各自自转**，把纸弯成一段**圆弧**（曲率恒定），同时整体公转。
 *     结构 .diary-flip（透视/裁切）＞ .diary-turn（公转）＞ .diary-band ×12（自转）。
 *   第四轮（2026-09-17 用户：「要掀角软纸的手感 —— 从一角掀起、纸面 S 形波浪、
 *     纸张很软」）：**圆弧 → 变曲率弹性曲线**。
 *     唯一改动是曲率分布：第三轮 θ(t)=Θ·t（线性）⇒ 曲率恒定 ⇒ 整张一样弯，像硬卡纸被折；
 *     第四轮 θ(t)=Θ·sin(πt) ⇒ 曲率中段为正、末段为负（有拐点）⇒ 纸在书脊处平切着离开、
 *     中段鼓得最狠、到自由边又放平，高度 z(t) 是一条 **S 形曲线**。
 *     折线仍是主对角线（=「捏住右下角往左上掀」，用户原话），掀起感来自这条斜轴。
 *     几何与参数全在 `applyPeel` 的注释里；位置靠**弧长数值积分**得出（弧长守恒 ⇒
 *     12 条带既不重叠也不在接缝裂开）。
 *   第五轮（2026-09-18，用户指着参考录屏：「我要这种软纸」+ 自己录屏实测「翻页像换页」）：
 *     机构改成**真翻页** —— 底下静态垫好**目标页**（.diary-under），turning 纸
 *     0°→180° 一路绕左书脊扫过去，扫过哪里、下一页就从哪里露出来；
 *     90° 侧面朝人的一瞬纸被本子裁掉（真书也这样），不再有"空白板闪一下"。
 *     旧的「转到 108° 换内容再转回来」两段式机制连同 pendingRef 一起删除。
 *
 * 入口仍是「点击工作室桌面上的笔记本」；关闭（X / Esc / 点遮罩）回工作室。
 */

/* ============================ 外壳：挂 Provider ============================ */

/**
 * 拆成两层是**必须**的：`DiaryEditorProvider` 要拿到"当前是哪一页"，
 * 而页序和页号都住在 provider 里（见 context.tsx 的说明）。
 * 所以外壳只负责挂载/关闭动画，内层（NotebookBody）才消费 provider。
 */
export function NotebookOverlay({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
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

  if (!mounted) return null;
  /* 2026-09-26：实习日记**整本替换**为独立单文件版 book-coil-flip-demo
     （内容在 book 工作区持续精修：四段实习 editorial 版式 + 粉底海报跨页 + 分镜脚本）。
     集成方式：iframe 铺满本子容器 —— book 自带封面/翻页动效/视口自适应
     （--fit 按 iframe 视口实时缩放，见其源码 fit()），打开/关闭动效沿用
     本浮层的 .notebook-page 滑入/收起（is-closing 380ms 与外壳计时一致）。
     ⚠️ 静态整本替换：原 React 日记（NotebookBody）与手账编辑器不再挂载；
        想切回旧版把 BOOK_FILE 改回 false 即可，机构一行未动。 */
  if (BOOK_FILE) return <BookFrame closing={closing} onClose={onClose} />;
  return (
    <DiaryEditorProvider>
      <NotebookBody closing={closing} onClose={onClose} />
    </DiaryEditorProvider>
  );
}

/* —— 整本文件版实习日记（2026-09-26）——
   只保留浮层外壳必需的三件套：遮罩（点击关闭）、本子容器（滑入/收起动画）、
   右上 ✕。ESC 关闭不走 useEscape（那套挂在 NotebookBody 里，本分支不挂载）——
   iframe 同源，onLoad 后直接往 contentWindow 注入 keydown 监听，
   焦点在书里按 ESC 也能冒到父层。 */
function BookFrame({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data === 'diary-book:esc') onClose();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onClose]);
  return (
    <div
      className={`notebook-overlay diary-overlay${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="实习日记"
    >
      <div className="notebook-backdrop" onClick={onClose} />
      <div className="notebook-page diary-book is-book-file">
        <iframe
          ref={frameRef}
          className="diary-book-frame"
          src="./diary-book/index.html?embed=1&v=20260926k"
          title="实习日记"
          onLoad={() => {
            const w = frameRef.current?.contentWindow;
            w?.addEventListener('keydown', (ev) => {
              if (ev.key === 'Escape') onClose();
            });
          }}
        />
      </div>
      <button type="button" className="notebook-close" onClick={onClose} aria-label="关闭日记">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M6 6 L18 18 M18 6 L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

const BOOK_FILE = true;

/* ============================ 主体 ============================ */

function NotebookBody({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const admin = useAdminMode();
  const e = useDiaryEditor();
  const { pageIndex: page, total: TOTAL, pageId, pageOrder } = e;

  const [cropping, setCropping] = useState(false);

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
  /** 本子外壳（.notebook-page）——「合着 ⟷ 摊开」的开本动画在这里 tween `--di-open` */
  const boardRef = useRef<HTMLDivElement>(null);
  /**
   * 「沉到页面内容下面」的图层宿主（编辑态）。
   *
   * 阅读态那一档是 `.dp-layerhost.is-under`（在每条带子里，排在 `.diary-sheet` 之前）；
   * 编辑态不切条、`.dp-canvas` 又是 z=60 整体压在正文之上，所以必须另开一个
   * z=0 且排在 `.diary-sheet` **之前**的空壳（`.dp-under-slot`），
   * 再由 DiaryCanvas 用 portal 把 `under` 图层塞进去。
   */
  const underSlotRef = useRef<HTMLDivElement>(null);
  /** 静态左页（对开视图）—— 它不在翻页层里，所以变量要单独铺一遍（见 setPaperVars） */
  const leftLeafRef = useRef<HTMLDivElement>(null);
  /** 静态右页 —— 2026-09-24 C 新加：翻页层不再常驻，静止时当前的右页就住在这一叶里 */
  const rightLeafRef = useRef<HTMLDivElement>(null);
  const flippingRef = useRef(false);
  /** 开本动画 / 翻页动画在跑 —— 期间不接受新的翻页指令 */
  const busyRef = useRef(false);
  /** ←/→ 键要用的翻页函数（它们在文件更下面才定义，用 ref 过桥，免得 TDZ / eslint 咬人） */
  const goNextRef = useRef<() => void>(() => {});
  const goPrevRef = useRef<() => void>(() => {});
  /** 翻页收尾之后要接着做的事（目前只有「收窄回封面」） */
  const afterFlipRef = useRef<null | (() => void)>(null);
  /** 竖带的像素边界 [0, b1, … , W] —— clip-path 与每条带的中心都从这儿取 */
  const boundsRef = useRef<number[]>([]);
  /**
   * 翻页进行中的**内容分工表**：null = 静止（此时左右两叶各显示自己那一页）。
   * ⚠️ 和第五~第七轮的最大区别：这里**不再是"底下垫一页"那种补丁**，而是把
   *    「正在翻的那一张纸的两面」和「底下两叶各留哪一页」一次性算清楚（见 planFlip）。
   */
  const [pageTurn, setPageTurn] = useState<null | FlipPlan>(null);

  /**
   * 给一个"纸面容器"铺纸面变量 —— .diary-flip 之外还有一个静态左页需要铺
   * （左页不在翻页层里，拿不到 flip 继承下来的变量，缺了它们左边的内容会按 1:1 排 → 溢出）。
   */
  const setPaperVars = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!W || !H) return;
    el.style.setProperty('--dp-scale', String(W / REF_W));
    el.style.setProperty('--dp-fit', String(fitOf(el)));
    el.style.setProperty('--dp-pw', `${W}px`);
    el.style.setProperty('--dp-ph', `${H}px`);
  }, []);

  /**
   * 量一次竖带边界并把 clip-path 铺好（只在挂载 / 改尺寸时跑，翻页过程中不动）。
   * ⚠️ 用**四舍五入后的像素边界**而不是百分比：相邻两条带共享同一个边界值，
   *    各自取整不会在接缝处漏出一条发丝亮线（百分比会各算各的、在奇数列宽下对不齐）。
   * 顺带把几个纸面尺度的变量挂到 flip 上：
   *   `--dp-scale` 纸面实际宽 / 设计基准宽 —— 用户贴纸的字号按它缩放，换屏幕时字号
   *                跟着纸等比变，版式不会散；
   *   `--dp-pw` / `--dp-ph` 纸面像素宽 / 高 —— **结构元素**的位移按"纸面比例"记
   *                （0.05 = 挪动纸宽的 5%），渲染时要靠这两个量换算成 px。
   */
  const layoutBands = useCallback(() => {
    /* ⚠️ 2026-09-24 C：一律以 **.diary-turn**（= 一张纸那么大）为基准，不能再拿 .diary-flip。
       翻页层现在横跨整副对开（宽 = 2 张纸），用它算出来的一切纸面比例都会大一倍
       ⇒ 内容以 2 倍尺寸撑出纸外（同一类坑在 B 步骤的 under-spread 上出过一次）。 */
    const turn = turnRef.current;
    if (!turn) return;
    const W = turn.clientWidth;
    if (!W) return;
    turn.style.setProperty('--dp-scale', String(W / REF_W));
    /* 整页内容的等比缩放比（见 DESIGN_PAGE_W / fitOf 的注释）—— 新版 A4 页面更窄，
       不缩放会溢出。⚠️ 必须按 .diary-sheet 的**内容盒**算，按纸宽算会偏大 ⇒ 溢出。 */
    turn.style.setProperty('--dp-fit', String(fitOf(turn)));
    turn.style.setProperty('--dp-pw', `${W}px`);
    turn.style.setProperty('--dp-ph', `${turn.clientHeight}px`);
    const b = Array.from({ length: BAND_COUNT + 1 }, (_, i) =>
      Math.round((i / BAND_COUNT) * W),
    );
    boundsRef.current = b;
    /* ⚠️ 写 `--clip` 而不是直接写 clip-path：缝是写在**两个面**上的
       （clip-path 会把元素自身拍平、正反面就立不起来），自定义属性能继承过去，
       两面共用同一条缝 ⟹ 接缝不会因为左右取值不同而错开。 */
    bandRefs.current.forEach((el, i) => {
      if (!el) return;
      /* —— 相邻带各让出 1px 互相重叠（2026-09-25）——
         折纸之后相邻两带在 3D 里**共边**（见 applyPeel），但它们是各自栅格化的
         两个合成层，边缘抗锯齿仍会叠出一条发丝亮的缝。1px 重叠把它吃掉；
         重叠区画的是同一份纸面内容，位移差 < 0.1px，看不出重影。
         首带左缘 / 末带右缘**不外扩** —— 那边已经是纸的边，扩出去只会露出纸外的空白。 */
      const l = i === 0 ? b[i] : Math.max(0, b[i] - BAND_BLEED);
      const r = i === BAND_COUNT - 1 ? b[i + 1] : Math.min(W, b[i + 1] + BAND_BLEED);
      el.style.setProperty('--clip', `inset(0 ${(W - r).toFixed(2)}px 0 ${l.toFixed(2)}px)`);
      /* 折纸的转轴 = 这条带**自己的左边界**（不是元素左边缘 0），见 applyPeel。 */
      el.style.transformOrigin = `${b[i]}px 50%`;
      /* 高光渐变只覆盖本带这一段（元素本身是整页大，不定位的话渐变会横跨整页） */
      el.style.setProperty('--sheen-size', `${(r - l).toFixed(2)}px 100%`);
      el.style.setProperty('--sheen-pos', `${l.toFixed(2)}px 0`);
    });
  }, []);

  /**
   * 把「掀起量 amount(0..1)」落到每条竖带上。**纸面本体也在带子里**（.diary-paper），
   * 所以牛皮纸底 / 水印 / 装饰跟文字一起被这条曲线带着弯（2026-09-17 修"纸不动"）。
   *
   * 模型（**第六轮** 2026-09-18，用户指着参考录屏：「我要这种软纸」+ 反馈"分割的样子"）：
   * 之前的第五轮用**对角轴** rotate3d(W,−H) 给每条带叠了一个扭转 —— 这导致 sheet 的边缘
   * 是一条**斜线**，跟底下那页（对角轴不动）之间也是斜的接缝，用户录屏里看到的就是这两块
   * 平面以斜角拼在一起 =「分割的样子」。
   * 参考视频里整张是围着**竖直书脊**转的平面（轻微弯，没有扭转），sheet ↔ 底页的接缝是**竖直**
   * 的 —— 这才是"软纸翻页"的正确接缝方向。
   *
   * ⚠️ 2026-09-25 第八轮：**带内加回旋转 —— 但只绕竖直轴（rotateY），做成真折纸**。
   *    上面"不做 rotate3d"指的是**别再给对角轴的扭转**（那会造出斜接缝，第六轮的结论不变）；
   *    但"一点旋转都不给"会掉进另一个坑：只给 translate3d 时，相邻两带的边界是
   *    3D 空间里**两个不同的点**、且 z 不同 ⟹ 被透视放大不同的倍数 ⟹ 投影后裂开
   *    1~3px 的缝 —— 用户录屏里的「分割条纹」就是这一排缝，光靠位移补不回来。
   *    给每条带绕**竖直**轴转它那一段的切向角 θ_i 之后：
   *      · 接缝仍是竖直的（没有扭转，第六轮的结论保住）；
   *      · 带 i 的右边界与带 i+1 的左边界落在**同一个 3D 点**上 ⟹ 无论怎么投影都重合。
   *    推导见 applyPeel 里 2026-09-25 那段注释。
   *
   * 弯的位置仍由弧长积分给出：
   *     切向角  θ(t) = Θ · sin(πt)        Θ = PEEL_MAX × amount
   *     位置    x(t) = W∫₀ᵗ cosθ du,  z(t) = W∫₀ᵗ sinθ du
   * 积分得到的 bx[] / bz[] 是每条带**边界**落在弧上的位置，位移与转角都由它派生。
   * transform-origin 由 layoutBands 写成 `${b[i]}px 50%`（带的左边界）—— 折纸的转轴
   * 必须在这里，写成元素中心或 0 都会让带与带错开。
   *
   * 高光（--sheen）：sheen 还是按 θ 比例给 —— 没有 rotate3d 之后"倾角"换成 sin(θ)，数值大小、
   * 范围照旧，视觉上仍是一道淡光从书脊扫向自由边。
   */
  const applyPeel = useCallback((amount: number) => {
    /* ⚠️ 收平 band 的动作**必须放在所有 early-return 之前**（2026-09-25 加固）。
       历史坑：`turnRef.current` 为 null（翻页层已卸载）时下面 `if (!turn0) return;`
       会静默跳过全部清理 —— 万一某条路径在"层已卸载但 band 引用还在"的窗口里
       调了 applyPeel(0)，12 条带就会**永久留着上一帧的 transform**，静止页面上
       表现为「整页被切成竖条、每条内容错位」（用户截图里的"分割"就是这个形态）。
       现在：无论 turn 在不在，amount≈0 时一律先把所有带的 transform / sheen 清干净，
       再去算后续几何。清理是幂等的，多清一次没有副作用。 */
    const theta = PEEL_MAX * amount;
    if (theta < 1e-4) {
      bandRefs.current.forEach((el) => {
        if (!el) return;
        el.style.transform = 'none';
        el.style.setProperty('--sheen0', '0');
        el.style.setProperty('--sheen1', '0');
      });
    }
    /* ⚠️ W 必须取 **.diary-turn** 的宽度（= 一张纸），不是 .diary-flip（= 两叶）
       —— 理由同 layoutBands。 */
    const turn0 = turnRef.current;
    const b = boundsRef.current;
    if (!turn0 || b.length < 2) return;
    const W = turn0.clientWidth;
    if (!W) return;
    /* 卷曲方向恒为 +1（朝读者鼓）。第七轮的教训：往前翻曾用 -1（往纸背鼓），
       结果带子被推到屏幕里侧（实测 z 到 -222px）——被透视缩小、还会垫到静止页
       **后面**被遮住，中段画面变成"放大的纸面碎片 + 左右各露一条旧页"，
       用户录屏里就是"分割的样子"。物理上两个方向都是"纸朝读者掀"，鼓向一致。 */
    const sign = 1;
    if (theta < 1e-4) return; /* 已经清干净了（见函数开头） */
    /* 弧长积分：把 [0,1] 切成 BAND_COUNT×SUB 段，逐段中点法累加 (cosθ, sinθ)·W·du。
       SUB=8 ⇒ 96 次三角函数 / 帧，可忽略；12 条带精度绰绰有余。
       只存每条带的**边界点**，带中心取相邻边界的中点。 */
    const SUB = 8;
    const du = 1 / (BAND_COUNT * SUB);
    const bx: number[] = [0];
    const bz: number[] = [0];
    let x = 0;
    let z = 0;
    for (let i = 0; i < BAND_COUNT; i++) {
      for (let k = 0; k < SUB; k++) {
        const u = (i * SUB + k + 0.5) * du;
        const th = theta * peelShape(u);
        x += W * du * Math.cos(th);
        z += W * du * Math.sin(th);
      }
      bx.push(x);
      bz.push(z);
    }
    const sinPeak = Math.sin(theta * PEEL_PEAK) || 1;
    bandRefs.current.forEach((el, i) => {
      if (!el || b[i] === undefined || b[i + 1] === undefined) return;
      /* —— 2026-09-25：从「平移拼弧」改成**真折纸** ——
         旧写法只给每条带一个 translate3d(dx, 0, cz)：
           带 i   的右边界落在 (b[i+1] + dx_i,     cz_i)
           带 i+1 的左边界落在 (b[i+1] + dx_{i+1}, cz_{i+1})
         这是 3D 空间里**两个不同的点**，而且 z 不一样 ⟹ perspective 把两点
         放大不同的倍数 ⟹ 投影后分开 1~3px（中段 z 变化最快时最宽）——
         用户录屏里的「分割条纹」就是这一排缝。位移是刚体的，弥补不了。
         折纸的正解是让**相邻带共享同一个 3D 边界点**：
           带 i 先平移到弧点 (bx[i], bz[i])，再**绕自己的左边界**转 φ_i
           ⟹ 右边界正好落在 (bx[i+1], bz[i+1])，与下一条带的左边界是同一个点，
              无论投影像机怎么放大，同一个点只能投影到同一处 ⟹ 几何上不可能裂开。
         段 i 是一段**直的**纸：它的长度是弧上两点 (bx[i],bz[i])→(bx[i+1],bz[i+1]) 的
         **弦长 L**（不是弧长 Δ），方向是这条弦的**方向角 φ** —— 于是
             transform = translate3d(到弧点 i) · rotateY(−φ) · scaleX(L/Δ)
         末端精确落在 (bx[i+1], bz[i+1])，与下一条带的起点**逐位相同**（残差只有浮点
         误差；实测用"段中点角"近似时最大还有 0.77px 的错位）。
         ⚠️ scaleX 不是凑数的：段的弧长是 Δ 而弦长 L 略短（差 ~0.05%，肉眼不可见），
            不补这一下段与段就会在末端差出那一点点、又变成缝。 */
      const dxSeg = bx[i + 1] - bx[i];
      const dzSeg = bz[i + 1] - bz[i];
      const L = Math.hypot(dxSeg, dzSeg);
      const phi = Math.atan2(dzSeg, dxSeg);
      const segW = b[i + 1] - b[i];
      const sx = segW > 0 ? L / segW : 1;
      el.style.transform =
        `translate3d(${(bx[i] - b[i]).toFixed(3)}px, 0, ${(sign * bz[i]).toFixed(3)}px)` +
        ` rotateY(${(-phi).toFixed(5)}rad) scaleX(${sx.toFixed(5)})`;
      /* 高光：倾角越大受光越多 —— 一道淡光顺着折线从书脊扫向自由边。
         ⚠️ 2026-09-25 改成**带内渐变**（--sheen0 → --sheen1，取值在带的两端），
         旧的一条带一个常数会让 12 段之间亮度跳变 = 条纹。 */
      const s0 = 0.18 * amount * (Math.sin(theta * peelShape(i / BAND_COUNT)) / sinPeak);
      const s1 = 0.18 * amount * (Math.sin(theta * peelShape((i + 1) / BAND_COUNT)) / sinPeak);
      el.style.setProperty('--sheen0', s0.toFixed(4));
      el.style.setProperty('--sheen1', s1.toFixed(4));
    });
  }, []);

  /* 收尾标记：onComplete 只安排换页（React 提交），transform 的清理挪到下方
     useLayoutEffect —— 和「换内容 + 卸 under」同一个 commit、paint 之前执行。 */
  const settlePendingRef = useRef(false);

  /**
   * **把翻页机构架起来（但不播放）** —— 返回一个控制器 `{ tl }`。
   *
   * 抽出来的原因：翻页有两条驱动路径 ——
   *   ① 点箭头 / 按方向键：`flipTo` 架好后立刻 `tl.play()` 一条龙扫完；
   *   ② 拖页角（2026-09-25）：`pointerdown` 时架好并 `tl.pause()`，
   *      之后由 `pointermove` 把手指位移映射成进度 `tl.progress(p)` 跟手，
   *      松手再决定 `play()` 提交还是 `reverse()` 弹回。
   * 两条路必须**共用同一套姿态摆法**（起点角、transformOrigin、is-flipping、
   * applyPeel(0)、layoutBands），否则拖起来的纸和点出来的纸会长得不一样。
   */
  const armFlip = useCallback(
    (plan: FlipPlan, dir: 1 | -1, onDone?: () => void): { tl: gsap.core.Timeline } | null => {
      /* ① 先把翻页层**同步**挂出来（flushSync）。
            时间轴第一帧就得拿到 turn / 12 条带 / 两个纸面，否则给的是 null，
            动画只能退化成"直接换页"；也保证了"翻页层出现的那一帧"
            与"底下两叶换成什么"是同一个 commit，不会有半帧错位。 */
      flushSync(() => setPageTurn(plan));
      const el = flipRef.current;
      const turn = turnRef.current;
      if (!el || !turn) {
        setPageTurn(null);
        e.setPageIndex(plan.to);
        onDone?.();
        return null;
      }
      flippingRef.current = true;
      afterFlipRef.current = onDone ?? null;
      /* ② 摆好起点姿态。**必须与上面那个 commit 同一帧** —— dir=-1 的起点是 -180°
         （纸反着平铺在左边），不以 -180° 出场的话第一帧会以 0° 闪一下错误页面。 */
      gsap.set(turn, { transformOrigin: 'left center', rotationY: flipAngle(0, dir) });
      applyPeel(0);
      layoutBands();
      el.classList.add('is-flipping');
      const st = { u: 0 };
      const tl = gsap
        .timeline({
          /* id 供无头验证 gsap.getById('diary-flip') 定格逐帧检查（生产无副作用） */
          id: 'diary-flip',
          paused: true,
          onComplete: () => {
            // **不要在这里同步清 transform**：rAF 回调里安排的 React 更新走
            // MessageChannel 宏任务，提交可能落在下一次 paint 之后 —— 若此刻把
            // turn 收平，两叶还是旧内容（提交没落地），旧页会平铺闪一帧。
            // 正确做法：只安排换页，清理交给 useLayoutEffect（settlePendingRef）
            // —— 与换页同一个 commit、paint 之前执行。
            // ⚠️ 这里刻意用 // 而不是 /* */：这段注释夹在 GSAP 配置**对象字面量**
            //    的中间（onComplete: () => {...}, 与 onReverseComplete: ... 之间），
            //    块注释一旦被误删掉收尾的 */ 就会把后面的键名一起吞掉，
            //    报 "Unexpected character '—'"（2026-09-25 实测踩过）。
            e.setPageIndex(plan.to);
            setPageTurn(null);
            el.classList.remove('is-flipping');
            settlePendingRef.current = true;
          },
          /* —— 弹回（拖动没过半）收尾 ——
             ⚠️⚠️ 2026-09-25 补：**没有这一段就会把整本书锁死**。
             `onBookPointerUp` 的弹回分支走 `tl.reverse()`，它只触发
             `onReverseComplete`，**永远不触发 `onComplete`** —— 于是：
               · `setPageTurn(null)` 没执行 ⟹ 翻页层（.diary-turn + 12 条带）
                 一直挂在 DOM 里；
               · `flippingRef.current` 没被清 ⟹ 它的守卫
                 `if (flippingRef.current || closing) return;`（见 flipTo）
                 把之后**每一次**翻页请求全部吞掉。
             用户看到的就是「这一页再翻翻不动了」+ 纸面残留一条错位竖带
             （dragRef 松手后 tl 停在 0，但 12 条带的 transform 没被 applyPeel(0)
              收干净 / 或停在半程）。
             这里**不换页**（弹回 = 什么都没发生）——只做"拆台"三件事：
             卸层、去 class、清闸门。走 settlePendingRef 让下方 useLayoutEffect
             在同一个 commit 里把 transform 收平，语义与 onComplete 一致。
             ⚠️ 同样用 // 行注释（见上）：夹在配置对象里，块注释易被误删收尾符。 */
          onReverseComplete: () => {
            setPageTurn(null);
            el.classList.remove('is-flipping');
            settlePendingRef.current = true;
          },
        })
        /* 阴影跟着纸走：抬起时沿书脊压一道深影（纸离开了纸面），落下时淡出 */
        .to(shadeRef.current, { opacity: 0.42, duration: FLIP_LIFT * 0.7, ease: EASE.in }, 0)
        .to(
          shadeRef.current,
          { opacity: 0, duration: FLIP_FALL + FLIP_SETTLE, ease: EASE.world },
          FLIP_LIFT * 0.7,
        )
        .to(
          st,
          {
            u: 1,
            duration: FLIP_TOTAL,
            /* 时间轴本身走直线，曲线全在 flipAngle 里 */
            ease: 'none',
            onUpdate: () => {
              gsap.set(turn, { rotationY: flipAngle(st.u, dir) });
              applyPeel(curlBump(st.u));
            },
          },
          0,
        );
      /* dev-only：把时间轴挂到 window，无头验证可以 pause/time() 定格逐帧；
         import.meta.env.DEV 在生产构建里是常量 false，整行会被摇掉。 */
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__diaryFlip = tl;
      return { tl };
    },
    [applyPeel, layoutBands, e],
  );

  const flipTo = useCallback(
    (target: number, dir: 1 | -1, onDone?: () => void) => {
      /* ⚠️ 2026-09-25 去掉了一条早退：原来写 `target === page` 就 return。
         它本意是"已经在那一页了别重复翻"，但加了封底之后**翻到封底**这一下
         是"跨要前进、页号却没变"的（末跨右页 = null，翻过去后 page 仍是那个左页的
         下标），于是这一下会被自己吃掉 —— 点下一页毫无反应。
         改判**跨**：跨号没变才是真的没得翻。 */
      if (flippingRef.current || closing) return;
      if (target < 0 || target >= TOTAL) return;
      /* ⚠️ 判据用**跨号**（传 TOTAL）：末跨 → 封底这一下是"跨前进、页号只跳到
         封底那一页"的，用页号比会误判（详见 pageId.ts spreadOfPage 的注释）。 */
      if (spreadOfPage(target, TOTAL) === spreadOfPage(page, TOTAL)) return;
      if (busyRef.current) return;
      /* ⚠️ 编辑态必须也能换页 —— 用户口径是「书内每一页、封面都能改文字 / 加贴纸」。
         但编辑态是**单页平铺**（没有 12 条带、也没有 .diary-turn），卷曲翻页动画
         在这里无从演起，所以直接换页号。（方向键在编辑态仍然禁用：那时要留给
         文字里的光标移动，见下面的 keydown 分支。） */
      if (e.editing) {
        e.setPageIndex(target);
        onDone?.();
        return;
      }
      const plan = planFlip(dir, page, target, TOTAL);
      if (plan.front == null && plan.back == null) {
        e.setPageIndex(target);
        onDone?.();
        return;
      }
      const arm = armFlip(plan, dir, onDone);
      if (!arm) return;
      /* ③ 一条时间轴扫满 180°：抬起 → 砸下（过冲）→ 回弹。
            角度由 flipAngle(u) 唯一决定，没有"中途换内容"这一步 —— 纸是用自己的
            **背面**（.diary-face.is-back）走完后半程的，转到 90° 时由 CSS 的
            backface-visibility 自动换面（那一刻纸在画面上是一条线，看不见）。 */
      arm.tl.play();
    },
    [page, closing, armFlip, e, TOTAL],
  );

  /**
   * 把本子从「合着」摊到「对开」（或反过来）—— 用户要的**开本动画**的一部分：
   * 「封面翻页时不要现在直接从单页到双页…把封面先右移，再展开左部分」（2026-09-24 C）。
   *
   * 实现上只 tween **一个 CSS 变量** `--di-open`（0 ⟷ 1），其余全部派生：
   * 本子总宽、左叶宽度、书脊位置、线圈位置、露出的封皮边 —— 都在 index.css 里
   * 写成关于它的 calc()。好处是这些量永远不会互相错位（没有"哪个先动哪个后动"）。
   */
  const tweenOpen = useCallback(
    (to: 0 | 1, duration: number, onDone?: () => void) => {
      const board = boardRef.current;
      if (!board) {
        onDone?.();
        return;
      }
      const cur = Number.parseFloat(getComputedStyle(board).getPropertyValue('--di-open'));
      const from = Number.isFinite(cur) ? cur : to === 1 ? 0 : 1;
      gsap.set(board, { '--di-open': from });
      gsap.to(board, {
        '--di-open': to,
        duration,
        ease: EASE.world,
        onComplete: () => {
          /* 尺寸变了 ⇒ 所有按"当时宽度"算出来的 px 东西都要重量一遍：
             带子边界（--clip）、纸面比例（--dp-fit）。少这一步会露出错位的竖条。 */
          layoutBands();
          applyPeel(0);
          setPaperVars(leftLeafRef.current);
          setPaperVars(rightLeafRef.current);
          onDone?.();
        },
      });
    },
    [layoutBands, applyPeel, setPaperVars],
  );

  /* 翻页收尾：与「换内容 + 卸翻页层」同一个 commit、paint 之前把 turn 的旋转
     和带子位移收掉。 */
  useLayoutEffect(() => {
    if (!settlePendingRef.current) return;
    settlePendingRef.current = false;
    const turn = turnRef.current;
    if (turn) gsap.set(turn, { clearProps: 'transform,transformOrigin' });
    applyPeel(0);
    flippingRef.current = false;
    /* 收尾之后的接力（目前只有「把本子收回封面尺寸」）—— 放在这里是为了等
       翻页层真正卸载完，否则会出现"本子在缩小、旁边还挂着一张翻过去的纸"。 */
    const after = afterFlipRef.current;
    afterFlipRef.current = null;
    if (after) after();
  }, [page, pageTurn, applyPeel]);

  /* 挂载 / 改尺寸时重新量一次带子边界（clip-path 是 px，viewport 一变就得重算），
     并把纸摆回完全摊平的状态。 */
  useLayoutEffect(() => {
    layoutBands();
    applyPeel(0);
    setPaperVars(leftLeafRef.current);
    setPaperVars(rightLeafRef.current);
    const onResize = () => {
      layoutBands();
      applyPeel(0);
      setPaperVars(leftLeafRef.current);
      setPaperVars(rightLeafRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [layoutBands, applyPeel, setPaperVars]);

  /* 每次打开都从**合着的封面**开始（保持原有行为）。
     ⚠️ 依赖 [] —— 外壳负责挂载，每次 open 都是重新挂一个 Body。
     `--di-open` 也要在这里摆到 0（合着）：它是唯一的几何总开关，
     CSS 里的默认值给的是"摊开"，不显式置 0 的话一上来就是全宽的对开。 */
  useEffect(() => {
    e.setPageIndex(0);
    boardRef.current?.style.setProperty('--di-open', '0');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 兜底：一页内容若因视口偏矮而溢出，每条竖带的 .diary-sheet 会各自成一个滚动容器 ——
     12 条各滚各的会把纸面滚裂。这里把它们的 scrollTop 锁在一起（滚动条本体已在
     .diary-sheet 里藏掉），溢出时读起来就是"整页一起滚"。
     换页会重建 .diary-sheet（key={page}），所以按 page 重新收集并复位。 */
  useLayoutEffect(() => {
    const flip = flipRef.current;
    if (!flip) return;
    const sheets = Array.from(flip.querySelectorAll<HTMLElement>('.diary-sheet')).filter(
      (s) => !s.closest('.diary-under'),
    );
    sheets.forEach((s) => {
      s.scrollTop = 0;
    });
    const onScroll = (e2: Event) => {
      const src = e2.currentTarget as HTMLElement;
      const top = src.scrollTop;
      for (const s of sheets) {
        if (s !== src && s.scrollTop !== top) s.scrollTop = top;
      }
    };
    sheets.forEach((s) => s.addEventListener('scroll', onScroll, { passive: true }));
    return () => sheets.forEach((s) => s.removeEventListener('scroll', onScroll));
  }, [page, pageTurn, e.editing]);

  /* Esc：编辑态先退出编辑，阅读态才关本子。
     走全站统一的 Esc 栈（@/lib/escape-stack）—— 这一页可能盖在别的浮层之上，
     只有"栈"能保证一次按键只关最上面那层。 */
  useEscape(() => {
    if (e.editing) e.setEditing(false);
    else onClose();
  }, true);

  /* ←/→ 翻页。编辑态禁用 —— 那时方向键是"在文字里移动光标"。
     ⚠️ 走 goNext/goPrev（**整跨**前进），不能写成 page±1：新的机构一次翻的是
        "一张纸 = 一个新跨"（左叶跟着一起换），单页步进会让左右两叶的内容错配。 */
  useEffect(() => {
    if (e.editing) return;
    const onKey = (e2: KeyboardEvent) => {
      if (e2.key === 'ArrowRight') goNextRef.current();
      else if (e2.key === 'ArrowLeft') goPrevRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [e.editing]);

  /* 进入 / 退出编辑态：清掉裁切态、把纸收平（编辑态不切条，但退出时要恢复）。 */
  useEffect(() => {
    setCropping(false);
    if (!e.editing) {
      layoutBands();
      applyPeel(0);
    }
  }, [e.editing, layoutBands, applyPeel]);

  /* ---------------- 页序操作 ---------------- */

  const addPage = useCallback(() => {
    const id = e.addPageAfter(pageId);
    /* 新页紧跟在当前页后面 → 页号 +1。直接设页号（不走翻页动画）：
       页序变化与翻页时间轴并行会让 band 的 key 与内容错配。 */
    const at = page + 1;
    requestAnimationFrame(() => {
      e.setPageIndex(id ? at : page);
      e.setEditing(true);
    });
  }, [e, page, pageId]);

  const deletePage = useCallback(() => {
    const ok = e.removePage(pageId);
    if (!ok) return;
    e.setPageIndex(Math.max(0, page - 1));
  }, [e, page, pageId]);

  /* ---------------- 渲染一页 ---------------- */

  /**
   * 渲染**任意一页**的纸面内容 —— 翻页时"底下那页"要用目标页的内容，
   * 所以从 `sheet` 常量改成按索引的函数。
   * React 元素是不可变的描述对象，同一个元素用在多个位置是安全的（React 内部自己 clone）；
   * 里面的 `<img src>` 也是同一个 URL，走同一份解码缓存，不会真下 12 遍。
   *
   * ⚠️ 外面必须套 `<PageScope id>`：翻页时 DOM 里**同时有两页**（翻走的 + 底下垫的），
   *    页内的 EditableText / PageEl 如果都去读 `api.pageId`，底下那页会拿到当前页的
   *    文字覆盖与元素位移 —— 翻页过程中能看到文字/贴纸"跳"一下。作用域给出真页 id。
   *
   * 封面上的每块东西也都登记成了**结构元素**（用户：「上面的所有东西都可以移动」）：
   * 纸胶带、标题组（含手绘圈）、英文副题、副行、提示纸片 —— 各自可拖动/缩放/旋转。
   */
  const renderSheet = (idx: number) => {
    const id = pageOrder[idx] ?? 'cover';
    if (id === BACK_PAGE_ID) {
      /* ================= 封底（2026-09-25）=================
         用户要求「内页最后一页下一页回到封底」。它和封面是一对：
         封面的正面朝上；封底是**同一块板的背面**，所以配色反过来 ——
         巧克力满版底 + 薄荷元素（封面是薄荷底 + 巧克力元素），
         挂在书的最后一张纸上，翻过来正好朝向读者。 */
      return (
        <PageScope id={id}>
          <div className="diary-cover is-back" aria-label="封底">
            {/* 2026-09-25 按用户口径简化：撤掉内框与光影，只留波点 + 薄荷字
               （波点画在 CSS 的 .diary-cover.is-back::before） */}
            <El slot="btitle" label="封底标题" as="div" className="diary-cover-titlewrap">
              <h2 className="diary-cover-title">
                <EditableText slot="btitle" value="实习日记" />
              </h2>
            </El>
            <El slot="ben" label="封底英文" as="p" className="diary-cover-en">
              <EditableText slot="ben" value={DIARY_COVER_EN} singleLine />
            </El>
            {/* 2026-09-25 晚：封底落款已删（用户：「删掉这些文字」） */}
            <El slot="byear" label="封底年份" as="span" className="diary-cover-back-year">
              <EditableText slot="byear" value="2026" singleLine />
            </El>
          </div>
        </PageScope>
      );
    }
    const def = SHEET_BY_ID.get(id);
    if (!def) {
      return (
        <PageScope id={id}>
          <BlankPage />
        </PageScope>
      );
    }
    if (def.kind === 'cover') {
      /* ================= 封面（2026-09-25 晚 · 第三版，按用户新设计稿）=================
         设计稿（剪贴板截图 636×747）：
           · 左缘一条**亮青绿竖条 #36e2de**（实测取色），内含一列白点；
           · 主体是**薄荷花照片**（src/assets/diary-cover-photo.jpg，cover 铺满，
             照片底色 #b9d0cb 浅青灰）；
           · 标题「实习日记」+ 英文副题 = **薄荷青绿 #78efca**（实测取色），排上部；
           · 照片的花上**白色手绘描线**（.diary-cover-flower SVG，无星星、无波点阵）。
         封底同轮改**薄荷绿底**（用户：「封底也是薄荷绿的」），深字 + 白波点。 */
      return (
        <PageScope id={id}>
          <div className="diary-cover is-cover">
            {/* —— 背景装饰层 ——
                2026-09-25 晚末版：白描线花 SVG 已删（用户：「删掉这个花」——
                照片上不叠手绘线了）；deco 里只剩左缘青绿点条。
                提示纸片 chip 也已删（用户：「删掉这些文字」）。 */}
            <div className="diary-cover-deco" aria-hidden="true">
              <span className="diary-cover-band" />
            </div>
            <El slot="titlewrap" label="封面标题（含手绘圈）" as="div" className="diary-cover-titlewrap">
              <h2 className="diary-cover-title">
                <EditableText slot="title" value="实习日记" />
              </h2>
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
            </El>
            <El slot="en" label="英文副题" as="p" className="diary-cover-en">
              <EditableText slot="en" value={DIARY_COVER_EN} singleLine />
            </El>
            <El slot="sub" label="副行" as="p" className="diary-cover-sub">
              <EditableText slot="sub" value="Thinking / Process" singleLine />
            </El>
          </div>
        </PageScope>
      );
    }
    return (
      <PageScope id={id}>
        <DiaryPage sheet={def} />
      </PageScope>
    );
  };

  /** 翻页机构里各层该搬哪一页的内容（见 pageTurn 注释）
   *  ⚠️ turnIdx / underIdx 现在在下方 spread IIFE 内按 pageForFlip 重新计算，这里不再需要。 */

  /**
   * 纸面本体（纸底 + 颗粒 + 手写字水印 + 点阵装饰）—— 多处复用（12 条带各一份
   * + 翻页时"底下那页"一份 + 编辑态单页一份）。水印随纸一起翻（2026-09-17 修"纸不动"）；
   * 每条带各自只 clip 出自己那一条，合起来每个水印仍然只出现一次。
   *
   * **按页号取装饰**（2026-09-22 用户：「把实习日记中除了第一页，删掉其他页中的
   * 花朵、ascll 画、2026 元素」）：
   *   · idx=0（封面）→ 全套：花朵 + ASCII 大丽花 +「2026」水印；
   *   · 其余页       → `diaryPlain`（无花无字符画）+ 不渲染「2026」水印。
   *
   * **2026-09-23 按页取纸张**（用户：「[纸张] 按钮弹出面板，按当前页独立设置」）：
   *   · kind 决定材质（空白纸 / 方格纸 / 纹理纸）；
   *   · `--dp-paper-color` 决定纸色（用户取色器选的），牛皮纸的渐变两端由 JS 算好。
   *   没设过 → 就是原来那张牛皮纸，逐像素不变。
   */
  const paperSurfaceFor = (idx: number) => {
    const id = pageOrder[idx] ?? 'cover';
    const paper = e.paperOf(id);
    const kind: PaperKind = paper?.kind ?? 'kraft';
    const color = paper?.color;
    const vars: Record<string, string> = {};
    if (color) {
      vars['--dp-paper-color'] = color;
      if (kind === 'kraft') {
        vars['--dp-paper'] = color;
        vars['--dp-paper-2'] = lighten(color, 0.42);
      }
    }
    return (
      <div
        className={`diary-paper dp-paper is-${kind}${idx === 0 ? ' is-cover' : ''}`}
        style={vars as React.CSSProperties}
        aria-hidden="true"
      >
        {/* ⚠️ 封面叶（idx===0）不挂水印 / PageDecor：2026-09-25 晚封面换成
            薄荷花**照片**底后，这些本在巧克力深底上隐形的装饰（深色花剪影、
            ASCII 花、polka 点阵带、手写水印）全在浅色照片上显形了，
            设计稿里封面就是干净的照片 —— 内页/封底照旧保留。 */}
        {idx !== 0 ? (
          <>
            <span className="diary-wm is-1">keep going</span>
            <span className="diary-wm is-3">idea!</span>
            <span className="diary-wm is-4">to be continued</span>
            <PageDecor variant="diaryPlain" />
          </>
        ) : null}
      </div>
    );
  };

  /**
   * 一页上用户自己贴的图层（阅读态画在每条带里，跟着纸一起弯）。
   *
   * 分两档（用户 2026-09-23：「贴纸点击置于底层没反应」）：
   *   · `normal` → `.dp-layerhost`（z-index 2）：压在页面内容**之上**，默认档；
   *   · `under`  → `.dp-layerhost.is-under`（z-index 0）：画在纸张**之上**、页面文字/相框**之下**。
   * ⚠️ under 档必须排在 `.diary-sheet` **之前**：同档（z-index:0 的定位元素）按**树序**绘制，
   *    顺序是 纸 → 它 → sheet 内容。写在 sheet 后面就会被正文盖不住反而盖住正文。
   */
  const layerHostFor = (idx: number, tier: 'normal' | 'under' = 'normal') => {
    const id = pageOrder[idx] ?? 'cover';
    const all = e.layersOf(id);
    const layers = all.filter((l) => (tier === 'under' ? !!l.under : !l.under));
    if (!layers.length) return null;
    return (
      <div className={`dp-layerhost${tier === 'under' ? ' is-under' : ''}`}>
        {layers.map((l) => (
          <LayerView key={l.id} layer={l} mode="band" passive />
        ))}
      </div>
    );
  };

  const editing = e.editing;

  /* —— 当前页所属的篇（0..3）—— 侧面章节标签的高亮判据。
     封面 / 封底不属于任何一篇 → -1（四枚标签全部收平）。 */
  const curSheet = SHEET_BY_ID.get(pageId);
  const curChapter =
    curSheet && curSheet.kind !== 'cover' ? curSheet.chapterIndex : -1;

  /* ---------- 对开（spread）模型（阶段 0 / 阶段 2）----------
     两端各一个**合着的单页跨**：s=0 显示封面、s=LAST 显示封底；
     中间 s=1..LAST-1 是摊开的内容跨（左 = 2s-1、右 = 2s）。
     `page` 仍表示"当前页"的页序下标（封面 = 0、封底 = TOTAL-1）。
     ⚠️ 2026-09-25：封底从"末跨的左页"改成**独立的合着的跨** —— 用户原话
        「翻到最后一页是书合上只看到封底的样子，只有左边单页的封底」。
        详见 pageId.ts 的 spreadPages 注释。 */
  const SPREAD_COUNT = spreadCount(TOTAL);
  const spread = spreadOfPage(page, TOTAL);
  const sp = spreadPages(spread, TOTAL);
  /* 封面跨与封底跨都是"合着"的（`--di-open = 0`，只有一张纸那么宽）。 */
  const isCover = sp.isCover;
  const isClosed = sp.isClosed;

  /* —— `--di-open` 与"跨是不是合着的"对齐（2026-09-25）——
     正常路径由 goNext / goPrev 用 tweenOpen 连续地改它；这里是**兜底同步**：
     凡是"跨号跳变但没走那两个函数"的路径（跳转条、编辑态换页、方向键的边界、
     以及本轮新增的"封底跨"），都必须让 `--di-open` 落到该跨应有的值，
     否则本子会停在"合着的封面宽度"却显示摊开的内容（或反过来）。
     ⚠️ 只在**当前实测值与目标值不同**时才写，避免打断正在跑的开本动画
       （tweenOpen 的中途值每帧都在变，那属于"正在动画"，不能拍平）。
     ⚠️ 必须放在所有被引用的 state 声明**之后** —— 插在前面会 TDZ 炸掉整个组件
       （历史教训：dev 探针插在 `spread` 之前，报 "Cannot access 'spread' before
        initialization"，整页只剩空 <div id="root">）。 */
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const target = isClosed ? 0 : 1;
    const cur = Number.parseFloat(getComputedStyle(board).getPropertyValue('--di-open'));
    if (!Number.isFinite(cur) || Math.abs(cur - target) < 0.01) return;
    board.style.setProperty('--di-open', String(target));
    /* 尺寸一变，按"当时宽度"算出来的 px 量全部要重算（同 tweenOpen 的收尾）。 */
    layoutBands();
    applyPeel(0);
    setPaperVars(leftLeafRef.current);
    setPaperVars(rightLeafRef.current);
  }, [isClosed, layoutBands, applyPeel, setPaperVars]);

  const goNext = useCallback(() => {
    if (busyRef.current) return;
    const nextS = spread + 1;
    if (nextS >= SPREAD_COUNT) return;
    const np = spreadPages(nextS, TOTAL);
    /* —— 起点是合着的跨（封面）→ 先摊开，再翻 ——
       用户点名的**开本动画**：① 先把本子摊宽（tween `--di-open` 0→1），
       ② 摊到位之后封面才像一张纸那样绕书脊翻过去，露出下面那跨。
       参考视频的动作顺序正是这样（合着 → 立起来 → 往左倒下摊平）。 */
    if (isClosed) {
      busyRef.current = true;
      tweenOpen(1, 0.62, () => {
        busyRef.current = false;
        /* 落点 = 下一跨的"朝上那一页"（内容跨取右页；兜底取左页） */
        const to = np.right ?? np.left;
        if (to != null) flipTo(to, 1);
      });
      return;
    }
    /* —— 一跨一跨地翻 ——
       往前翻时"被翻的那张纸"是**当前跨的右页**，落点 = 下一跨的右页；
       下一跨是**合着的封底跨**（right=null）时退化成它的左页 = 封底。
       ⚠️ 落点若是"合着的跨"，翻完之后还要把本子**收窄**回一张纸 —— 见 flipTo 回调。 */
    const to = np.right ?? np.left;
    if (to == null) return;
    if (np.isClosed) {
      /* 内容末跨 → 封底跨：先翻最后一张纸，翻完再把本子收窄（合上） */
      flipTo(to, 1, () => {
        busyRef.current = true;
        tweenOpen(0, 0.58, () => {
          busyRef.current = false;
        });
      });
      return;
    }
    flipTo(to, 1);
  }, [spread, TOTAL, SPREAD_COUNT, isClosed, flipTo, tweenOpen]);

  const goPrev = useCallback(() => {
    if (busyRef.current) return;
    if (spread === 0) return; // 已经在封面，没有更前的一跨
    const prevS = spread - 1;
    const pp = spreadPages(prevS, TOTAL);
    const pp2 = spreadPages(spread, TOTAL);
    /* —— 从封底往回翻：先把本子摊开，再翻回内容末跨 ——
       与 goNext 的"内容末跨 → 封底"完全对称的逆动作。 */
    if (pp2.isClosed) {
      busyRef.current = true;
      tweenOpen(1, 0.62, () => {
        busyRef.current = false;
        const to = pp.right ?? pp.left;
        if (to != null) flipTo(to, -1);
      });
      return;
    }
    if (spread === 1) {
      /* 回到封面（用户点名要的「内页第一页 ← 回封面」）：
         先把封面那张纸反着翻回来（它是左叶底下那张纸的**正面**），
         翻到与封面重合之后再把本子收窄回一张 A4 —— 和 goNext 完全对称。
         ⚠️ 这里 to=0、from=第 1 跨，但两者的 `spreadOfPage` 不同（0 vs 1），
            所以不能靠"跨号相等"判断；就是要翻这一下。
         ⚠️⚠️ 2026-09-25 修死锁：**不能**在调用 flipTo 之前就把 busyRef 置 true ——
            flipTo 内部有 `if (busyRef.current) return;`，会当场把自己这一下吃掉，
            而且 busyRef 再也回不到 false，prev 从此永久失灵（实测从第 1 跨
            连点 prev 十几次都停在第 1 跨不动）。
            正确顺序：先**放行**（busyRef=false）让 flipTo 真的翻起来，
            等翻完的回调里先把 busyRef 置 true 锁住，再做收窄动画，收完再放行 ——
            与 goNext 在封面那一下的写法保持对称。 */
      busyRef.current = false;
      flipTo(0, -1, () => {
        busyRef.current = true;
        tweenOpen(0, 0.58, () => {
          busyRef.current = false;
        });
      });
      return;
    }
    /* —— 往回翻 ——
       被翻的那张纸 = 当前跨的**左页**（它是上一跨那张纸的背面，落回右边），
       落点 = 上一跨的右页；上一跨只有左页时退化成那个左页（不会发生，但兜一下）。 */
    const to = pp.right ?? pp.left;
    if (to != null) flipTo(to, -1);
  }, [spread, TOTAL, e, flipTo, tweenOpen]);

  /* ←/→ 键的桥接目标（见文件上方 keydown 那段注释） */
  goNextRef.current = goNext;
  goPrevRef.current = goPrev;

  /* ==========================================================================
     **拖页角翻页**（2026-09-25 用户：「我要的翻页不是拖动页角翻吗」）
     ==========================================================================

     用户给的参考是 `create-photo-flipbook-ui` 那个 skill 的效果。它的底座是
     StPageFlip —— **Canvas 2D 位图渲染**：把整页内容 drawImage 到 canvas 上，
     再用一条斜折痕几何（`angle = 2·acos((W−Px)/|P−吸附点|)`）把纸画成折角。
     那套做法与本项目**三处硬冲突**（详见任务分析）：
       ① 内容必须变位图 ⇒ 正文 / 贴纸 / 手写字 / 编辑态全废；
       ② 斜折痕 与 本项目"绕中缝竖着翻 + 12 条带弯成 S 曲线"是**两套几何**，
          合不到一起；
       ③ 每页多一张位图 ⇒ 模糊、字体不对、卡。
     ⟹ **只借鉴交互，不搬渲染**：内容仍是真实 DOM，翻的是本项目自己的
        12 条带折纸机构；拖拽只是换一种**驱动方式**（见 armFlip 的注释）。

     交互规格（对齐参考视频的手感）：
       · 热区 = **页角附近的三角区**（半径 = 对开对角线 / 5），且必须贴着
         "要翻的那个角"——参考实现是 `√(W²+H²)/5` 且只认贴角点，照抄这个比例；
       · `pointerdown` 命中热区 → 立刻 armFlip + `tl.pause()`，纸跟着手；
       · `pointermove` → 把**水平位移**映射成进度 `0..1`（手指往左拖 = 往前翻），
         用 `tl.progress(p)` 驱动，天然复用抬升/砸下/回弹那三段曲线；
       · `pointerup` → 过 50% `tl.play()` 提交，否则 `tl.reverse()` 弹回原位；
       · 拖动期间 `touch-action: none` + 禁选文字（否则触屏会滚动、鼠标会选中）。
     ⚠️ 与点箭头共用同一套 `flippingRef` / `busyRef` 闸门，互斥不会打架。
     ------------------------------------------------------------------------- */
  /** 正在拖的那一次的所有状态（null = 没在拖） */
  const dragRef = useRef<null | {
    pointerId: number;
    dir: 1 | -1;
    target: number;
    startX: number;
    /** 拖动多少 px 算"翻完"——取对开半宽，手感接近真实翻纸 */
    span: number;
    tl: gsap.core.Timeline;
    moved: boolean;
  }>(null);

  /** 单个页角热区的命中半径：对开对角线 / 5（照抄 StPageFlip 的比例） */
  const cornerRadius = useCallback((rect: DOMRect) => {
    return Math.hypot(rect.width, rect.height) / 5;
  }, []);

  /**
   * 判断 pointer 落点是不是"捏住了某个可翻的页角"，是则返回该翻哪一页 + 方向。
   *   · **右下角** → 往前翻（dir=1），翻的是当前跨的右页；
   *   · **左下角** → 往回翻（dir=-1），翻的是当前跨的左页。
   * 合着的跨（封面 / 封底）只有"前进方向"那一个角可用（另一侧还没展开）。
   * ⚠️ 合着的跨（封面 s=0 / 封底 s=LAST）**不参与拖拽** —— 那两下要连带
   *    "摊开 / 收窄"的开本动画，拖拽没法表达"边摊边翻"（见 onBookPointerDown）。
   */
  const hitCorner = useCallback(
    (clientX: number, clientY: number): { dir: 1 | -1; target: number } | null => {
      const board = boardRef.current;
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      const r = cornerRadius(rect);
      const nearB = clientY > rect.bottom - r;
      if (!nearB) return null;

      const nearR = clientX > rect.right - r;
      const nearL = clientX < rect.left + r;

      /* 封面跨：只认右下角（左半边还没展开）。真正的动作在 goNext 里。 */
      if (isCover) return nearR ? { dir: 1, target: 0 } : null;
      /* 封底跨：整本已合上、只有一张纸 —— 只认左下角（往回翻）。 */
      if (isClosed) {
        return nearL ? { dir: -1, target: page } : null;
      }
      if (nearR && spread < SPREAD_COUNT - 1) {
        const nextS = spread + 1;
        const np = spreadPages(nextS, TOTAL);
        const to = np.right ?? np.left;
        return to == null ? null : { dir: 1, target: to };
      }
      /* 回程：左下角。第 1 跨回封面时落点是 0。 */
      if (nearL && spread > 0) {
        const prevS = spread - 1;
        const pp = spreadPages(prevS, TOTAL);
        const to = pp.right ?? pp.left;
        return to == null ? null : { dir: -1, target: to };
      }
      return null;
    },
    [spread, TOTAL, SPREAD_COUNT, isCover, isClosed, page, cornerRadius],
  );

  const onBookPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      if (e.editing) return; // 编辑态没有翻页机构
      if (flippingRef.current || busyRef.current) return;
      if (dragRef.current) return;
      /* ⚠️ 合着的跨（封面 / 封底）一律不拖 —— 那两下带"摊开 / 收窄"的开本动画，
         拖拽只能推进翻页时间轴、表达不了本子宽度的变化。
         直接交给 goNext / goPrev（点箭头那条路）走完整个开本流程。 */
      if (isClosed) return;
      const hit = hitCorner(ev.clientX, ev.clientY);
      if (!hit) return;

      const plan = planFlip(hit.dir, page, hit.target, TOTAL);
      if (plan.front == null && plan.back == null) return;
      const arm = armFlip(plan, hit.dir);
      if (!arm) return;

      const board = boardRef.current;
      const span = board ? board.getBoundingClientRect().width / 2 : 400;

      arm.tl.pause(0);
      dragRef.current = {
        pointerId: ev.pointerId,
        dir: hit.dir,
        target: hit.target,
        startX: ev.clientX,
        span,
        tl: arm.tl,
        moved: false,
      };
      /* 拖动落点是"合着的跨"（只剩封面那一头：第 1 跨往左拖回封面）时，
         翻完还要把本子收窄 —— 交给 armFlip 的收尾回调（已记在 afterFlipRef 上）。 */
      if (hit.dir === -1 && spreadPages(spreadOfPage(hit.target, TOTAL), TOTAL).isClosed) {
        afterFlipRef.current = () => {
          busyRef.current = true;
          tweenOpen(0, 0.58, () => {
            busyRef.current = false;
          });
        };
      }
      /* 拖动期间禁掉文字选中（否则鼠标拖过正文会拉出一片蓝）。 */
      document.body.classList.add('is-diary-dragging');
      try {
        (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      } catch {
        /* 某些浏览器在 pointerdown 里同步 capture 会抛，忽略即可 */
      }
    },
    [e.editing, hitCorner, spread, page, TOTAL, isClosed, armFlip, tweenOpen],
  );

  const onBookPointerMove = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== ev.pointerId) return;
    const dx = ev.clientX - d.startX;
    /* 往左拖 = 往前翻（dir=1）或往回翻（dir=-1）都按"移动了多少"取进度：
       dir=1 时手指往左（dx<0）推进；dir=-1 时手指往右（dx>0）推进。 */
    const signed = d.dir === 1 ? -dx : dx;
    let p = signed / d.span;
    if (!Number.isFinite(p)) p = 0;
    p = Math.min(1, Math.max(0, p));
    if (p > 0.001) d.moved = true;
    d.tl.progress(p);
  }, []);

  const onBookPointerUp = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== ev.pointerId) return;
    dragRef.current = null;
    document.body.classList.remove('is-diary-dragging');
    try {
      (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    const p = d.tl.progress();
    if (!d.moved) {
      /* 只是点了一下页角、没拖 —— 当作一次普通翻页，整段播完。 */
      d.tl.play();
      return;
    }
    if (p >= 0.5) {
      /* 过一半 → 提交：从当前进度补完剩下的（时长按剩余比例缩短，观感匀速）。 */
      const rest = (1 - p) * FLIP_TOTAL;
      d.tl.timeScale(rest > 0.01 ? FLIP_TOTAL / rest : 1);
      d.tl.play();
    } else {
      /* 没过半 → 弹回：反向播回 0。
         ⚠️ 弹回时**必须清掉收尾回调** —— 它挂在 afterFlipRef 上，本意是
            "翻到封面之后再收窄本子"；这一下没翻成，收窄就不能做。 */
      afterFlipRef.current = null;
      const back = p * FLIP_TOTAL;
      d.tl.timeScale(back > 0.01 ? FLIP_TOTAL / back : 1);
      d.tl.reverse();
    }
  }, []);

  /* 组件卸载 / 关闭日记时清掉 body 上的拖动类名（免得留给别的页面）。 */
  useEffect(() => () => document.body.classList.remove('is-diary-dragging'), []);

  /**
   * 编辑态的**整体等比缩放**（用户 2026-09-23）：
   *   「编辑的时候页面不要变动」「下面四个按钮…都影响我看排版」
   *   「放不开可以缩小，但是排版不能变」。
   *
   * 所以：纸面尺寸**与阅读态逐像素一致**（不改 inset，不重排），
   * 腾位置改用 `zoom` 等比缩小 —— 内部一切比例都不变。
   * 缩放比例按"工具栏实际高度 + 视口"现算：工具栏高就缩得多，矮就缩得少。
   */
  const [editZoom, setEditZoom] = useState(1);
  useEffect(() => {
    if (!editing) {
      setEditZoom(1);
      return;
    }
    const calc = () => {
      /* 量真实的工具栏高度（它有几行、字号多大由内容决定，写死不靠谱） */
      const bar = document.querySelector<HTMLElement>('.dp-toolbar');
      const bh = bar?.offsetHeight ?? 150;
      const V = window.innerHeight;
      /* 本子（含上下各 2.5% 留白）= 95% 视口高；居中摆放时底部余量 = (V - H·k)/2，
         要求它 ≥ 工具栏高 + 一点呼吸空间 */
      const bookH = V * 0.95;
      const k = (V - 2 * (bh + 14)) / bookH;
      setEditZoom(Math.max(0.55, Math.min(1, Number(k.toFixed(3)) || 1)));
    };
    calc();
    /* 工具栏是渲染完才量得到高度的，字体/换行稳定后再校一次 */
    const t1 = setTimeout(calc, 90);
    const t2 = setTimeout(calc, 420);
    window.addEventListener('resize', calc);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', calc);
    };
  }, [editing]);

  /* 进出编辑态叶子会重挂（内容分支不同）⇒ 重新给三处纸面容器铺变量、重量带子。
     --clip 与 --dp-fit 都是按"当时实测宽度"算出来的绝对值，容器一变就得重算。 */
  useLayoutEffect(() => {
    layoutBands();
    applyPeel(0);
    setPaperVars(leftLeafRef.current);
    setPaperVars(rightLeafRef.current);
  }, [isCover, editing, layoutBands, applyPeel, setPaperVars]);

  return (
    <div
      className={`notebook-overlay diary-overlay${closing ? ' is-closing' : ''}${editing ? ' is-editing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="实习日记"
    >
      <div className="notebook-backdrop" onClick={onClose} />

      <div
        className={`notebook-page diary-book${editing ? ' is-editing' : ''}${isCover ? ' is-cover-mode' : ''}${isClosed ? ' is-closed-book' : ''}`}
        ref={boardRef}
        style={editing ? ({ '--dp-edit-zoom': String(editZoom) } as CSSProperties) : undefined}
        /* 拖页角翻页（2026-09-25）：只在阅读态挂。
           `onPointerLeave` 不处理 —— 用 setPointerCapture 之后指针移出元素
           也照样收得到 move/up，不需要额外兜底。 */
        onPointerDown={editing ? undefined : onBookPointerDown}
        onPointerMove={editing ? undefined : onBookPointerMove}
        onPointerUp={editing ? undefined : onBookPointerUp}
        onPointerCancel={editing ? undefined : onBookPointerUp}
      >
        {(() => {
          /* 静止时两叶各显示自己那一页；一旦开始翻，四个位置全部交给分工表 FlipPlan
             （←→ 的方向决定了谁保持一致、谁提前露出 —— 推导见 planFlip）。 */
          const leftIdx = pageTurn ? pageTurn.left : sp.left;
          const rightIdx = pageTurn ? pageTurn.right : sp.right;
          const editIdx = page;
          const rightPageId =
            rightIdx == null ? 'cover' : (pageOrder[rightIdx] ?? 'cover');
          /**
           * 一片**静止**的叶子：纸底 + 沉底图层 + 正文 + 浮层图层。
           * idx = null → 这一叶现在没有内页可放（合着的跨里那一叶被收起来的那侧）。
           * 以前直接留空、露出底下的巧克力硬壳 —— 用户看不懂那块棕色
           * （「书为什么后面会有一个棕色底」），所以铺一张**衬页**（.diary-endpaper）：
           * 薄荷绿的内衬纸，读作"封面的内衬"。
           * ⚠️ 2026-09-25：内容跨的右页**永远是内容**，衬页只会出现在
           *    "合着的跨"里被收起的那一叶（宽度为 0，其实看不见）——
           *    留着它是为了 --di-open 动画中间态不闪空。 */
          const leafPaper = (idx: number | null) =>
            idx == null ? (
              <div className="diary-endpaper" aria-hidden="true" />
            ) : (
              <div className="diary-leaf-paper">
                {paperSurfaceFor(idx)}
                {layerHostFor(idx, 'under')}
                <div className="diary-sheet">{renderSheet(idx)}</div>
                {layerHostFor(idx)}
              </div>
            );
          /**
           * —— 翻页层：**只在"正在翻"的那一瞬间存在**（以前是常驻的）。
           *
           * 常驻的代价是 13 份 DOM 一直挂着；现在静止时左右两叶各自渲染自己的内容，
           * 翻起来才把这套 3D 机构临时挂上去。代价是 `flipTo` 里必须 `flushSync`
           * 先把这一层提交到 DOM 才能起时间轴（见那里的注释）。
           *
           * 每条竖带里有**两个面**（.diary-face.is-front / .is-back）—— 这就是
           * 「纸还没翻过去、字已经变成下一页」的正解：后半程看到的是这张纸自己的
           * 背面，而不是"换好了的下一页"。两个面由 CSS 的 backface-visibility
           * 在 90° 处自动切换，不需要 JS 掐时间。
           */
          const flip =
            pageTurn == null ? null : (
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
                      {(['front', 'back'] as const).map((side) => {
                        const idx = side === 'front' ? pageTurn.front : pageTurn.back;
                        return (
                          <div className={`diary-face is-${side}`} key={side}>
                            {idx == null ? null : (
                              <>
                                {/* 纸面本体：纸底 + 颗粒 + 水印 + 装饰 —— 必须在面里，
                                    才跟着纸一起弯（2026-09-17 修"纸不动"）。 */}
                                {paperSurfaceFor(idx)}
                                {/* 沉底层 —— 必须排在 .diary-sheet 之前：同为 z-index:0 的
                                    定位元素，谁在上完全看树序。 */}
                                {layerHostFor(idx, 'under')}
                                <div className="diary-sheet">{renderSheet(idx)}</div>
                                {layerHostFor(idx)}
                              </>
                            )}
                          </div>
                        );
                      })}
                      <span className="diary-band-sheen" aria-hidden="true" />
                    </div>
                  ))}
                </div>
                {/* 翻页时的动态阴影：抬起加深、落下淡出。
                    **不放进 .diary-turn** —— 它是屏幕空间的一层遮罩，跟着纸一起转
                    会变成"纸面上有块黑斑跟着转"。 */}
                <div className="diary-shade" ref={shadeRef} aria-hidden="true" />
              </div>
            );
          /* —— 一套 DOM 通吃「合着的封面」与「摊开的双页」——
             差别全在 --di-open：0 时左叶宽 0、封面那叶铺满整本书；1 时左右 50/50。
             （2026-09-24 C：以前这是两条互不相干的分支，所以没法做成连续动画。） */
          /* —— 合着的**封底**：把这一摞左右镜像过来（2026-09-25）——
             用户原话：「合上时线圈在左边，但是封底时线圈要在右边」。
             物理直觉：把本子翻个面看封底，装订边自然跑到右手边。
             做法：`is-back-closed` 时 `.diary-spread` 切 `flex-direction: row-reverse`，
             于是「左叶(宽0) → 中缝 → 右叶(铺满)」在视觉上变成
             「右叶(铺满) → 中缝 → 左叶(宽0)」——封底那张纸靠左铺满、线圈滚到右缘。
             不新增 DOM、不动 --di-open 那套几何，翻页机构完全不受影响。
             ⚠️ 封面跨（isCover）**不镜像** —— 保持现在的"线圈在左"，
                这正是用户明确要的"封面不动、只有封底翻面"。 */
          const isBackClosed = isClosed && !isCover;
          return (
            <div className={`diary-spread${isBackClosed ? ' is-back-closed' : ''}`}>
              <div className="diary-leaf is-left" ref={leftLeafRef}>
                {leafPaper(leftIdx)}
              </div>
              <div className="diary-gutter" aria-hidden="true">
                <div className="notebook-spiral is-center">
                  {Array.from({ length: RING_COUNT }).map((_, i) => (
                    <span key={i} className="notebook-ring" />
                  ))}
                </div>
              </div>
              <div
                className={`diary-leaf is-right${editing ? ' is-editing' : ''}`}
                ref={rightLeafRef}
              >
                {editing ? (
                  <>
                    {paperSurfaceFor(editIdx)}
                    {/* 「沉到页面内容下面」的图层挂载点（编辑态由 DiaryCanvas portal 塞进来）。
                        z-index 0 且排在 .diary-sheet 之前 → 与阅读态 .dp-layerhost.is-under 同档。 */}
                    <div className="dp-under-slot" ref={underSlotRef} />
                    <div className="diary-sheet dp-edit-sheet" key={pageOrder[editIdx] ?? 'cover'}>
                      {renderSheet(editIdx)}
                    </div>
                    <DiaryCanvas
                      pageId={pageOrder[editIdx] ?? 'cover'}
                      hostRef={rightLeafRef}
                      cropping={cropping}
                      underSlotRef={underSlotRef}
                    />
                  </>
                ) : (
                  <>
                    {leafPaper(rightIdx)}
                    {/* 用户贴的视频：真 <video> 只能有一份，所以放在**屏幕空间**的覆盖层里
                        （静止时纸正好铺满右叶，百分比定位与纸面完全一致）。
                        翻页期间隐藏 —— 那时由 12 条带里的 poster 静帧顶着，跟着纸一起弯。 */}
                    <LiveVideoLayer
                      layers={e.layersOf(rightPageId).filter((l) => !l.under)}
                      hidden={!!pageTurn}
                    />
                  </>
                )}
              </div>
              {/* ⚠️ 翻页层排在最后：它要和两侧叶子的"书脊阴影"(z:2) 同档，
                  同档时按树序取胜 —— 放最后才能盖住它们。 */}
              {flip}
            </div>
          );
        })()}

        {/* 底部中间页码。
            ⚠️ 2026-09-25：口径改成"内容跨计数" —— 本子两端各有**一个合着的跨**
               （封面 / 封底），它们不是"第几跨内容"。内容跨总数 = SPREAD_COUNT - 2，
               当前内容跨号 = spread - 1（封面跨 spread=0 时不算）。
               封面态显示「封面」，封底态显示「封底」，中间显示「第 N / M 跨」。 */}
        <div className="diary-pager">
          <span className="diary-pager-num">
            {isCover
              ? '封面'
              : isClosed
                ? '封底'
                : `第 ${spread} / ${SPREAD_COUNT - 2} 跨`}
          </span>
        </div>

        {/* —— 侧面章节标签（2026-09-25 导航重排）——
            四段实习各一枚，钉在书**右缘外**，像真实笔记本的拇指索引：
              · 纵向位置 = 各篇篇首页在全书里的比例 —— 标签本身就是一张「书的目录」；
              · 当前所在篇的那枚点亮（凸出 + 各篇主题色底），封面/封底态全部收平；
              · 点击跳到该篇篇首 —— **取代原先底部的横向跳转条**（功能重复，跳转条已删）。
            颜色取各篇的 tone（TONES.accent），与纸带/成果标签同一套色 —— 单一数据源。 */}
        {!editing ? (
          <nav className="diary-sidetabs" aria-label="按章节跳转">
            {DIARY_ENTRIES.map((entry, i) => {
              const ch = DIARY_CHAPTER_PAGES[i];
              /* 篇首页若是奇数下标落在左页，对齐到该 spread 的右页再翻过去（原跳转条同款） */
              const target = Math.min(ch + (ch % 2 === 0 ? 0 : 1), TOTAL - 1);
              const tone = TONES[entry.challengeTone ?? 'plain'];
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`diary-sidetab${curChapter === i ? ' is-active' : ''}`}
                  style={
                    {
                      top: `${((((ch + 1) / (TOTAL - 1)) * 76 + 7)).toFixed(1)}%`,
                      '--tab-accent': tone.accent,
                      '--tab-deep': tone.deep,
                    } as CSSProperties
                  }
                  onClick={() => {
                    if (flippingRef.current || busyRef.current) return;
                    /* ⚠️ 合着（封面/封底跨，--di-open=0）时**不能**直接
                       setPageIndex —— `--di-open` 是 gsap 设在 board 内联样式上的
                       几何总开关，页号 state 改了它也不会跟着变，书会停在合着的
                       几何上（实测：封面态点标签毫无反应的根因）。
                       与 goNext 的 isClosed 分支同款：先摊开，再翻到目标跨
                       （planFlip 支持任意跨距的"一张纸直达"）。 */
                    if (isClosed) {
                      busyRef.current = true;
                      tweenOpen(1, 0.62, () => {
                        busyRef.current = false;
                        flipTo(target, target >= page ? 1 : -1);
                      });
                      return;
                    }
                    if (target > page) flipTo(target, 1);
                    else flipTo(target, -1);
                  }}
                >
                  <span className="diary-sidetab-no">{pad2(i + 1)}</span>
                  <span className="diary-sidetab-name">{entry.short}</span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {/* 圆圈右箭头 = 下一跨：从封面进首 spread、从 spread 进下一跨 */}
        {spread < SPREAD_COUNT - 1 ? (
          <button
            type="button"
            className="diary-nav is-next"
            onClick={() => goNext()}
            aria-label="翻到下一页"
          >
            <span className="diary-nav-circle" aria-hidden="true">
              <span className="diary-nav-arrow">→</span>
            </span>
          </button>
        ) : null}
        {/* 圆圈左箭头 = 上一跨。
            ⚠️ 2026-09-25：条件从 `page > 0` 改成 `spread > 0` ——
               `page` 是"右页下标"，第 1 跨时它是 2、封面时是 0，
               看似等价；但**末跨的右页是 null**、封底跨只有左页，
               这些跨里 `page` 的含义会漂。以跨号为准才稳。 */}
        {spread > 0 ? (
          <button
            type="button"
            className="diary-nav is-prev"
            onClick={() => goPrev()}
            aria-label="看上一页"
          >
            <span className="diary-nav-circle" aria-hidden="true">
              <span className="diary-nav-arrow">←</span>
            </span>
          </button>
        ) : null}
      </div>

      {/* 左上进度胶囊 —— 2026-09-23 用户：「第一页第一行有个页码3，页码删掉」→
          整个胶囊撤掉（大字"篇 NN"和小字"第 N/M 页"都算页码）。 */}

      {/* 右上角「编辑」按钮（用户：「右上角还有『编辑』按钮用于进入或离开编辑态」）。
          只在作者模式出现 —— 访客看到的是纯只读的成品。 */}
      {admin.isAdmin ? (
        <button
          type="button"
          className={`dp-edit-toggle${editing ? ' is-on' : ''}`}
          onClick={() => e.setEditing(!editing)}
          aria-pressed={editing}
          title={editing ? '退出编辑（内容已自动保存）' : '进入手账编辑模式'}
        >
          {editing ? '✓ 完成' : '✎ 编辑'}
        </button>
      ) : null}

      {/* 极简关闭（2026-09-17 晚）：撤掉统一外壳的「RETURN TO STUDIO + MENU」——
          用户反馈「上面好多东西、比较杂乱，return to studio 和 menu 有点累赘」。
          日记本是沉浸式翻页本，本就有 Esc / 遮罩点击可退，这里只留一枚右上 ✕，
          回到改造前的 `.notebook-close`（白底圆角方块）。 */}
      <button type="button" className="notebook-close" onClick={onClose} aria-label="关闭日记">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M6 6 L18 18 M18 6 L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* 底部编辑工具栏（编辑态才出现） */}
      {editing ? (
        <DiaryToolbar
          pageId={pageId}
          pageLabel={`${pad2(page + 1)} · ${labelOfPage(pageId)}`}
          cropping={cropping}
          setCropping={setCropping}
          onAddPage={addPage}
          onDeletePage={deletePage}
          onRestorePage={(id) => e.restorePage(id)}
          onDone={() => e.setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/* 手绘涂鸦 Doodle 已随日记版式重写搬到 DiaryPage.tsx —— 那边「一篇一涂鸦」，
   和整页拼贴的排版放在一起；本文件只管翻页机构与封面。 */
