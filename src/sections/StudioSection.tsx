import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AboutOverlay } from '@/components/AboutOverlay';
import { CrtOverlay } from '@/components/GreenOs';
import { ObjectZone } from '@/components/ObjectZone';
import { NotebookOverlay } from '@/components/NotebookOverlay';

/**
 * 木马策划案：Three.js 场景很重，必须懒加载成独立分包。
 * 悬停木马感应区时预先取包（同 MascotViewer 的做法），点开就不用等。
 */
const WorksCarousel = lazy(() => import('@/components/WorksCarousel'));
import { StudioMenu } from '@/components/StudioMenu';
import { studioObjects, type StudioObject } from '@/data/studio';
import { playCrtOff, playCrtOn } from '@/lib/crtAudio';

type Props = {
  onSelectObject?: (object: StudioObject) => void;
  onBack?: () => void;
};

/** 转场时间轴（ms）—— 与需求里的 1.2s 三段式一一对应 */
const T = {
  /** 镜头扎进屏幕的时长 */
  dive: 700,
  /** 过曝闪光出现的时刻（镜头穿入屏幕的临界点） */
  flashAt: 700,
  /** 闪光持续 */
  flashHold: 110,
  /** Green OS 就位（白光开始淡出、OS 界面浮现） */
  osIn: 800,
  /** 反向：Zoom Out 时长 */
  out: 700,
};

/**
 * CRT 屏幕在画面里的位置（视口百分比）。
 * 直接取 studio 数据里 computer 的触发点 —— 感应区按钮、脉冲点、镜头推进的原点
 * 共用同一个坐标，否则三者会各飘各的。CSS 里的位移量按 50% - 这个值 推出来。
 */
const CRT_POINT = studioObjects.find((o) => o.id === 'computer')!.point;

/**
 * Studio 主空间：静态底图（无缝循环视频平铺），无视差。
 * - 自定义奶白手型光标跟随鼠标
 * - 四个隐形感应区：鼠标靠近物件时弹出点击按钮（按钮 = 物体名，tooltip = 板块）
 * - 点击笔记本：原地打开线圈本弹层（纸张右侧滑入 + 背景模糊）
 * - 点击电脑：原地打开 About Me 页（老式个人主页风格浮层）
 */
