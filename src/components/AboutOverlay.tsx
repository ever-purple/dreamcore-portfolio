import { useCallback, useEffect, useRef, useState } from 'react';
import { AboutPet } from '@/components/AboutPet';
import { AsciiPortrait } from '@/components/AsciiPortrait';
import { Sparkles } from '@/components/Sparkles';
import { AboutPlayer } from '@/components/AboutPlayer';
import { AboutCalendar } from '@/components/AboutCalendar';
import { AboutCharacterSheet } from '@/components/AboutCharacterSheet';
import { AboutCareerVision } from '@/components/AboutCareerVision';
import { AboutInspiration } from '@/components/AboutInspiration';
import { AboutGuestbook } from '@/components/AboutGuestbook';
import { AboutVisitor } from '@/components/AboutVisitor';
import { GreenOsBar, GreenOsBoot, GreenOsTitle } from '@/components/GreenOs';
import { PlayerProvider } from '@/context/PlayerContext';
import { aboutNav } from '@/data/about';
import { useEscape } from '@/lib/escape-stack';

type Props = {
  open: boolean;
  onClose: () => void;
  onHoverChange?: (hovering: boolean) => void;
  /**
   * Green OS 模式（从 3D 房间钻进 CRT 屏幕后进来的那一次）。
   * 打开后会多一层开机自检屏 + 一条底部任务栏，并给浮层加 `is-greenos`。
   * 直接 URL 进预览（?about=1）时是 false —— 那时候没有"钻进屏幕"这件事。
   */
  greenOs?: boolean;
  /**
   * 是否放开机自检屏（默认开）。
   * 菜单里的 About Me 走"面试官模式"会传 false：直奔桌面，不刷开机日志，
   * 面试官点进来就能直接看信息。注意它只关掉自检屏 ——
   * Green OS 的外观（窗口标题栏 / 任务栏 / CRT 扫描线）照旧。
   */
  boot?: boolean;
};

/**
 * About Me 浮层：点击工作室「Computer」物件后原地打开。
 * 结构参考老式个人主页（Bechno Kid / NomnomNami 一派）：
 *   顶部长条 banner（标题 + 3D 小节停靠位） / 左侧头像 + 导航 / 右侧内容区（ascii me 在右下角）
 * 底图 = 用户的薄荷绿浅紫圆点图（固定不随内容滚动）。
 * 注意：root 必须带 data-lenis-prevent，否则 Lenis 会吃掉滚轮事件导致页面无法滚动。
 */
