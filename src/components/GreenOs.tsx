import { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* CRT 物理质感遮罩                                                     */
/* ------------------------------------------------------------------ */

/**
 * 全屏 CRT 质感层：扫描线 / 孔栅 / 暗角 / 玻璃反光 / 亮度抖动。
 * 整层 `pointer-events: none`，只负责"看起来像在看一台显示器"，不拦任何交互。
 * 放在 .about-overlay（z 260）之上，所以连关闭按钮也会被扫描线盖过 —— 这才像屏幕里的东西。
 */
export function CrtOverlay({ active, booting }: { active: boolean; booting?: boolean }) {
  return (
    <div className={`crt-screen${active ? ' is-on' : ''}${booting ? ' is-booting' : ''}`} aria-hidden="true">
      <span className="crt-grille" />
      <span className="crt-scan" />
      <span className="crt-roll" />
      <span className="crt-vignette" />
      <span className="crt-glare" />
      <span className="crt-flicker" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 像素小图标（内联 SVG，不用外部图片，也不需要额外文件）                 */
/* ------------------------------------------------------------------ */

/** 11×9 的老式显示器：标题栏 / 开始菜单 / 任务栏共用 */
function MonitorIcon({ className = 'green-icon' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 11 9" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="11" height="7" fill="#0b2419" />
      <rect x="1" y="1" width="9" height="5" fill="#7ee8c7" />
      <rect x="2" y="2" width="4" height="1" fill="#0b2419" />
      <rect x="2" y="4" width="6" height="1" fill="#0b2419" />
      <rect x="4" y="7" width="3" height="1" fill="#0b2419" />
      <rect x="2" y="8" width="7" height="1" fill="#0b2419" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 开机自检：显示器通电那一瞬间的绿色终端字                              */
/* ------------------------------------------------------------------ */

const BOOT_LINES = [
  'GREEN OS 1.0   —   (c) 2026 dreamcore',
  '',
  'CRT BIOS v2.31 ................ OK',
  'Memory check 640K ............. OK',
  'Mounting /dev/dreamcore ....... OK',
  'Loading phosphore.sys ......... OK',
  'Starting window manager ....... OK',
  '',
  'run  ABOUT_ME.EXE',
];

const LINE_MS = 58;
const HOLD_MS = 220;
const FADE_MS = 280;

/**
 * 开机自检屏。整块不透明黑底 + 绿色终端字，逐行刷出来再淡出 ——
 * 这样"你刚按下这台电脑的电源键"这件事才是被看见的，而不是靠脑补。
 * 等不及可以点一下 / 按任意键跳过。
 */
export function GreenOsBoot({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [resourcesReady, setResourcesReady] = useState(false);
  const [logDone, setLogDone] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(onDone, FADE_MS);
  };

  useEffect(() => {
    // 开机期间给 body 挂个标记：CRT 质感层在别处（z 300），
    // 靠这个类名才能让扫描线抖得更凶，像刚通电的显像管。
    document.body.classList.add('green-boot-on');
    return () => document.body.classList.remove('green-boot-on');
  }, []);

  // 在开机自检期间同步预加载 About 首屏会用到的关键资源（顶部横幅、点阵底图、
  // 贴纸、头像）+ 两个像素字体，避免桌面刚露出时顶部图或文字是空白/缺字。
  // 关键：只有这些资源都 load 完（或最多等 9s 兜底）才放行，让开机屏兜住这段空窗。
  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
    const preload = () => {
      const imgPs = [
        '/about/banner-visual.jpeg',
        '/about/bg-pattern.webp',
        '/about/banner-sticker.png',
        '/about/avatar.webp',
      ].map(
        (src) =>
          new Promise<void>((res) => {
            const img = new Image();
            img.onload = () => res();
            img.onerror = () => res();
            img.src = src;
          }),
      );
      const fontsP = Promise.all([
        document.fonts.load('16px Zpix').catch(() => []),
        document.fonts.load('16px Cubic11').catch(() => []),
      ]).catch(() => {});
      // 全部就绪才放行；9s 只是"别永远卡在开机屏"的兜底。
      return Promise.race([Promise.all([...imgPs, fontsP]), sleep(9000)]);
    };
    preload().then(() => {
      if (!cancelled) setResourcesReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // 终端日志逐行打印 + 跳过
  useEffect(() => {
    const timers: number[] = [];
    BOOT_LINES.forEach((_, i) => {
      timers.push(window.setTimeout(() => setShown(i + 1), i * LINE_MS));
    });
    const onLogDone = () => setLogDone(true);
    timers.push(window.setTimeout(onLogDone, BOOT_LINES.length * LINE_MS + HOLD_MS));
    const skip = () => {
      setShown(BOOT_LINES.length);
      onLogDone();
      finish();
    };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      timers.forEach(window.clearTimeout);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只有日志打完 + 关键资源加载完，才让 OS 主界面真正露出
  useEffect(() => {
    if (logDone && resourcesReady) finish();
  }, [logDone, resourcesReady]);

  return (
    <div className={`green-boot${leaving ? ' is-leaving' : ''}`}>
      <pre className="green-boot-log">
        {BOOT_LINES.slice(0, shown).map((l, i) => (
          <div key={i}>{l || ' '}</div>
        ))}
        {shown >= BOOT_LINES.length ? <div className="green-boot-cursor">█</div> : null}
      </pre>
      <p className="green-boot-tip">点击任意处跳过</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 窗口标题栏：让这一页读起来是"一个正在跑的程序"                        */
/* ------------------------------------------------------------------ */

export type GreenOsNavItem = { id: string; label: string; en: string };

/**
 * 窗口标题栏。顶部一条，钉在滚动容器上（sticky），内容从下面滑过去 ——
 * 像最大化之后的窗口。右侧 [X] 就是需求里那个"右上角关闭/退出按钮"：
 * 点了走反向 Zoom Out 回到房间。
 *
 * 「—」「□」是装饰（点了给个系统提示音那种感觉太吵，就纯做样子），
 * 唯一真正能用的是 [X] —— 假按钮太多会露馅。
 */
export function GreenOsTitle({
  windowTitle,
  onClose,
}: {
  windowTitle: string;
  onClose: () => void;
}) {
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(false), 1600);
    return () => window.clearTimeout(t);
  }, [hint]);

  return (
    <div className="green-title">
      <MonitorIcon className="green-title-icon" />
      <span className="green-title-text" title={windowTitle}>
        {windowTitle}
      </span>
      {hint ? <span className="green-title-hint">窗口已最大化</span> : null}
      <span className="green-title-btns">
        <button type="button" className="green-title-btn" onClick={() => setHint(true)} aria-label="最小化（装饰）">
          <span className="green-title-glyph">_</span>
        </button>
        <button type="button" className="green-title-btn" onClick={() => setHint(true)} aria-label="最大化（装饰）">
          <span className="green-title-glyph">□</span>
        </button>
        <button type="button" className="green-title-btn is-close" onClick={onClose} aria-label="关闭并返回工作室">
          <span className="green-title-glyph">✕</span>
        </button>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 任务栏：让 Green OS 真的像个"操作系统"                                */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0');

type BarProps = {
  windowTitle: string;
  onShutDown: () => void;
  /** 开始菜单里能直接切页 */
  items?: GreenOsNavItem[];
  activeId?: string;
  onNavigate?: (id: string) => void;
};

/**
 * 底部任务栏（Win95 那味）：开始键 / 当前窗口 / 托盘时钟。
 * 存在的意义不是装饰，是让"你在操作这台电脑"这件事成立 ——
 * 有关机键、有正在跑的程序、有在走的时钟、有一个真能点开的开始菜单。
 */
export function GreenOsBar({ windowTitle, onShutDown, items = [], activeId, onNavigate }: BarProps) {
  const [now, setNow] = useState(() => {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      setNow(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }, 10_000);
    return () => window.clearInterval(t);
  }, []);

  // 开始菜单开着时按 ESC 收起来
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 只收菜单，不往下传给 AboutOverlay 的"ESC 关整页"
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menuOpen]);

  return (
    <>
      {menuOpen ? (
        <>
          {/* 点空白处收起菜单 */}
          <div className="green-menu-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="green-menu" role="menu" aria-label="开始菜单">
            <p className="green-menu-head">
              <MonitorIcon className="green-menu-logo" />
              GREEN OS 1.0
            </p>

            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className={`green-menu-item${it.id === activeId ? ' is-active' : ''}`}
                onClick={() => {
                  onNavigate?.(it.id);
                  setMenuOpen(false);
                }}
              >
                <span className="green-menu-mark">{it.id === activeId ? '▣' : '▢'}</span>
                <span className="green-menu-label">{it.label}</span>
                <span className="green-menu-en">{it.en}</span>
              </button>
            ))}

            <span className="green-menu-sep" />

            <button
              type="button"
              role="menuitem"
              className="green-menu-item is-shut"
              onClick={() => {
                setMenuOpen(false);
                onShutDown();
              }}
            >
              <span className="green-menu-mark">⏻</span>
              <span className="green-menu-label">关机</span>
              <span className="green-menu-en">exit</span>
            </button>
          </div>
        </>
      ) : null}

      <div className="green-bar">
        <button
          type="button"
          className={`green-bar-start${menuOpen ? ' is-open' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <MonitorIcon className="green-bar-logo" />
          START
        </button>

        <span className="green-bar-window" title={windowTitle}>
          ▤ {windowTitle}
        </span>

        <span className="green-bar-spacer" />

        <span className="green-bar-tray">
          <span className="green-bar-lamp" aria-hidden="true" />
          CRT
          <span className="green-bar-clock">{now}</span>
        </span>

        <button type="button" className="green-bar-shut" onClick={onShutDown} aria-label="关机并返回工作室">
          ⏻
        </button>
      </div>
    </>
  );
}