export function StudioSection({ onSelectObject, onBack }: Props) {
  const [hoveredId, setHoveredId] = useState<StudioObject['id'] | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  // ?about=1 / ?greenos=1 / #about 可直接预览。
  // greenos / crt 也顺带把页面打开 —— 否则想看 Green OS 外观还得写两个参数。
  const [aboutOpen, setAboutOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (
      params.has('about') ||
      params.has('greenos') ||
      params.has('crt') ||
      window.location.hash === '#about'
    );
  });
  /** 镜头推进状态：idle 静止 / in 扎进屏幕 / out 拉回来 */
  const [dive, setDive] = useState<'idle' | 'in' | 'out'>('idle');
  /** 过曝闪光 */
  const [crtFlash, setCrtFlash] = useState(false);
  /** CRT 质感层是否激活（?greenos=1 预览时直接点亮，否则预览里没有扫描线/暗角） */
  const [crtOn, setCrtOn] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('greenos') || params.has('crt');
  });
  /** 这次 About 是不是"钻进屏幕"进来的（决定要不要走 Green OS 开机流程） */
  const [viaCrt, setViaCrt] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    // ?greenos=1 可以直接预览 Green OS 外观（不经过镜头推进）
    return params.has('greenos') || params.has('crt');
  });
  /**
   * 跳过开机自检屏 —— "面试官模式"。
   * 菜单里点 About Me 时直奔 Green OS 桌面：不等那 1.2s 的镜头推进 / 过曝白光，
   * 也不逐行刷开机自检日志。?direct=1 让这个状态在刷新后仍然保持，
   * 否则面试官刷一下页面又会被塞一遍开机动画。
   */
  const [skipBoot, setSkipBoot] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('direct');
  });
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const musicStoppedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const later = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  // 卸载时清掉所有转场定时器，避免切页面后回调打到已卸载的组件上
  useEffect(
    () => () => {
      timersRef.current.forEach(window.clearTimeout);
      timersRef.current = [];
    },
    [],
  );

  // Green OS 期间：换上 Win95 像素指针（挂到 body 上，作用域最大，连带覆盖浮层内所有元素）
  useEffect(() => {
    const cls = 'green-os';
    if (crtOn) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [crtOn]);

  // About 打开期间不播放工作室背景音乐（用 ref 让挂载时的自动播放也能判断）
  const aboutOpenRef = useRef(aboutOpen);
  useEffect(() => {
    aboutOpenRef.current = aboutOpen;
  }, [aboutOpen]);

  // 工作室背景音乐：仅在工作室页面循环播放
  useEffect(() => {
    const audio = new Audio('/studio/studio-music.mp3');
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0.7;
    musicRef.current = audio;

    const tryPlay = () => {
      if (musicStoppedRef.current) return; // 已停止就不再补播
      if (aboutOpenRef.current) return; // About Me 区域不播放背景音乐
      audio.play().catch(() => {});
    };
    tryPlay();

    // 若进入工作室前的手势未解锁音频（自动播放策略），首次交互再补播
    const unlock = () => {
      tryPlay();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audio.pause();
      audio.currentTime = 0;
      musicRef.current = null;
    };
  }, []);

  // 在工作室点击按钮（进入子页 / 打开菜单 / 回首页）→ 立即停止音乐
  const stopMusic = useCallback(() => {
    musicStoppedRef.current = true;
    const a = musicRef.current;
    if (a) a.pause();
  }, []);

  // 关掉菜单/笔记本弹层、回到工作室画面 → 音乐自动继续（从暂停处接上）
  const resumeMusic = useCallback(() => {
    musicStoppedRef.current = false;
    const a = musicRef.current;
    if (a) a.play().catch(() => {});
  }, []);

  /**
   * 点电脑 → 镜头扎进 CRT 屏幕 → 过曝 → Green OS（三步走，总时长约 1.2s）
   *   0.00–0.70s  相机朝屏幕极速推进（见 CSS .studio-cam.is-in）
   *   0.70–0.81s  全屏荧光过曝，3D 房间被白光吃掉
   *   0.80–1.20s  白光淡出，Green OS 界面浮现 + CRT 质感层 + 像素指针
   */
  const openCrt = useCallback(() => {
    if (aboutOpen || dive === 'in') return;
    stopMusic();
    setSkipBoot(false); // 正片流程：镜头推进 → 过曝白光 → 开机自检
    setDive('in');
    playCrtOn(); // 消磁 + 行频啸叫，必须在点击手势里触发

    later(T.flashAt, () => setCrtFlash(true)); // 穿入屏幕的临界点：闪一下
    later(T.osIn, () => {
      setViaCrt(true);
      setAboutOpen(true); // OS 就位（被白光盖着，用户看不见这一瞬间的挂载）
      setCrtOn(true);
    });
    later(T.flashAt + T.flashHold, () => setCrtFlash(false)); // 白光开始淡出
  }, [aboutOpen, dive, later, stopMusic]);

  /**
   * 菜单里的 About Me —— **面试官模式：直奔 Green OS 桌面**。
   * 刻意跳过三件事：
   *   ① 镜头扎进屏幕（.studio-cam.is-in，700ms）
   *   ② 穿屏那一下的过曝白光（.crt-flash）
   *   ③ 开机自检屏（GreenOsBoot，约 1.2s，由 skipBoot 关掉）
   *
   * 注意这里**不立刻**把 crtOn 点亮：先让浮层在自己的淡入（0.42s）里压到完全不透明，
   * 房间一直留在下面当背景；等 OS 铺满了，再收掉房间 + 上 CRT 扫描线。
   * 反过来（立刻 setCrtOn(true)）会触发 .is-os 把房间瞬间 visibility:hidden，
   * 于是中间露出 0.42s 的酒红空底，看着像"闪了一下"。
   */
  const openCrtDirect = useCallback(() => {
    if (aboutOpen) return;
    stopMusic();
    setSkipBoot(true);
    setViaCrt(true);
    setAboutOpen(true); // OS 立刻开始淡入，底下的房间还看得见
    later(460, () => setCrtOn(true)); // OS 铺满后再收房间 + 点亮 CRT 质感层
  }, [aboutOpen, later, stopMusic]);

  /** 关掉 Green OS → 反向 Zoom Out，CRT 质感层淡出，平滑回到房间视角 */
  const closeCrt = useCallback(() => {
    // 先把"打开时还挂着"的定时器全部清掉（比如面试官模式那个 460ms 后才收房间的），
    // 否则它会在关闭之后才触发，把已经关掉的 CRT 层又点亮一次。
    // 清完再排下面这套关闭步骤，所以自己的定时器不受影响。
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    setSkipBoot(false);
    playCrtOff();
    /**
     * 关键修复 —— "关闭后 3D 与 2D 重叠交错" 的根因：
     * 旧实现让 2D OS 慢吞吞地淡出（0.34s），而镜头拉远要 700ms，于是有很长的重叠窗口：
     * 半透明的 2D 页面 + 被放大到 16 倍、还带 brightness(1.66)/blur(3.2px) 的 3D 房间
     * 同时可见、同时在动 = 叠影 / 交错。
     *
     * 现在改成和"开机推进"镜像的收场：
     *   t=0       立刻打一道过曝闪光（既是断电白斑，也是即时视觉反馈），同时把 Green OS
     *             的淡出从 0.34s 压到 0.12s（见 CSS `.is-greenos.is-closing`）—— 比白光的
     *             0.13s 还短，所以 2D 在白光褪去前就已彻底消失；房间等白光爬满（~25ms）
     *             再显形，从 scale(16) 的模糊态开始拉回。
     *   0–0.13s   白光盖住"2D 消失"这一帧
     *   0–0.70s   房间从贴屏的放大态平滑拉回 1:1（与开机推进互为镜像）
     *   0.70s     到位：解锁感应区、恢复背景音乐
     * 结果：2D 与 3D 在时间轴上完全不重叠，旧版那段 ~600ms 的叠影窗口被彻底消掉。
     */
    setCrtFlash(true); // 断电白斑 + 遮住 2D→3D 的切换瞬间
    setDive('out'); // 房间从 scale(16) 拉回 1:1
    setAboutOpen(false); // Green OS 快速淡出（CSS 里 .is-greenos.is-closing 只需 0.12s）
    // 等白光爬满全屏（~18ms）再把房间放出来 —— 否则白光还没盖住，放大 16 倍的房间就先露脸了。
    later(25, () => setCrtOn(false));
    later(130, () => setCrtFlash(false));
    later(T.out, () => setDive('idle'));
    later(T.out + 30, () => setViaCrt(false));
    later(T.out + 60, () => resumeMusic());
  }, [later, resumeMusic]);

  const handleSelect = useCallback(
    (object: StudioObject) => {
      // 进入 About Me（电脑物件）不再播放工作室背景音乐；子页导航同样停；
      // 笔记本与木马都算"还在工作室里"，音乐继续放着。
      // 回到工作室时由各自的 onClose → resumeMusic() 恢复。
      if (object.id !== 'notebook' && object.id !== 'carousel') {
        stopMusic();
      }
      if (object.id === 'notebook') setNotebookOpen(true);
      if (object.id === 'computer') openCrt();
      if (object.id === 'carousel') setWorksOpen(true);
      onSelectObject?.(object);
    },
    [onSelectObject, openCrt, stopMusic],
  );

  // 悬停电脑感应区时预取 3D 小人分包，点开即用不等待
  useEffect(() => {
    if (hoveredId !== 'computer') return;
    void import('@/components/MascotViewer');
  }, [hoveredId]);

  // 同理：悬停木马就预取 3D 木马分包（它比小人还重，Three.js 场景 + OrbitControls）
  useEffect(() => {
    if (hoveredId !== 'carousel') return;
    void import('@/components/WorksCarousel');
  }, [hoveredId]);

  // URL 同步：打开时 #about；Green OS 模式下同时写入 ?greenos=1，
  // 这样从 ?studio=1 点电脑钻进 CRT 后刷新，也能恢复 CRT 质感 + 开机流程。
  // 面试官模式额外写 ?direct=1 —— 刷新后继续跳过开机自检，不会再被塞一遍动画。
  useEffect(() => {
    const url = new URL(window.location.href);
    if (aboutOpen) {
      url.hash = 'about';
      if (viaCrt) {
        url.searchParams.set('greenos', '1');
        if (skipBoot) url.searchParams.set('direct', '1');
        else url.searchParams.delete('direct');
      } else {
        url.searchParams.delete('greenos');
        url.searchParams.delete('direct');
      }
    } else {
      url.hash = '';
      url.searchParams.delete('greenos');
      url.searchParams.delete('direct');
    }
    window.history.replaceState(null, '', url.toString());
  }, [aboutOpen, viaCrt, skipBoot]);

  const handleZoneHover = useCallback(
    (id: StudioObject['id'], hovering: boolean) => setHoveredId(hovering ? id : null),
    [],
  );

  return (
    <section
      className={`studio-scope relative h-screen w-full overflow-hidden bg-wine-dark${
        dive !== 'idle' ? ' is-transitioning' : ''
      }${crtOn ? ' is-os' : ''}`}
    >
      {/* 底图：循环视频，平铺全屏。
          外面这层 .studio-cam 就是"相机" —— 转场时以 CRT 屏幕为原点整体放大，
          视觉上等于镜头朝屏幕扎进去。transform-origin 与电脑物件的位置保持一致。 */}
      <div
        className={`studio-cam${dive === 'in' ? ' is-in' : ''}${dive === 'out' ? ' is-out' : ''}`}
        style={{ transformOrigin: `${CRT_POINT.x}% ${CRT_POINT.y}%` }}
      >
        <video
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster="/studio/studio-poster.jpg"
        >
          <source src="/studio/studio-loop.mp4" type="video/mp4" />
        </video>
      </div>

      {/* 四个物件悬停感应区（隐形，中心为脉冲提醒点） */}
      {studioObjects.map((object) => (
        <ObjectZone
          key={object.id}
          object={object}
          onSelect={handleSelect}
          onHoverChange={handleZoneHover}
        />
      ))}

      {/* 氛围暗角（Green OS 打开时由 .is-os 一起藏起来，别把暗角压在浅色 OS 上） */}
      <div className="studio-vignette pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.55)_100%)]" />

      {/* 顶部导航 */}
      <header className="studio-topbar absolute inset-x-0 top-0 z-50 flex items-center justify-between p-6 md:p-8">
        <button
          type="button"
          onClick={() => {
            stopMusic();
            onBack?.();
          }}
          className="font-display text-lg tracking-[0.2em] text-cream transition-opacity hover:opacity-70"
        >
          MY STUDIO
        </button>
        <button
          type="button"
          onClick={() => {
            if (menuOpen) resumeMusic(); // 关闭菜单 → 回到工作室，音乐继续
            else stopMusic(); // 打开菜单 → 停音乐
            setMenuOpen((v) => !v);
          }}
          className="rounded-full border border-cream/30 px-4 py-1.5 text-[11px] tracking-[0.15em] text-cream transition-colors hover:border-cream/70"
        >
          {menuOpen ? 'Close' : 'MENU'}
        </button>
      </header>

      {/* 线圈本弹层 */}
      <NotebookOverlay
        open={notebookOpen}
        onClose={() => {
          setNotebookOpen(false);
          resumeMusic(); // 关闭本子 → 回到工作室，音乐继续
        }}
      />

      {/* 全屏菜单 */}
      <StudioMenu
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
          resumeMusic(); // 关闭菜单（含 ESC）→ 回到工作室，音乐继续
        }}
        onSelect={(id) => {
          // 目前只有 About Me 有落地页；其余条目保持"占位"不响应。
          if (id !== 'about') return;
          // 直接关菜单、**不**调用 resumeMusic() —— 我们要离开工作室进 Green OS 了，
          // 音乐该继续停着（关闭 OS 回房间时由 closeCrt 里的 resumeMusic 恢复）。
          setMenuOpen(false);
          openCrtDirect();
        }}
      />

      {/* 木马策划案（点旋转木马物件 → 原地展开 3D 木马，策划案挂在上面） */}
      {worksOpen ? (
        <Suspense fallback={null}>
          <WorksCarousel open={worksOpen} onClose={() => setWorksOpen(false)} />
        </Suspense>
      ) : null}

      {/* 镜头穿入屏幕时，电脑屏幕上溢出的那团光（跟着一起被放大到糊满全屏） */}
      {dive === 'in' ? (
        <span className="studio-dive-core is-on" style={{ left: `${CRT_POINT.x}%`, top: `${CRT_POINT.y}%` }} aria-hidden="true" />
      ) : null}

      {/* About Me / Green OS 页（点电脑物件 → 钻进屏幕 → 原地浮层） */}
      <AboutOverlay
        open={aboutOpen}
        greenOs={viaCrt}
        boot={!skipBoot}
        onClose={() => {
          if (viaCrt) {
            closeCrt(); // 走反向拉远
            return;
          }
          setAboutOpen(false);
          resumeMusic(); // 关掉 About → 回到工作室，音乐继续
        }}
      />

      {/* CRT 物理质感层（扫描线 / 暗角 / 荧光），盖在 Green OS 之上但不吃事件 */}
      <CrtOverlay active={crtOn} />

      {/* 荧光过曝闪光（z 最高的一层，专门用来吃掉 3D→2D 的切换瞬间） */}
      {crtFlash ? <div className="crt-flash" aria-hidden="true" /> : null}
    </section>
  );
}