export function AboutOverlay({ open, onClose, onHoverChange, greenOs = false, boot = true }: Props) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(aboutNav[0].id);
  const [booting, setBooting] = useState(greenOs && boot && open);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  const scrollAboutTop = useCallback(() => {
    overlayRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Green OS 模式下每次打开都重新走一遍开机自检；非 Green OS 模式永远不显示。
  // boot=false（面试官模式）同理永远不显示 —— 直接给桌面。
  useEffect(() => {
    if (!greenOs || !boot) {
      setBooting(false);
      return;
    }
    if (open) setBooting(true);
  }, [greenOs, boot, open]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setVisible(false);
    setClosing(true);
    // 关闭时立刻摘掉 is-booting —— 否则上面那条"开机期间满不透明"的规则会把
    // 关闭淡出也一起压住，浮层就关不掉了（只剩 420ms 后的硬卸载）。
    setBooting(false);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 420);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 双 rAF：先挂载、再淡入，保证入场过渡被绘制
  useEffect(() => {
    if (!mounted) {
      setVisible(false);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [mounted]);

  /* Esc = 关整页。走全站统一的 Esc 栈（@/lib/escape-stack）——
     About 底下可能还压着大图预览 / 开始菜单，栈保证一次按键只关最上面那层。 */
  useEscape(onClose, mounted);

  const handleCloseHover = useCallback(
    (hovering: boolean) => onHoverChange?.(hovering),
    [onHoverChange],
  );

  if (!mounted) return null;

  return (
    <PlayerProvider>
    <div
      ref={overlayRef}
      className={`about-overlay${visible ? ' is-visible' : ''}${closing ? ' is-closing' : ''}${
        greenOs ? ' is-greenos' : ''
      }${booting ? ' is-booting' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="About me"
      data-lenis-prevent
    >
      {/* 底图：薄荷绿浅紫圆点图（固定不随内容滚动） */}
      <div className="about-bg" aria-hidden="true" />

      {/* 页面级漂浮闪星（固定层） */}
      <div className="about-sparkle-field" aria-hidden="true">
        <Sparkles count={16} seed={77} />
      </div>

      {/* Green OS 模式下这个"网页自己的圆叉"会被窗口标题栏的 [X] 取代（见 CSS）。 */}
      <button
        type="button"
        className="about-close"
        onClick={onClose}
        onMouseEnter={() => handleCloseHover(true)}
        onMouseLeave={() => handleCloseHover(false)}
        aria-label="关闭 About 页"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      {/* Green OS：窗口标题栏（sticky 钉在滚动容器顶端，内容从它下面滑过） */}
      {greenOs ? (
        <GreenOsTitle
          windowTitle={`ABOUT_ME.EXE — ${aboutNav.find((n) => n.id === active)?.label ?? ''}`}
          onClose={onClose}
        />
      ) : null}

      <div className="about-shell">
        <header className="about-banner">
          {/* 纯视觉 banner：只用图片，不放任何文字/标签 */}
          <img src="/about/banner-visual.jpeg" alt="" className="about-banner-visual" aria-hidden="true" />
          <Sparkles count={10} seed={7} />
        </header>

        {/* 复古 marquee：neocities 式滚动条（多份重复 → 任意宽度都铺满，无空白） */}
        <div className="about-marquee" aria-hidden="true">
          <div className="about-marquee-track">
            {[0, 1].map((group) => (
              <div className="about-marquee-group" key={group}>
                {Array.from({ length: 14 }, (_, i) => (
                  <span key={i}>本网站持续更新中 ✦ 肝肝肝 ✦&nbsp;</span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="about-body">
          <aside className="about-side">
            <figure className="about-card about-avatar">
              {/* webmaster 不再放照片，改放"代码小人"（ascii me），保持原比例不压缩 */}
              <AsciiPortrait />
              <figcaption>
                <span className="ab-blink">☆</span> WEBMASTER <span className="ab-blink ab-blink-late">☆</span>
              </figcaption>
              <Sparkles count={5} seed={13} />
            </figure>

            <nav className="about-card about-nav" aria-label="About 页面导航">
              {aboutNav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`about-nav-item${active === item.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setActive(item.id);
                    scrollAboutTop();
                  }}
                  onMouseEnter={() => handleCloseHover(true)}
                  onMouseLeave={() => handleCloseHover(false)}
                  aria-current={active === item.id ? 'page' : undefined}
                >
                  <span className="about-nav-mark" aria-hidden="true">
                    {active === item.id ? '♥' : '▸'}
                  </span>
                  <span className="about-nav-label">{item.label}</span>
                  <span className="about-nav-en">{item.en}</span>
                </button>
              ))}
            </nav>
          </aside>

          <main className="about-main">
            {/* 中间栏 = 内容区：自我介绍 → 角色面板；职业愿景 → 方向卡片；
                灵感收藏 → 分类台子 + 槽位网格；留言板 → 留言表单 + 最近 3 条 */}
            {active === 'intro' ? (
              <AboutCharacterSheet />
            ) : active === 'vision' ? (
              <AboutCareerVision />
            ) : active === 'inspiration' ? (
              <AboutInspiration />
            ) : active === 'guestbook' ? (
              <AboutGuestbook />
            ) : (
              <div className="about-main-empty">
                <span className="about-tape" aria-hidden="true" />
                <img
                  src="/about/banner-sticker.png"
                  alt=""
                  className="about-empty-sticker"
                  aria-hidden="true"
                />
                <span>· 内容区建设中 ·</span>
              </div>
            )}
            {/* 3D 小人（桌宠）停靠位：内容区右下角 */}
            <div className="about-pet-dock" ref={dockRef} aria-hidden="true" />
          </main>

          {/* 右边栏 = 日历 + 播放器（竖排） */}
          <aside className="about-rail">
            <AboutCalendar />
            <AboutPlayer />
          </aside>
        </div>

        {/* 页脚：整页滚到底才会看到 —— 访客计数 + 回到顶部 */}
        <AboutVisitor />
      </div>

      {/* Green OS：开机自检屏（不透明黑底 → 淡出露出系统） */}
      {greenOs && booting ? <GreenOsBoot onDone={() => setBooting(false)} /> : null}

      {/* Green OS：底部任务栏（开始 / 当前窗口 / 托盘时钟 / 关机） */}
      {greenOs ? (
        <GreenOsBar
          windowTitle={`ABOUT_ME.EXE — ${aboutNav.find((n) => n.id === active)?.label ?? ''}`}
          onShutDown={onClose}
          items={aboutNav}
          activeId={active}
          onNavigate={(id) => {
            setActive(id);
            // 切页时回到顶部，否则会停在上一页的滚动位置，像"页面没换"
            scrollAboutTop();
          }}
        />
      ) : null}

      {/* 桌宠：可拖动、可挥手蹦跳（fixed 定位，浮在内容之上） */}
      <AboutPet dockRef={dockRef} onHoverChange={onHoverChange} />
    </div>
    </PlayerProvider>
  );
}
