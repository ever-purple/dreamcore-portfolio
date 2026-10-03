import { lazy, useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { ObjectZone } from '@/components/ObjectZone';
import { downloadResume } from '@/lib/resume';
import { warmFile } from '@/lib/assetWarmup';
import { StudioChrome, StudioNavProvider, type StudioNav } from '@/components/StudioChrome';

/**
 * 木马策划案：Three.js 场景很重，必须懒加载成独立分包。
 * 悬停木马感应区时预先取包（同 MascotViewer 的做法），点开就不用等。
 */
const WorksCarousel = lazy(() => import('@/components/WorksCarousel'));
/** 报刊亭 → 创作档案（Creative Lab）3D 展架场景，同样懒加载成独立分包 */
const NewsstandScene = lazy(() => import('@/components/NewsstandScene'));
/**
 * 报刊亭两排物件的落地页（2026-09-15）：
 *  · 第一排（顶层设备）→ 视频与音乐作品（MediaGalleryPage，参考 mattjinn.com/videos/）；
 *  · 第二排（下层档案）→ 文案与 AI 项目（CopyProjectPage，文字卡片列表）。
 * 同排任意一件都进同一个页面，所以只是两个开关。
 */
const MediaGalleryPage = lazy(() => import('@/components/MediaGalleryPage'));
const CopyProjectPage = lazy(() => import('@/components/CopyProjectPage'));
const loadAboutOverlay = () =>
  import('@/components/AboutOverlay').then((module) => ({ default: module.AboutOverlay }));
const AboutOverlay = lazy(loadAboutOverlay);
const CrtOverlay = lazy(() =>
  import('@/components/GreenOs').then((module) => ({ default: module.CrtOverlay })),
);
const loadNotebookOverlay = () =>
  import('@/components/NotebookOverlay').then((module) => ({ default: module.NotebookOverlay }));
const NotebookOverlay = lazy(loadNotebookOverlay);
const DIARY_BOOK_URL = './diary-book/index.html?embed=1&v=20260926k';
import { StudioMenu } from '@/components/StudioMenu';
import { StudioLensBackground } from '@/components/StudioLensBackground';
import { StudioContactPanel, type StudioContactHandle } from '@/components/StudioContactPanel';
import { LisaHud } from '@/components/LisaHud';
import { useMagnetic } from '@/hooks/useMagnetic';
import { useRoomParallax } from '@/lib/useRoomParallax';
import { studioObjects, type StudioObject } from '@/data/studio';
import { CHANNEL_BY_DEVICE, type MediaChannel } from '@/data/mediaWorks';
import { playCrtOff, playCrtOn } from '@/lib/crtAudio';
import { createStudioMusic, type StudioMusic } from '@/lib/studioMusic';
import type { QuickViewExploreTarget } from '@/components/QuickViewShell';

/**
 * 盖上工作室的那一层，该让音乐去哪一档（见 src/lib/studioMusic.ts 文件头）。
 *   away —— 慢慢远去：3.4s 淡到听不见（任何子页面）
 *   off  —— 立刻停：视频页自己会出声，背景音乐必须让位
 */
type MusicCue = 'away' | 'off';

type Props = {
  entryTarget?: QuickViewExploreTarget;
  entryPlanSlot?: number | null;
  onSelectObject?: (object: StudioObject) => void;
  onBack?: () => void;
  onReturnToQuickWorks?: () => void;
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
 * 温和对焦时间轴（2026-09-16 第一档改造 ②）：木马 / 报刊亭 / 线圈本共用。
 * 与上面那套 extreme dive 是**两条互斥**的时间轴，不会同时跑。
 *   · 只有电脑有"扎进显像管"这套极端转场（scale 16 + 过曝白光），因为它的语义
 *     真的是"钻进这台机器里"；另外三个物件是"推近看看"，用温和版。
 */
const FOCUS = {
  /** 镜头推近时长（= CSS .studio-cam.is-focus-in 的 0.6s） */
  in: 600,
  /**
   * 推近进行到这个时刻才让浮层开始长出来 —— 这 240ms 是**刻意留的**：
   * 先让眼睛看到"镜头在朝物件走"，内容才是"从物件上长出来的"，
   * 而不是浮层先弹出来、镜头在背后白动。
   */
  contentAt: 240,
  /** 反向拉回时长（= .is-focus-out 的 0.6s） */
  out: 600,
};

/** 各物件的画面坐标（视口百分比）—— 四个物件都拿它当镜头推进的原点 */
const POINT_BY_ID = Object.fromEntries(studioObjects.map((o) => [o.id, o.point])) as Record<
  StudioObject['id'],
  { x: number; y: number }
>;

/**
 * Studio 主空间：循环视频铺满全屏的房间。
 * - **鼠标景深视差**（2026-09-16 第六轮）：鼠标一动，画面板 / 暗角 / 脉冲点三层
 *   各按不同倍率位移 —— 见 src/lib/useRoomParallax.ts 与 index.css 的同名段。
 *   ⚠️ 这条注释原来写的是「无视差」，第六轮起不再成立。
 * - **向下滚动露出联系方式**（同轮）：滚轮攒进度、巧克力纸从下方带视差推上来 ——
 *   见 src/components/StudioContactPanel.tsx。
 * - 自定义奶白手型光标跟随鼠标
 * - 四个隐形感应区：鼠标靠近物件时弹出点击按钮（按钮 = 物体名，tooltip = 板块）
 * - 点击笔记本：原地打开线圈本弹层（纸张右侧滑入 + 背景模糊）
 * - 点击电脑：原地打开 About Me 页（老式个人主页风格浮层）
 */
export function StudioSection({ entryTarget = 'studio', entryPlanSlot = null, onSelectObject, onBack, onReturnToQuickWorks }: Props) {
  const [hoveredId, setHoveredId] = useState<StudioObject['id'] | null>(null);
  /* —— 预热实习日记单文件（2026-09-28，2026-09-30 改为**只认悬停**）——
     日记整本是 public/diary-book/index.html 一个 3MB 单文件（封面照片也内联在其 CSS 里）。
     Vercel 上等用户点开笔记本才去拉：书壳先渲染、封面照片 1s 后才到（"白封面"），
     且滑入动画全在"还没内容"时播完（看起来不是从右边进来的）。
     所以用**与 iframe 完全相同的 URL**（含 ?embed=1&v=… 查询串，HTTP 缓存按完整 URL
     区分，少一个参数就是两份缓存）先拉一遍进缓存；点开时 iframe 命中缓存（304 重验证），
     书即刻渲染、滑入动画带着内容播。

     ⚠️ **别再改回「一进工作室就拉」**（2026-09-30 用户报「所有都很慢」的真凶之一）：
     这条 3MB 与下面的 rack.glb 9.3MB 会在 t=1.2s 同时发起，和**用户此刻真正在看的**
     工作室背景视频、帧集抢同一条链路。跨境 427 KB/s 下实测这两条**到观察窗口结束
     一个字节都没传完**（CDP 里 `bytes=0`），而它们要占的带宽是背景视频的 5 倍。
     ⚠️ **也别加「延后 N 秒」的兜底**：先试过 12s —— 复测那条管子**仍然是满的**
     （同一窗口里 `about/banner-sticker.png` 219 KB 花了 11.3s ≈ 19 KB/s）。
     冷访问下「视频 2.4MB + 帧集 6.7MB」要 25s 以上才下完，定时器猜不准。
     所以这两个 12MB 级的大件**只在鼠标真进到感应区（`hoveredId`）时才拉** ——
     工作室的点击按钮本来就是靠悬停才露出来的，用户点之前必然先悬停。 */
  useEffect(() => {
    if (hoveredId !== 'notebook') return;
    void loadNotebookOverlay();
    fetch(DIARY_BOOK_URL).catch(() => {});
  }, [hoveredId]);

  useEffect(() => {
    if (hoveredId === 'computer') void loadAboutOverlay();
  }, [hoveredId]);
  /* ?diary=1 可直接预览实习日记浮层（与 ?works=1 / ?media=1 / ?newsstand=1 同一套
     调试参数约定）。加它的直接原因：日记挂在一个 3D 笔记本物件上，
     想反复看翻页动效就得先等场景加载、再把镜头转到那个角度去点它 —— 太慢了。 */
  const [notebookOpen, setNotebookOpen] = useState(() => {
    return new URLSearchParams(window.location.search).has('diary');
  });
  const [menuOpen, setMenuOpen] = useState(false);
  // ?works=1 可直接预览木马策划案浮层（与 ?newsstand=1 / ?about=1 同一套调试参数约定）
  const [worksOpen, setWorksOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return entryTarget === 'plans' || params.has('works');
  });
  /** 报刊亭 → 创作档案 3D 展架场景开关（?newsstand=1 可直接预览） */
  const [newsstandOpen, setNewsstandOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('newsstand') || params.has('lab');
  });
  /** 第一排（顶层设备）落地页：视频与音乐（?media=1 可直接预览） */
  const [mediaOpen, setMediaOpen] = useState(() => {
    return entryTarget === 'media' || new URLSearchParams(window.location.search).has('media');
  });
  /**
   * 视频页的**进门频道** —— 由点的是第一排第几台设备决定（DVD→横屏 / DV→AI / MP3→竖屏）。
   * 2026-09-21 起频道不再过滤片单（三个入口都是同一份全量循环列表），
   * 只决定初始定位：进门落在该频道第一条片子上。
   * 调试可以写 `?media=1&channel=ai` 直接看某个入口的定位，不用去点 3D 模型。
   */
  const [mediaChannel, setMediaChannel] = useState<MediaChannel | undefined>(() => {
    const v = new URLSearchParams(window.location.search).get('channel');
    return v === 'landscape' || v === 'ai' || v === 'portrait' ? v : undefined;
  });
  /** 第二排（下层档案）落地页：文案与 AI 项目（?copy=1 可直接预览） */
  const [copyOpen, setCopyOpen] = useState(() => {
    return entryTarget === 'copy' || new URLSearchParams(window.location.search).has('copy');
  });
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
  /**
   * 温和对焦（第一档改造 ②）：{ x, y } = 目标物件在画面里的坐标，dir = 推近 / 拉回。
   * 同时最多只有一个 —— 浮层都是全屏的，不存在"同时盯着两个物件"。
   * 与 dive 互斥：电脑走 dive（扎进显像管），另外三个物件走 focus（推近看看）。
   */
  const [focus, setFocus] = useState<{ x: number; y: number; dir: 'in' | 'out' } | null>(null);
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
  const musicRef = useRef<StudioMusic | null>(null);
  const timersRef = useRef<number[]>([]);
  /** 联系方式面板句柄：菜单点 Contact 时直接把它推到顶（见 StudioContactPanel）。 */
  const contactRef = useRef<StudioContactHandle>(null);
  /**
   * 对焦专用的定时器组。和 timersRef 分开，是因为 `closeCrt()` 会**一次清空**
   * timersRef（它要撤掉面试官模式那个"460ms 后收房间"的尾巴），
   * 不该顺手把对焦的收尾也一起毙掉 —— 那会让镜头永久停在 1.9 倍。
   */
  const focusTimersRef = useRef<number[]>([]);

  // 顶栏按钮磁吸：鼠标靠近时被轻轻吸向指针
  const magneticBackRef = useMagnetic<HTMLButtonElement>();
  const magneticMenuRef = useMagnetic<HTMLButtonElement>();

  /**
   * 房间的「鼠标动、背景也动」景深视差（2026-09-16 第六轮 / 用户第 1 条需求）。
   * ⚠️ 主量写在 **section（.studio-scope）** 上，**不是** .studio-cam：
   *    .studio-cam 身上挂着推镜 keyframe（cam-dive-* / cam-focus-*，全都带 forwards），
   *    往它写 transform 会被动画最后一帧**永久覆盖** —— 同一个坑在滤镜那边已经踩过一次
   *    （见 index.css 里 .studio-lens-root 的注释）。
   *    写在 scope 上还有个好处：三层都靠自定义属性继承拿量，不必逐个传 ref。
   */
  const scopeRef = useRef<HTMLElement>(null);
  useRoomParallax(scopeRef);

  const later = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  /** 同 later，但落进对焦自己的定时器组（清单见 focusTimersRef 的注释） */
  const laterFocus = useCallback((ms: number, fn: () => void) => {
    focusTimersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  const clearFocusTimers = useCallback(() => {
    focusTimersRef.current.forEach(window.clearTimeout);
    focusTimersRef.current = [];
  }, []);

  // 卸载时清掉所有转场定时器，避免切页面后回调打到已卸载的组件上
  useEffect(
    () => () => {
      timersRef.current.forEach(window.clearTimeout);
      timersRef.current = [];
      focusTimersRef.current.forEach(window.clearTimeout);
      focusTimersRef.current = [];
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

  // 工作室背景音乐：仅在工作室页面循环播放。
  // 音频链（lowpass + gain）与 away/halt/stop 的语义见 src/lib/studioMusic.ts 文件头。
  useEffect(() => {
    const music = createStudioMusic('/studio/studio-music.mp3');
    musicRef.current = music;
    music.play(); // 进站时已被手势解锁；若被自动播放策略拦住，下面的 unlock 会补播

    // AudioContext 出生即 suspended，必须在**用户手势**里 resume，
    // 否则整条链静音（见模块头「约束 2」）——这是本改造唯一会静默失效的点。
    const unlock = () => {
      music.unlock();
      music.play();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      music.dispose();
      musicRef.current = null;
    };
  }, []);

  /**
   * 音乐档位（第二档 ④，2026-09-16 晚按用户听感重做）—— **一处派生**，
   * 而不是每个 onClose 里手工恢复。
   *
   * 改造前是"谁打开谁负责停、谁关闭谁负责续"：`stopMusic()` 散在 handleSelect /
   * openCrt / goToObject / toggleMenu 里，`resumeMusic()` 散在六七个 onClose 里。
   * 漏一个就是"音乐莫名不响了"，加一个浮层又要再配一遍 —— 和顶栏双影是同一类毛病。
   *
   * 现在反过来：音乐档位是"有没有东西盖在工作室上"的**纯函数**，
   * 跟第一档把顶栏收起来用的 `is-covered` 是同一个思路。增删浮层只需要决定它属于哪一档：
   *
   *   off  —— 视频与音乐页：那页自己会放片子，背景音乐必须**立刻停**
   *   away —— 其余所有子页面 / 浮层 / CRT：**3.4s 淡到听不见**（用户：不要压低，要"渐渐消失"）
   *   null —— 回到工作室画面：前台满音量
   *
   * ⚠️ `off` 必须排在 `away` 前面：视频页是从书架钻进去的，那一刻 `newsstandOpen`
   * 还没收干净，写在后面会被 `away` 吃掉。
   */
  const musicCue = useMemo<MusicCue | null>(() => {
    if (mediaOpen) return 'off';
    if (dive !== 'idle' || aboutOpen || crtOn) return 'away';
    if (
      menuOpen ||
      worksOpen ||
      newsstandOpen ||
      notebookOpen ||
      copyOpen
    ) {
      return 'away';
    }
    return null;
  }, [
    mediaOpen,
    dive,
    aboutOpen,
    crtOn,
    menuOpen,
    worksOpen,
    newsstandOpen,
    notebookOpen,
    copyOpen,
  ]);

  useEffect(() => {
    const music = musicRef.current;
    if (!music || music.isStopped()) return;
    if (musicCue === 'off') music.halt();
    else if (musicCue === 'away') music.away();
    else music.play();
  }, [musicCue]);

  /** 真停 —— 只在**离开工作室**（点左上角回首页）时用，不是"进内容页" */
  const stopMusic = useCallback(() => {
    musicRef.current?.stop();
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const nav = useMemo<StudioNav>(
    () => ({ menuOpen, toggleMenu, closeMenu }),
    [menuOpen, toggleMenu, closeMenu],
  );

  /**
   * 点电脑 → 镜头扎进 CRT 屏幕 → 过曝 → Green OS（三步走，总时长约 1.2s）
   *   0.00–0.70s  相机朝屏幕极速推进（见 CSS .studio-cam.is-in）
   *   0.70–0.81s  全屏荧光过曝，3D 房间被白光吃掉
   *   0.80–1.20s  白光淡出，Green OS 界面浮现 + CRT 质感层 + 像素指针
   */
  const openCrt = useCallback(() => {
    if (aboutOpen || dive === 'in') return;
    // 不再手动停音乐：`musicCue` 会在 dive 变 'in' 的同一帧让音乐开始淡出（away）
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
  }, [aboutOpen, dive, later]);

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
    setSkipBoot(true);
    setViaCrt(true);
    setAboutOpen(true); // OS 立刻开始淡入，底下的房间还看得见
    later(460, () => setCrtOn(true)); // OS 铺满后再收房间 + 点亮 CRT 质感层
  }, [aboutOpen, later]);

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
    // 音乐不在这里手动恢复：dive 回 'idle' 后由 musicCue 自己把音乐拉回前台
  }, [later]);

  /**
   * 打开某个物件的内容 —— **先推镜头，再长内容**（2026-09-16 第一档改造 ②）。
   *
   * 改造前只有电脑有转场（镜头扎进屏幕），木马 / 报刊亭 / 线圈本都是"啪"地弹浮层。
   * 用户说的"每个板块很分离"，一大半来自这里：进入方式不同，观感就不可能是一体的。
   *
   * @param id     目标物件（拿它的 point 当镜头推进原点）
   * @param open   真正把浮层挂起来的那一下 —— 放在推近途中执行
   * @param replay 是否重播"推近"。从工作室点物件一定是 true；
   *               用 MENU 从 A 板块横跳到 B 板块时传 false —— 那时 cam 已经停在
   *               1.9 倍，重播会先把画面弹回 1 倍再推一遍，隔着磨砂玻璃也看得出抖一下。
   *               只改 transform-origin 就够了（class 不变 = 动画不重启）。
   */
  const openFocused = useCallback(
    (id: StudioObject['id'], open: () => void, replay = true) => {
      const p = POINT_BY_ID[id];
      clearFocusTimers();
      setFocus({ x: p.x, y: p.y, dir: 'in' });
      if (replay) laterFocus(FOCUS.contentAt, open);
      else open();
    },
    [clearFocusTimers, laterFocus],
  );

  /** 反向：关掉浮层 → 镜头拉回 1:1（与推近互为镜像，时长也一致） */
  const closeFocused = useCallback(() => {
    clearFocusTimers();
    setFocus((f) => (f ? { ...f, dir: 'out' } : null));
    // 动画跑完再清空 —— 提前清会让 cam 瞬间跳回 1 倍，转场就断成两截了
    laterFocus(FOCUS.out + 40, () => setFocus(null));
  }, [clearFocusTimers, laterFocus]);

  const handleSelect = useCallback(
    (object: StudioObject) => {
      // 音乐不在这里管：浮层一打开，`musicCue` 就会让它开始淡出（见上面那个派生值）。
      if (object.id === 'computer') {
        // 电脑走极端版（扎进显像管 + 过曝白光），**不套**温和对焦
        openCrt();
      } else if (object.id === 'notebook') {
        openFocused('notebook', () => setNotebookOpen(true));
      } else if (object.id === 'carousel') {
        openFocused('carousel', () => setWorksOpen(true));
      } else if (object.id === 'newsstand') {
        openFocused('newsstand', () => setNewsstandOpen(true));
      }
      onSelectObject?.(object);
    },
    [onSelectObject, openCrt, openFocused],
  );

  /**
   * 菜单里的板块跳转（第一档改造 ①）：`策划项目` / `AI 及视频` 这两个条目
   * 以前点了没反应，菜单在内容页里看着像装饰。现在它们和"点物件"走完全同一条路 ——
   * 一个菜单项从任何地方点下去，落到的地方都一样。
   */
  /** 把盖在工作室之上的板块浮层全部收掉（不逐个走各自的 onClose 动画：马上要被别的东西取代）。
      2026-09-17 晚为菜单里的 Contact 加的：联系方式面板属于**工作室画面**，
      被木马 / 落地页 / 本子 / Green OS 盖着时是看不见的 —— 以前点了要手动先关掉浮层
      才看得到（用户原话：「必须关掉旋转木马模型页才行」）。
      只收浮层 + 镜头拉回 1:1，不做 goToObject 那套转场：回到工作室画面正是我们要的结果。
      ⚠️ 面板本身不用在这里再调 reveal —— StudioContactPanel 里有 pendingRevealRef，
         `blocked` 一落下来会自动补发那次请求（改成同步调也只是重复设同一个目标值）。 */
  const closeOverlays = useCallback(() => {
    setNotebookOpen(false);
    setWorksOpen(false);
    setNewsstandOpen(false);
    setMediaOpen(false);
    setCopyOpen(false);
    setAboutOpen(false);
    closeFocused();
  }, [closeFocused]);

  const goToObject = useCallback(
    (id: StudioObject['id']) => {
      // 先把这个板块之外的内容层全收掉（不逐个走 onClose，也不做转场动画：
      // 马上要被新内容盖住，走动画反而会看到"旧的还没走、新的已经来了"）。
      // ⚠️ 这一步也管 About：.about-overlay 的 z 是 260，比木马(266)还低，
      //    不收干净的话从木马跳 About 会看到木马盖在 OS 上面。
      setNotebookOpen(false);
      setWorksOpen(false);
      setNewsstandOpen(false);
      setMediaOpen(false);
      setCopyOpen(false);

      if (id === 'computer') {
        // 电脑不套温和对焦，直接交回 CRT 那套（openCrtDirect 会自己写状态）
        clearFocusTimers();
        setFocus(null);
        openCrtDirect();
        return;
      }

      openFocused(
        id,
        () => {
          setWorksOpen(id === 'carousel');
          setNewsstandOpen(id === 'newsstand');
          setNotebookOpen(id === 'notebook');
        },
        // 已经在某个板块里（focus 非空）→ 只换原点，不重播推近；从房间里点 → 正常推近
        focus === null,
      );
    },
    [clearFocusTimers, focus, openCrtDirect, openFocused],
  );

  /**
   * 报刊亭里点开某排物件 → 进对应落地页（2026-09-15）。
   * 按 row 分流：devices（顶层 DVD/DV/MP3）→ 视频与音乐；books（下层档案）→ 文案与 AI。
   * 顶层三台设备各带一条片单频道（CHANNEL_BY_DEVICE）：
   *   DVD → 横屏 / DV → AI / MP3 → 竖屏。
   * 2026-09-21 规则反转：三个入口看的是**同一份全量循环片单**（横屏→AI→竖屏），
   * 频道只决定进门时定位在第几条，不再过滤列表。
   * 进落地页算"离开工作室画面"，背景音乐停下；关闭时由各自的 onClose 恢复。
   */
  const handleNewsstandPick = useCallback(
    (row: 'devices' | 'books', index: number) => {
      // 2026-09-16 用户要求（行为反转）：点进落地页**不再关掉** 3D 书架 ——
      // 书架模型留在落地页后面（covered，GL 暂停、不吃事件），
      // 落地页按 Back → 先回到书架模型界面，再按一次才回 My Studio。
      if (row === 'devices') {
        setMediaChannel(CHANNEL_BY_DEVICE[index] ?? 'landscape');
        setMediaOpen(true);
      } else setCopyOpen(true);
    },
    [],
  );

  /**
   * 落地页与报刊亭的层级关系（2026-09-16 二次反转）。
   *
   * 旧规则（2026-09-15/16）：落地页开着时书架必须关掉 —— 当时「Back 回到了书架」
   * 被当成 bug 修掉。今天用户明确要求反过来：书架第一排/第二排点进落地页后，
   * Back 要**先回到书架模型界面**，再按一次才回 My Studio。
   *
   * 新规则：书架保持挂载，只是被落地页盖住（z-index 56 < 落地页 60）。
   * `covered` 传给 NewsstandScene：盖住时暂停 GL 渲染循环、忽略 Esc
   * （Esc 交给上层落地页自己处理，否则一按会把书架和落地页一起关掉）。
   *
   * 层级不变式：落地页(60) > 书架(56) > 笔记本弹层(50)。以后加新落地页记得 z ≥ 60。
   */

  // 悬停电脑感应区时预取 3D 小人分包，点开即用不等待
  useEffect(() => {
    if (hoveredId !== 'computer') return;
    void import('@/components/MascotViewer');
    void warmFile(`${import.meta.env.BASE_URL}about/mascot.glb`);
  }, [hoveredId]);

  // 同理：悬停木马就预取 3D 木马分包（它比小人还重，Three.js 场景 + OrbitControls）
  useEffect(() => {
    if (hoveredId !== 'carousel') return;
    void import('@/components/WorksCarousel');
  }, [hoveredId]);

  // 悬停报刊亭就预取 3D 展架分包，点开即用不等待
  useEffect(() => {
    if (hoveredId !== 'newsstand') return;
    void import('@/components/NewsstandScene');
  }, [hoveredId]);

  // 悬停报刊亭同时把那个 9.3MB 的展架 GLB 也拉起来 —— 这是全站最大的单文件，
  // 只在用户**表现出意图**的时候才值得花带宽（一进场就拉的老写法见下面那段注释）
  useEffect(() => {
    if (hoveredId !== 'newsstand') return;
    void warmFile(`${import.meta.env.BASE_URL}newsstand/rack.glb`, { mode: 'cors' });
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

  /** 转场进行中（镜头在动）：锁掉感应区、藏掉顶栏 */
  const transitioning = dive !== 'idle' || focus !== null;
  /**
   * 有板块/浮层盖在工作室之上 → 把工作室自己那条顶栏收掉。
   * ⚠️ 光靠 transitioning **不够**：用调试参数直接进内容页（?works=1）没有转场，
   * 于是工作室自己那条顶栏会留着，和内容页的「Return to Studio」**在同一位置**叠成双影 ——
   * 两边坐标完全一样（因为它们现在就是同一个组件），一叠就露馅。
   * 菜单也算进来：菜单铺满全屏（z 400），顶栏在它底下只会透出一层鬼影，
   * 而且反正点不到 —— 关闭键由 StudioMenu 自己那颗 Close 承担。
   */
  const layerOpen =
    worksOpen ||
    newsstandOpen ||
    notebookOpen ||
    mediaOpen ||
    copyOpen ||
    aboutOpen ||
    menuOpen;

  return (
    <StudioNavProvider value={nav}>
    <section
      ref={scopeRef}
      className={`studio-scope relative h-screen w-full overflow-hidden bg-wine-dark${
        transitioning ? ' is-transitioning' : ''
      }${layerOpen ? ' is-covered' : ''}${crtOn ? ' is-os' : ''}`}
    >
      {/* 底图：循环视频，平铺全屏。
          外面这层 .studio-cam 就是"相机" —— 转场时以目标物件为原点整体放大，
          视觉上等于镜头朝它推过去。原点取 studio 数据里的 point：
             · 电脑 → 极端版 .is-in（scale 16，扎进显像管）
             · 木马 / 报刊亭 / 线圈本 → 温和版 .is-focus-*（scale 1.9，推近看看） */}
      <div
        className={`studio-cam${dive === 'in' ? ' is-in' : ''}${dive === 'out' ? ' is-out' : ''}${
          focus ? ` is-focus-${focus.dir}` : ''
        }`}
        style={{
          transformOrigin: `${(focus ?? CRT_POINT).x}% ${(focus ?? CRT_POINT).y}%`,
        }}
      >
        {/* 背景双层：底层 = 原始循环视频，上层 = LensDistortion 镜头畸变（fit=cover 铺满）；
            鼠标滑过处用 CSS mask 挖一个软边圆洞露出底层清晰原图，形成水波般的揭示范围。
            细节见 @/components/StudioLensBackground.tsx */}
        <StudioLensBackground />
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

      {/* 向下滚动露出的「联系方式」（第六轮 / 用户第 2 条）。
          位置很讲究：**在暗角之后、StudioChrome 之前** ——
          z 45 让它盖住房间与暗角，但仍然压在那条全局导航（z 50）下面，
          于是纸升起来之后"返回"和"MENU"照样看得见、点得到（那是唯一的退出口）。
          `blocked` 传的是别的浮层：被菜单/木马/落地页盖住时滚轮归它们，
          而且面板会主动收回去（见组件文件头「坑 3」）。 */}
      <StudioContactPanel ref={contactRef} blocked={layerOpen} />

      {/* My Studio 最上层：L.I.S.A. 风格打字机 + 快捷胶囊对话 HUD（top:62% / left:5%）。
          任何浮层 / 板块盖上来时 hidden，避免在 Green OS / 落地页之上浮一层。 */}
      <LisaHud hidden={layerOpen} />

      {/* 顶部导航 —— 用**全站同一个** StudioChrome（第一档改造 ①）。
          工作室自己也是它的一个用户，于是从房间钻进任何板块时，
          左上角那枚返回、右上角那枚手绘圈 MENU 都留在原地不动，
          只有返回文案跟着层级变（MY STUDIO → RETURN TO STUDIO / 返回书架）。
          `studio-topbar` 这个 class 是给转场用的钩子：.is-transitioning 会把它淡掉
          （镜头在推近、房间在放大，导航却钉在 1:1 上会立刻穿帮）。 */}
      <StudioChrome
        label="My Studio"
        onBack={() => {
          stopMusic();
          onBack?.();
        }}
        tone="light"
        zIndex={50}
        className="studio-topbar"
        backRef={magneticBackRef}
        menuRef={magneticMenuRef}
      />

      {/* 线圈本弹层 */}
      {notebookOpen ? (
        <Suspense fallback={null}>
          <NotebookOverlay
            open={notebookOpen}
            onClose={() => {
              setNotebookOpen(false);
              closeFocused(); // 镜头从本子拉回 1:1
              // 音乐不用管：notebookOpen 转 false 后 musicCue 自己把音乐拉回前台
            }}
          />
        </Suspense>
      ) : null}

      {/* 全屏菜单 */}
      <StudioMenu
        open={menuOpen}
        onClose={closeMenu}
        onSelect={(id) => {
          // 只关菜单：接下来要么换板块、要么进 Green OS，都是"离开工作室画面"，
          // 音乐由 musicCue 统一负责，这里不用（也不该）手动接管。
          setMenuOpen(false);
          // 策划项目 / AI 及视频 → 和点物件走同一条路（第一档改造 ① 的连带收益：
          // 以前这两条点了没反应，菜单一进内容页就像装饰）。
          if (id === 'works') return goToObject('carousel');
          if (id === 'lab') return goToObject('newsstand');
          // Contact → 直接从底部把"联系方式"面板推上来（不必滚 12 格）。
          //      先收浮层：面板长在工作室画面里，被木马/落地页盖着时推上来也看不见
          //      （2026-09-17 晚用户报「必须关掉旋转木马模型页才行」）。
          if (id === 'contact') {
            closeOverlays();
            return contactRef.current?.reveal();
          }
          // Resume → 直接下载简历（文件没上传时会有提示告诉你放哪，见 src/lib/resume.ts）
          if (id === 'resume') return void downloadResume();
          if (id !== 'about') return;
          // About Me → 面试官模式：直奔 Green OS 桌面，跳过镜头推进与开机自检
          goToObject('computer');
        }}
      />

      {/* 木马策划案（点旋转木马物件 → 原地展开 3D 木马，策划案挂在上面） */}
      {worksOpen ? (
        <Suspense fallback={null}>
          <WorksCarousel
            open={worksOpen}
            initialActive={entryPlanSlot}
            returnToQuickOnDetailClose={entryTarget === 'plans' && entryPlanSlot !== null}
            onClose={() => {
              if (entryTarget === 'plans' && onReturnToQuickWorks) {
                onReturnToQuickWorks();
                return;
              }
              setWorksOpen(false);
              closeFocused(); // 镜头从木马拉回 1:1
            }}
          />
        </Suspense>
      ) : null}

      {/* 报刊亭 → 创作档案（点报刊亭物件 → 原地展开 3D 绿锈展架）
          2026-09-16：书架在落地页开着时**保持挂载**（盖住≠卸载），落地页 Back 先回到书架。
          covered = 被落地页盖住 → NewsstandScene 暂停 GL 循环 + 让出 Esc（见 escape-stack）。 */}
      {newsstandOpen ? (
        <Suspense fallback={null}>
          <NewsstandScene
            open={newsstandOpen}
            covered={mediaOpen || copyOpen}
            onClose={() => {
              setNewsstandOpen(false);
              closeFocused(); // 镜头从书架拉回 1:1
            }}
            onPick={handleNewsstandPick}
          />
        </Suspense>
      ) : null}

      {/* 第一排落地页：视频与音乐作品（点报刊亭顶层设备 → 独立全屏页）
          2026-09-16 晚：这一页是唯一让背景音乐**立刻停**的地方（它自己会出声）。
          Back 只关落地页、回到书架模型 —— 那时 musicCue 是 away（仍然静音），
          直到关掉书架、真正看见工作室画面，音乐才被拉回前台。 */}
      {mediaOpen ? (
        <Suspense fallback={null}>
          <MediaGalleryPage
            channel={mediaChannel}
            onClose={() => {
              if (entryTarget === 'media' && onReturnToQuickWorks) {
                onReturnToQuickWorks();
                return;
              }
              setMediaOpen(false); // → 回到书架模型界面
            }}
          />
        </Suspense>
      ) : null}

      {/* 第二排落地页：文案与 AI 项目（点报刊亭下层档案 → 独立全屏页） */}
      {copyOpen ? (
        <Suspense fallback={null}>
          <CopyProjectPage
            onClose={() => {
              setCopyOpen(false); // → 回到书架模型界面（同第一排，2026-09-16）
            }}
          />
        </Suspense>
      ) : null}

      {/* 镜头穿入屏幕时，电脑屏幕上溢出的那团光（跟着一起被放大到糊满全屏） */}
      {dive === 'in' ? (
        <span className="studio-dive-core is-on" style={{ left: `${CRT_POINT.x}%`, top: `${CRT_POINT.y}%` }} aria-hidden="true" />
      ) : null}

      {/* About Me / Green OS 页（点电脑物件 → 钻进屏幕 → 原地浮层） */}
      {aboutOpen ? (
        <Suspense fallback={null}>
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
              // 音乐不用管：aboutOpen 转 false 后 musicCue 自己把音乐拉回前台
            }}
          />
        </Suspense>
      ) : null}

      {/* CRT 物理质感层（扫描线 / 暗角 / 荧光），盖在 Green OS 之上但不吃事件 */}
      {crtOn ? (
        <Suspense fallback={null}>
          <CrtOverlay active={crtOn} />
        </Suspense>
      ) : null}

      {/* 荧光过曝闪光（z 最高的一层，专门用来吃掉 3D→2D 的切换瞬间） */}
      {crtFlash ? <div className="crt-flash" aria-hidden="true" /> : null}
    </section>
    </StudioNavProvider>
  );
}
