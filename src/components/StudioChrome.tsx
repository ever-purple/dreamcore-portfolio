import { createContext, useContext, type ReactNode, type Ref } from 'react';
import { HandFrame } from '@/components/HandFrame';

/**
 * 统一外壳（2026-09-16，第一档改造 ①）。
 *
 * ## 症状
 * 用户原话：「我感觉每个板块很分离，没有一体的感觉。」根因之一是**头顶那两样东西**
 * 每页都不一样：
 *   · 工作室          → 左上 `My Studio`（手写体） + 右上手绘圈 `Menu`
 *   · 视频与音乐页    → 左上 `← Back`（14px 纳米老宋，灰）
 *   · 文案与 AI 页    → 左上 `Back`（13px，opacity 0.62）
 *   · 创作档案（书架）→ **正中**一个白圈 `✕`
 *   · 策划档案（木马）→ **右上**一颗 `关闭 ✕` 胶囊
 * 位置、字族、字号、措辞全不一样 —— 每进一个板块都像换了个站。
 *
 * ## 做法
 * 抽成一个组件，**工作室自己也在用**（StudioSection 里传 `label="My Studio"`）。
 * 于是从 3D 房间钻进任何一个板块，左上角那枚返回、右上角那枚 Menu 在原地不动，
 * 只是文案跟着层级变：`My Studio` → `Return to Studio` / `Return to Archive`。
 *
 * ## 大小写与字族（2026-09-16 晚，用户截图抓到的两处）
 * 用户原话：「menu和close的大小写不一致，my studio的字体与其他的英文字体不一致。」
 * 两处都在这一个文件里：
 *   · 大小写 —— 右上那枚原来写死 `'MENU'`，而展开后是 `'Close'`。
 *     全局规则是**屏幕外一律 Title Case**（全大写只留给 CRT 里的 Green OS），
 *     所以定成 `Menu` / `Close`。`data-cursor` 早就写对了（'Menu'），
 *     反倒是看得见的那个字写错了 —— 内部自己就不自洽。
 *   · 字族 —— 左上返回原来落 `'Cinzel'`（罗马碑体，只有大写字形），
 *     于是 `My Studio` 被渲染成 `MY STUDIO`，混在一圈 Caveat 手写体里像换了个人写的。
 *     英文一律回 Caveat（与 Menu/Close、物体名、光标标签同一支笔），
 *     中文回退 NanoOldSongA。CSS 在 `index.css` 的 `.studio-chrome__back`。
 *
 * ## 两个色调
 * `light` = 深底（3D 房间、绿锈书架、木马），奶白字 + 一点投影，保证压在花背景上读得清；
 * `dark`  = 浅底（纸张页 / Green OS），换成墨绿色，别拿奶白字怼在白纸上。
 *
 * ## MENU 从哪来
 * 菜单本体（StudioMenu）挂在 StudioSection 上，因为它要能开关工作室的背景音乐、
 * 还要能跳去别的板块。子页不该知道这些 —— 所以走 context：StudioSection 提供
 * `toggleMenu`，任何后代的 StudioChrome 都会自动长出右上那枚 MENU 按钮。
 * 没有 Provider 时（比如单测里裸渲染一个子页）按钮就不出现，不会报错。
 */

export type StudioNav = {
  menuOpen: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
};

const StudioNavCtx = createContext<StudioNav | null>(null);

export function StudioNavProvider({ value, children }: { value: StudioNav; children: ReactNode }) {
  return <StudioNavCtx.Provider value={value}>{children}</StudioNavCtx.Provider>;
}

export function useStudioNav() {
  return useContext(StudioNavCtx);
}

type Props = {
  /** 返回按钮文案。**Title Case**（屏幕外不用全大写）；工作室自己传 `My Studio`。 */
  label?: string;
  onBack: () => void;
  /** light = 深色底用奶白字；dark = 浅色底用墨绿字 */
  tone?: 'light' | 'dark';
  /** 层级。工作室顶栏要压过感应区，传 50；页面内部默认 30 够用。 */
  zIndex?: number;
  /** 额外 class（`.studio-topbar` 这类"转场时藏起来"的钩子挂在这里） */
  className?: string;
  /** 右侧、Menu 左边的附加按钮（木马的"提交项目"这种） */
  extra?: ReactNode;
  /** 不渲染 Menu（独立页 / 单测） */
  hideMenu?: boolean;
  /** 磁吸用：两枚按钮的 ref */
  backRef?: Ref<HTMLButtonElement>;
  menuRef?: Ref<HTMLButtonElement>;
};

export function StudioChrome({
  label = 'Return to Studio',
  onBack,
  tone = 'light',
  zIndex = 30,
  className,
  extra,
  hideMenu = false,
  backRef,
  menuRef,
}: Props) {
  const nav = useStudioNav();
  /** 深底 → 自定义光标是浅色圈注；浅底 → 反过来 */
  const cursorTone = tone === 'dark' ? 'light' : 'dark';

  return (
    <header
      className={['studio-chrome', `studio-chrome--${tone}`, className].filter(Boolean).join(' ')}
      style={{ zIndex }}
    >
      <button
        ref={backRef}
        type="button"
        className="studio-chrome__back"
        onClick={onBack}
        data-cursor="Back"
        data-cursor-tone={cursorTone}
      >
        {/* 一道极简细箭头 —— 与手绘笔触区分开：那是"随手圈"，这是"路标" */}
        <svg className="studio-chrome__arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5.5 L8 12 L15 18.5" />
        </svg>
        <span className="studio-chrome__label">{label}</span>
      </button>

      <span className="studio-chrome__right">
        {extra}
        {!hideMenu && nav ? (
          <button
            ref={menuRef}
            type="button"
            className="studio-pill"
            onClick={nav.toggleMenu}
            aria-expanded={nav.menuOpen}
            aria-haspopup="dialog"
            data-cursor={nav.menuOpen ? 'Close' : 'Menu'}
            data-cursor-tone={cursorTone}
          >
            {/* ⚠️ 必须与 `data-cursor` 同一套大小写（Title Case）——
                曾经这里是 'MENU' 而 data-cursor 是 'Menu'，展开后又是 'Close'，
                于是同一颗按钮自己跟自己打架（用户截图抓到的）。 */}
            <HandFrame shape="ring">{nav.menuOpen ? 'Close' : 'Menu'}</HandFrame>
          </button>
        ) : null}
      </span>
    </header>
  );
}

export default StudioChrome;
