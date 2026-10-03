import { useEffect, useRef, useState } from 'react';
import '../quick-view.css';
import '../meadow-v2.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CursorLabel } from './CursorLabel';
import { StudioChrome } from './StudioChrome';
import { CONTACT, RESUME_FILENAME, RESUME_URL } from '../data/contact';
import { WORKS } from '../data/works';
import { MEDIA_WORKS } from '../data/mediaWorks';
import { COPY_PROJECTS } from '../data/copyProjects';

gsap.registerPlugin(ScrollTrigger);
export type QuickViewExploreTarget = 'studio' | 'plans' | 'media' | 'copy';
type QuickViewShellProps = {
  onBack: () => void;
  onExplore: (target?: QuickViewExploreTarget, projectSlot?: number) => void;
};

const EXPERIENCES = [
  { no: '01', label: 'May', title: '北京新白文化', period: '2026.01–04', organization: '袖珍世界', role: '市场部实习生', detail: '参与品牌新媒体矩阵、达人合作、节点活动和本地生活投放。', bullets: ['推进 54 位带货达人分级合作与文案跟进', '运营小红书素人矩阵，使用 AI 批量剪辑与制作封面', '参与妇女节、上海新店开业等节点营销策划', '复盘 CTR、成交额与 ROI，优化内容和投放'], x: 118, y: 454 },
  { no: '02', label: 'every', title: '北京行行行广告', period: '2025.07–08', organization: '快手电商 / 神州租车', role: '整合营销部实习生', detail: '同时参与节点整合营销和品牌自媒体代运营两类项目。', bullets: ['为快手“老铁降温季”规划热点、跟进榜单与营销号', '话题曝光 18.41 亿+，累计上榜 39 个，最高 TOP1', '完成神州租车四平台竞品调研与运营策略提案', '方案创意与平台调性选择获得甲方书面好评'], x: 300, y: 150 },
  { no: '03', label: 'cat', title: '北京氪星创服', period: '2024.07–09', organization: '科创品牌项目', role: '品牌市场部实习生', detail: '负责多平台内容与短视频生产，并参与大型活动传播执行。', bullets: ['参与视频号、公众号等平台的内容规划与运维', '完成科创主题短视频的策划、拍摄协作与剪辑', '参与大型活动的前期传播、现场执行和内容回收', '在并行任务中保证内容产出与活动交付进度'], x: 480, y: 62 },
  { no: '04', label: 'met', title: '春山里', period: '2023.07–09', organization: '品牌新媒体', role: '新媒体运营实习生', detail: '参与抖音账号运营、短视频制作和日常传播文案输出。', bullets: ['协助账号选题与内容排期', '参与短视频脚本、拍摄和后期制作', '撰写日常运营文案并跟进发布', '根据账号反馈调整内容表达'], x: 725, y: 70 },
] as const;

type PlanNote = { label: string; summary: string; detail: string };
type PlanPreview = { id: string; title: string; client: string; year: string; cover: string; slot: number | null; notes: PlanNote[] };

const planCover = (id: string) => WORKS.find((work) => work.id === id)?.cover ?? '';
const PLAN_PREVIEWS: PlanPreview[] = [
  {
    id: 'shenzhou', title: '神州租车 · 新媒体代运营', client: '神州租车', year: '2025', cover: planCover('w2'), slot: 1,
    notes: [
      { label: '背景', summary: '重新明确各平台账号定位、运营策略与改进方向。', detail: '品牌需要基于自身及竞品的运营特点，重新梳理微信、微博、小红书与短视频平台的角色，让 social 内容真正服务业务。' },
      { label: '洞察', summary: '各平台“不 social、缺存在感”，需要建立原生内容与参与感。', detail: '对标品牌的共同优势是大众感知强、频繁亮相、形象鲜活并拥有用户圈层，因此以内容营销 3H 找回存在感。' },
      { label: '执行', summary: '用 HERO / HUB / HELP 与 Studio 化流程规划全平台内容。', detail: '完成竞品 Research、短视频与小红书策划、热点借势、苏超作业及提案视觉整理，并为各平台建立内容栏目与生产机制。' },
      { label: '结果', summary: '方案创意与平台调性获得甲方书面好评。', detail: '核心策略进入客户内部参考库，为后续账号定位与内容运营提供依据。' },
      { label: '角色', summary: 'Research、短视频与小红书策划、借势创意、PPT 美化。', detail: '参与从前期调研、策略拆解到具体内容创意及最终提案呈现的完整过程。' },
    ],
  },
  {
    id: 'kuaishou', title: '快手电商 · 老铁降温季', client: '快手电商', year: '2025', cover: `${import.meta.env.BASE_URL}diary-book/imgs/kuaishou-kv-flame.jpg`, slot: null,
    notes: [
      { label: '背景', summary: '极端高温话题与网络热梗形成集中流量和消费需求。', detail: '项目需要在高温节点快速承接公众情绪，把“降温”转化为电商消费理由与可持续传播话题。' },
      { label: '洞察', summary: '把高温情绪、老铁语境与降温商品连接成传播抓手。', detail: '以平台用户熟悉的“老铁”关系和铁扇公主文化意象降低营销感，让事件既有话题性也能自然落到消费场景。' },
      { label: '执行', summary: '规划 26 个热点，完成冲榜、海报、达人 brief 与传播复盘。', detail: '执行 15+ 热榜冲榜、1 张概念图与 3 张海报，并持续跟进热搜词、营销号、达人、传播日报及户外反馈。' },
      { label: '结果', summary: '曝光 18.41 亿+，累计上榜 39 个，最高 TOP1。', detail: '11 个热点进入总榜 TOP10，17 个进入社会榜或有用榜 TOP10，形成节点期集中声量。' },
      { label: '角色', summary: '策划案、热搜词、热点追踪、达人与营销号协作。', detail: '负责传播内容落地、榜单监测、达人 brief、传播日报与户外反馈整理。' },
    ],
  },
  {
    id: 'kuaike', title: '快克 · 品牌 TVC', client: '快克', year: '2025', cover: planCover('w4'), slot: 3,
    notes: [
      { label: '背景', summary: '突出“感冒，用快克就是快”，兼顾卖点与情感价值。', detail: '以快克牌感冒胶囊为核心，在 1–3 分钟内建立产品使用场景、治疗速度与情绪恢复之间的联系。' },
      { label: '洞察', summary: '患者既希望快速恢复身体，也需要摆脱重要时刻前的焦虑。', detail: '从“明天必须恢复状态”的真实心理切入，让产品成为身体治疗与情绪急救的双重解决方案。' },
      { label: '执行', summary: '以失恋、应酬、面试三个场景组织病毒广告叙事。', detail: '前半使用阴郁蓝调表现低落，递药后切换灵魂乐与冷幽默，形成从负面情绪到重新出发的节奏反差。' },
      { label: '结果', summary: '业内 TVC 导演评价逻辑完整、审美到位。', detail: '成片方案被评价具有成熟商业质感，产品卖点与三个情绪场景能够形成完整闭环。' },
      { label: '角色', summary: '影片调性、音乐参考与剪辑参考。', detail: '参与核心创意表达与视听语言定义，为场景节奏和情绪转折提供参考。' },
    ],
  },
  {
    id: 'chiwei', title: '赤尾 · 润 TA 细无声', client: '赤尾', year: '2025', cover: planCover('w3'), slot: 2,
    notes: [
      { label: '背景', summary: '推动高校两性健康，建立年轻化国产品牌形象。', detail: '从产品硬核卖点出发，为高校情侣提供更自然的两性健康沟通方式，并强化国货品牌认知。' },
      { label: '洞察', summary: '将产品“润”、节气、中国诗句与含蓄的爱连接。', detail: '借《春夜喜雨》的文化记忆，把玻尿酸水润卖点转译为“默默陪伴”的情感价值。' },
      { label: '执行', summary: '以相识、相知、相恋组织三阶段节气传播。', detail: '围绕立春、雨水、春分设计“春有约、丝雨润、万物生”，连接线上内容、校园互动与情侣关系。' },
      { label: '结果', summary: '完成从主题推导到三阶段活动机制的整合方案。', detail: '本项目为策划方案产出，现有材料未提供上线后的量化传播数据。' },
      { label: '角色', summary: '主题创意推导、活动策划、PPT 美化。', detail: '参与主题概念、阶段叙事、活动机制与最终提案视觉表达。' },
    ],
  },
  {
    id: 'guanxia', title: '观夏 · 隙月', client: '观夏 To Summer', year: '2026', cover: planCover('w1'), slot: 0,
    notes: [
      { label: '背景', summary: '为夏季限定建立文化符号、情绪价值与品销路径。', detail: '面对产品同质化、渠道单一与年轻受众情绪回应不足，以“隙月”重构观夏夏季传播体系。' },
      { label: '洞察', summary: '用月洞门与“不破不立”回应 Z 世代的理性悦己。', detail: '将苏州园林月洞门转译为“光之入口”，以 SIPS 模型串联共鸣、确认、参与与分享扩散。' },
      { label: '执行', summary: '以寻隙、破隙、归真搭建三阶段整合营销。', detail: '规划电子诗集、沉浸展、H5、纪录片与跨界礼盒，使产品、内容和线下体验共享一条情绪叙事。' },
      { label: '结果', summary: '完成基于 316 份问卷的完整全链路策划方案。', detail: '形成三款产品的情绪定位、品牌内容资产、互动体验与跨界合作机制；目标数据属于方案目标，不作为真实上线结果。' },
      { label: '角色', summary: '调研、策略、内容、视觉叙事与资源整合统筹。', detail: '独立完成 SIPS 全链路活动策划，并负责受众研究、产品价值重构及在地文化资源连接。' },
    ],
  },
];

const VIDEO_GROUPS = [
  { key: 'landscape', label: '横屏影像' },
  { key: 'portrait', label: '竖屏短片' },
  { key: 'ai', label: 'AI 影像' },
] as const;

const copyText = (project: (typeof COPY_PROJECTS)[number]) => {
  const raw = project.sections
    ? project.sections.map((section) => `${section.label}\n${section.text}`).join('\n\n')
    : project.body ?? project.blurb;
  return raw.replaceAll('==', '').replaceAll('_', '');
};

function BrushMotifs() {
  return <div className="qv-brush-motifs" aria-hidden="true">
    <i className="qv-brush-star" /><i className="qv-brush-dot" />
    <i className="qv-brush-star" /><i className="qv-brush-dot" />
    <i className="qv-brush-star" /><i className="qv-brush-dot" />
  </div>;
}

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

type SceneLayerProps = {
  className: string;
  desktopSrc: string;
  mobileSrc?: string;
  imageClassName?: string;
  priority?: boolean;
};

function SceneLayer({ className, desktopSrc, mobileSrc, imageClassName, priority = false }: SceneLayerProps) {
  return <picture className={className}>
    <source media="(max-width: 760px)" srcSet={mobileSrc ?? TRANSPARENT_PIXEL} />
    <img className={imageClassName} src={desktopSrc} alt="" fetchPriority={priority ? 'high' : 'auto'} decoding="async" />
  </picture>;
}

function GrassWorldBackground() {
  return <div className="qv-world" aria-hidden="true">
    <SceneLayer className="qv-world__layer qv-world__base" desktopSrc="/quick-view-v2/surreal-desktop/base-sky-meadow.webp" mobileSrc="/quick-view-v2/surreal-mobile/base-sky-meadow.webp" priority />
    <SceneLayer className="qv-world__layer qv-world__house-shadow" desktopSrc="/quick-view-v2/surreal-desktop/house-shadow.webp" mobileSrc="/quick-view-v2/surreal-mobile/house-shadow.webp" />
    <SceneLayer className="qv-world__layer qv-world__house" desktopSrc="/quick-view-v2/surreal-desktop/floating-house.webp" mobileSrc="/quick-view-v2/surreal-mobile/floating-house.webp" />
    <SceneLayer className="qv-world__layer qv-world__curtain" desktopSrc="/quick-view-v2/surreal-desktop/curtain.webp" mobileSrc="/quick-view-v2/surreal-mobile/curtain.webp" />
    <SceneLayer className="qv-world__layer qv-world__goldfish" desktopSrc="/quick-view-v2/surreal-desktop/goldfish.webp" mobileSrc="/quick-view-v2/surreal-mobile/goldfish.webp" />
    <SceneLayer className="qv-world__layer qv-world__cloud" desktopSrc="/quick-view-v2/surreal-desktop/cloud.webp" mobileSrc="/quick-view-v2/surreal-mobile/cloud.webp" />
    <SceneLayer className="qv-world__layer qv-world__house-front" desktopSrc="/quick-view-v2/surreal-desktop/floating-house.webp" mobileSrc="/quick-view-v2/surreal-mobile/floating-house.webp" />
    <SceneLayer className="qv-world__layer qv-world__desk-scene" desktopSrc="/quick-view-v2/surreal-desktop/desk-crt-scene.webp" />
    <SceneLayer className="qv-world__layer qv-world__desk-glow" desktopSrc="/quick-view-v2/surreal-desktop/desk-crt-screen-glow.webp" />
    <div className="qv-world__scrim" />
    <div className="qv-world__grade" />
    <div className="qv-world__scanlines" />
  </div>;
}

function GrassWorldForeground() {
  return <div className="qv-foreground" aria-hidden="true">
    <SceneLayer className="qv-foreground__track qv-foreground__curtain-track" imageClassName="qv-foreground__curtain" desktopSrc="/quick-view-v2/surreal-desktop/curtain.webp" mobileSrc="/quick-view-v2/surreal-mobile/curtain.webp" />
    <SceneLayer className="qv-foreground__track qv-foreground__goldfish-track" imageClassName="qv-foreground__goldfish" desktopSrc="/quick-view-v2/surreal-desktop/goldfish.webp" mobileSrc="/quick-view-v2/surreal-mobile/goldfish.webp" />
  </div>;
}

function starParticles(seedText: string, count = 2200) {
  let seed = [...seedText].reduce((value, character) => value + character.charCodeAt(0), 2166136261) >>> 0;
  const random = () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const glyphs = ['★', '★', '★', '★', '☆', '☆', '★', '★', '·'];
  return Array.from({ length: count }, (_, index) => {
    const weight = random();
    const size = weight > .98 ? 21 + random() * 8 : weight > .84 ? 12 + random() * 6 : 7 + random() * 6;
    return {
      index,
      x: 8 + random() * 1084,
      y: 4 + random() * 172,
      size,
      rotate: -35 + random() * 70,
      glyph: glyphs[Math.floor(random() * glyphs.length)],
      tone: index % 23 === 0 ? 'lilac' : index % 19 === 0 ? 'cream' : 'chocolate',
      twinkle: index % 17 === 0,
      delay: -(random() * 5),
      duration: 3.2 + random() * 4.5,
    };
  });
}

function SectionHeading({ no, children, zh, variant = 'stars', align = 'start' }: { no: string; children: string; zh: string; variant?: 'stars' | 'portfolio'; align?: 'start' | 'center' }) {
  const maskId = `qv-stars-${no}`;
  const particles = variant === 'stars' ? starParticles(`${no}-${children}`) : [];
  return <header className={`qv-heading${align === 'center' ? ' qv-heading--center' : ''}`}><span>{no}</span><h2 aria-label={children}>
    {variant === 'portfolio' ? <span className="qv-heading__portfolio">{children}</span> : <svg viewBox="0 0 1100 180" role="presentation" preserveAspectRatio="xMidYMid meet">
      <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1100" height="180"><rect width="1100" height="180" fill="black"/><text className="qv-star-letter__mask" x="550" y="144" textAnchor="middle" textLength="1000" lengthAdjust="spacingAndGlyphs" fill="white" stroke="white" strokeWidth="21" strokeLinejoin="round">{children}</text></mask></defs>
      <text className="qv-star-letter__outline" x="550" y="144" textAnchor="middle" textLength="1000" lengthAdjust="spacingAndGlyphs">{children}</text>
      <g mask={`url(#${maskId})`} className="qv-star-letter__particles">
        {particles.map((particle) => <g key={particle.index} transform={`rotate(${particle.rotate} ${particle.x} ${particle.y})`}><text className={`qv-star-particle qv-star-particle--${particle.tone}${particle.twinkle ? ' is-twinkling' : ''}`} x={particle.x} y={particle.y} fontSize={particle.size} style={{ animationDelay: `${particle.delay}s`, animationDuration: `${particle.duration}s` }}>{particle.glyph}</text></g>)}
      </g>
    </svg>}
  </h2><small>{zh}</small><i aria-hidden="true">☆</i></header>;
}

export function QuickViewShell({ onBack, onExplore }: QuickViewShellProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState('overview');
  const [drawStep, setDrawStep] = useState(0);
  const [selectedExperience, setSelectedExperience] = useState<number | null>(null);
  const [activePlan, setActivePlan] = useState(0);
  const drawTimers = useRef<number[]>([]);

  const drawCat = () => {
    drawTimers.current.forEach(window.clearTimeout);
    drawTimers.current = [];
    setDrawStep(1);
    setSelectedExperience(0);
    EXPERIENCES.slice(1).forEach((_, timerIndex) => {
      const index = timerIndex + 1;
      drawTimers.current.push(window.setTimeout(() => {
        setDrawStep(index + 1);
      }, 520 + timerIndex * 820));
    });
  };
  const openExperience = (index: number) => {
    if (index === 0 && drawStep === 0) { drawCat(); return; }
    if (drawStep >= index + 1) setSelectedExperience(index);
  };
  useEffect(() => {
    document.body.classList.add('quick-view-active');
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const ctx = gsap.context(() => {
      // [P1-4] trigger 改为 sticky 的 __stage，end 用 'bottom top'：
      // 原先 trigger 是 .qv-hero（比 stage 高出一段），动画在 hero 完全滚出前就结束，
      // 剩下的滚动区间里内容已淡完、只剩暗掉的背景图 —— 那就是「空滚」断层。
      gsap.timeline({
        scrollTrigger: {
          trigger: '.qv-hero__stage',
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      })
        .to('.qv-hero__enter', { y: -12, opacity: 0, duration: .2, ease: 'power2.in' }, .08)
        .to('.qv-hero__copy', { y: -38, scale: .985, opacity: 0, duration: .34, ease: 'power2.inOut' }, .18)
        .to('.qv-hero__decoration', { y: -18, opacity: 0, duration: .3, ease: 'power1.inOut' }, .23)
        // [P1-4] backdrop 淡出挪到时间轴后段（.72），让它覆盖整个 sticky 区间，
        // 而不是在 31% 就结束、后面全是静止画面。
        .to('.qv-hero__backdrop', { opacity: .16, duration: .28, ease: 'power1.inOut' }, .72);
      gsap.utils.toArray<HTMLElement>('[data-drift]').forEach((item, index) => gsap.fromTo(item, { y: index % 2 ? -20 : 20 }, { y: index % 2 ? 34 : -34, ease: 'none', scrollTrigger: { trigger: item, start: 'top bottom', end: 'bottom top', scrub: true } }));
      const sceneState = {
          hero: {
            base: { scale: 1 }, cloud: { xPercent: 0, scale: 1, opacity: 1 },
            curtain: { xPercent: 0, yPercent: -1.2, scale: 1, opacity: 1 },
            fish: { xPercent: 0, yPercent: 1, scale: 1, opacity: 1 },
            house: { xPercent: 0, yPercent: 0, scale: .9, opacity: 1 },
            shadow: { xPercent: 0, scale: .92, opacity: .72 },
            desk: { scale: 1, opacity: 0 }, deskGlow: { scale: 1, opacity: 0 },
          },
          about: {
            base: { scale: 1.012 }, cloud: { xPercent: -12, scale: 1.01, opacity: 1 },
            curtain: { xPercent: -14, yPercent: .4, scale: 1.008, opacity: .86 },
            fish: { xPercent: 12, yPercent: -2.5, scale: 1.015, opacity: 1 },
            house: { xPercent: -1.2, yPercent: -.8, scale: .97, opacity: 1 },
            shadow: { xPercent: -1, scale: .97, opacity: .62 },
            desk: { scale: 1.008, opacity: 1 }, deskGlow: { scale: 1.008, opacity: .9 },
          },
          experience: {
            base: { scale: 1.022 }, cloud: { xPercent: -28, scale: 1.018, opacity: .94 },
            curtain: { xPercent: -32, yPercent: 1.4, scale: 1.015, opacity: .9 },
            fish: { xPercent: 26, yPercent: -7, scale: 1.025, opacity: 1 },
            house: { xPercent: -3, yPercent: -2, scale: 1.04, opacity: 1 },
            shadow: { xPercent: -2.5, scale: 1.02, opacity: .54 },
            desk: { scale: 1.018, opacity: 0 }, deskGlow: { scale: 1.018, opacity: 0 },
          },
          works: {
            base: { scale: 1.034 }, cloud: { xPercent: -46, scale: 1.026, opacity: .94 },
            curtain: { xPercent: -50, yPercent: 2.4, scale: 1.022, opacity: .84 },
            fish: { xPercent: 42, yPercent: -10, scale: 1.035, opacity: .9 },
            house: { xPercent: -6.5, yPercent: -5, scale: 1.15, opacity: .28 },
            shadow: { xPercent: -5.5, scale: 1.1, opacity: .43 },
            desk: { scale: 1.026, opacity: 0 }, deskGlow: { scale: 1.026, opacity: 0 },
          },
          contact: {
            base: { scale: 1.048 }, cloud: { xPercent: -68, scale: 1.034, opacity: .72 },
            curtain: { xPercent: -72, yPercent: 3.2, scale: 1.03, opacity: .68 },
            fish: { xPercent: 64, yPercent: -15, scale: 1.05, opacity: .9 },
            house: { xPercent: -20, yPercent: -10, scale: 1.48, opacity: 0 },
            shadow: { xPercent: -22, scale: 1.5, opacity: .34 },
            desk: { scale: 1.034, opacity: 0 }, deskGlow: { scale: 1.034, opacity: 0 },
          },
      } as const;
      const targets = {
        base: '.qv-world__base', cloud: '.qv-world__cloud', curtain: '.qv-world__curtain, .qv-foreground__curtain-track',
        fish: '.qv-world__goldfish, .qv-foreground__goldfish-track', house: '.qv-world__house', shadow: '.qv-world__house-shadow',
      } as const;
      Object.entries(targets).forEach(([key, selector]) => gsap.set(selector, sceneState.hero[key as keyof typeof targets]));

      // A single playhead owns every world layer. Multiple overlapping ScrollTriggers
      // on the same transforms could overwrite each other and leave the scene static.
      const sceneTimeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: rootRef.current, start: 'top top', end: 'bottom bottom', scrub: true },
      });
      const addStage = (state: keyof typeof sceneState, position: number, duration: number) => {
        Object.entries(targets).forEach(([key, selector]) => {
          const vars = sceneState[state][key as keyof typeof targets];
          sceneTimeline.to(selector, { ...vars, duration }, position);
        });
      };
      const scrollRoot = rootRef.current;
      const scrollRange = Math.max(1, (scrollRoot?.scrollHeight ?? window.innerHeight) - window.innerHeight);
      const stageAt = (id: string) => {
        const section = document.getElementById(id);
        return Math.max(0, Math.min(.94, ((section?.offsetTop ?? 0) - window.innerHeight * .18) / scrollRange));
      };
      // Fill every interval instead of using short tweens at section boundaries.
      // The last journey ends at the bottom of Contact, so the large exit move is
      // distributed across the whole Works → Contact scroll instead of happening at once.
      const sceneStages = [
        { state: 'about' as const, end: stageAt('about') },
        { state: 'experience' as const, end: stageAt('experience') },
        { state: 'works' as const, end: stageAt('works') },
        { state: 'contact' as const, end: 1 },
      ];
      let previousStageEnd = 0;
      sceneStages.forEach(({ state, end }) => {
        const duration = Math.max(.001, end - previousStageEnd);
        addStage(state, previousStageEnd, duration);
        previousStageEnd = end;
      });
      // One continuous depth handoff: fish cross in front of the Hero title,
      // then sink behind the UI as the curtain rises over the About entrance.
      // The foreground curtain holds through the readable part of About and
      // returns to the environmental layer before Experience takes over.
      gsap.set('.qv-world__goldfish > img', { opacity: 0 });
      gsap.set('.qv-foreground__goldfish', { opacity: 1 });
      gsap.set('.qv-foreground__curtain', { opacity: 0 });
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: '.qv-about', start: 'top 96%', end: 'top 56%', scrub: true },
      })
        .to('.qv-foreground__goldfish', { opacity: 0, duration: .42 }, 0)
        .to('.qv-world__goldfish > img', { opacity: 1, duration: .42 }, 0)
        .to('.qv-world__curtain > img', { opacity: .22, duration: .58 }, .08)
        .to('.qv-foreground__curtain', { opacity: .9, duration: .58 }, .08);
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: '.qv-about', start: 'bottom 68%', end: 'bottom 24%', scrub: true },
      })
        .to('.qv-foreground__curtain', { opacity: 0, duration: 1 }, 0)
        .to('.qv-world__curtain > img', { opacity: 1, duration: 1 }, 0);
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: '.qv-about', start: 'top 92%', end: 'bottom 8%', scrub: true },
      })
        .fromTo('.qv-world__desk-scene', { opacity: 0, scale: 1 }, { opacity: 1, scale: 1.008, duration: .18 })
        .to('.qv-world__desk-scene', { opacity: 1, scale: 1.02, duration: .64 })
        .to('.qv-world__desk-scene', { opacity: 0, scale: 1.028, duration: .18 });
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: '.qv-about', start: 'top 86%', end: 'bottom 12%', scrub: true },
      })
        .fromTo('.qv-world__desk-glow', { opacity: 0, scale: 1.003 }, { opacity: .9, scale: 1.01, duration: .24 })
        .to('.qv-world__desk-glow', { opacity: .9, scale: 1.02, duration: .58 })
        .to('.qv-world__desk-glow', { opacity: 0, scale: 1.028, duration: .18 });
      gsap.fromTo('.qv-world__house-front',
        { opacity: 0, xPercent: -17, yPercent: -5, scale: 1.08 },
        { opacity: 1, xPercent: -23, yPercent: -11, scale: 1.62, ease: 'none', scrollTrigger: { trigger: '.qv-contact', start: 'top 90%', end: 'top 24%', scrub: true } },
      );
      // Each section gets a long reveal window, reaches a fully readable state,
      // then holds that state for the rest of its scroll distance.
      gsap.utils.toArray<HTMLElement>('.qv-section').forEach((section) => {
        const heading = section.querySelector('.qv-heading');
        const main = section.querySelector('.experience-cat, .qv-about__body, .qv-works__archive, .qv-contact__content');
        if (heading) gsap.fromTo(heading, { y: 48, opacity: 0 }, { y: 0, opacity: 1, ease: 'none', immediateRender: false, scrollTrigger: { trigger: section, start: 'top 96%', end: 'top 78%', scrub: true } });
        if (main && section.id === 'about') gsap.fromTo(main, { opacity: 0 }, { opacity: 1, ease: 'none', immediateRender: false, scrollTrigger: { trigger: section, start: 'top 92%', end: 'top 68%', scrub: true } });
        else if (main) gsap.fromTo(main, { y: 62, scale: .995, opacity: 0 }, { y: 0, scale: 1, opacity: 1, ease: 'none', immediateRender: false, scrollTrigger: { trigger: section, start: 'top 92%', end: 'top 68%', scrub: true } });
      });
    }, rootRef);
    return () => { document.body.classList.remove('quick-view-active'); window.history.scrollRestoration = previousScrollRestoration; ctx.revert(); };
  }, []);

  useEffect(() => () => drawTimers.current.forEach(window.clearTimeout), []);
  useEffect(() => {
    const ids = ['overview', 'about', 'experience', 'works', 'contact'];
    const updateActiveSection = () => {
      const focusLine = window.innerHeight * .42;
      let current = ids[0];
      let nearest = Number.POSITIVE_INFINITY;
      ids.forEach((id) => {
        const section = document.getElementById(id);
        if (!section) return;
        const rect = section.getBoundingClientRect();
        const distance = rect.top <= focusLine && rect.bottom >= focusLine
          ? 0
          : Math.min(Math.abs(rect.top - focusLine), Math.abs(rect.bottom - focusLine));
        if (distance < nearest) { nearest = distance; current = id; }
      });
      setActiveSection((previous) => previous === current ? previous : current);
    };
    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
    };
  }, []);
  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const navItems = [
    { id: 'overview', no: '00', en: 'Overview', zh: '首页' },
    { id: 'about', no: '01', en: 'About', zh: '关于我' },
    { id: 'experience', no: '02', en: 'Experience', zh: '经历' },
    { id: 'works', no: '03', en: 'Selected Works', zh: '作品' },
    { id: 'contact', no: '04', en: 'Contact', zh: '联系' },
  ];
  return <>
    <StudioChrome
      label="My Studio"
      onBack={onBack}
      tone="light"
      zIndex={80}
      className="qv-quick-chrome"
      hideMenu
    />
    {/* 已锁定的 D 方案：右上角当前章节＋五点导航。 */}
    <nav className="qv-film-nav qv-film-nav--d" aria-label="Quick View 导航">
      <div className="qv-film-nav__current" aria-live="polite">
        <span>{navItems.find((item) => item.id === activeSection)?.no} / 04</span>
        <strong>{navItems.find((item) => item.id === activeSection)?.zh}</strong>
        <small>{navItems.find((item) => item.id === activeSection)?.en}</small>
      </div>
      <div className="qv-film-nav__track">
        {navItems.map((item) => <button
          key={item.id}
          type="button"
          className={activeSection === item.id ? 'is-active' : ''}
          aria-current={activeSection === item.id ? 'page' : undefined}
          aria-label={`${item.no} ${item.en} ${item.zh}`}
          onClick={() => goTo(item.id)}
          data-cursor="Jump"
          data-cursor-tone="dark"
        ><span>{item.no}</span><strong>{item.zh}</strong><small>{item.en}</small></button>)}
      </div>
    </nav>
    <main ref={rootRef} className="quick-view quick-view--meadow">
    <GrassWorldBackground />
    <GrassWorldForeground />
    <CursorLabel />
    <div className="qv-noise" aria-hidden="true" />
    <section className="qv-hero" id="overview" data-tear-scroll-root>
      <div className="qv-hero__stage">
        <div className="qv-hero__backdrop" aria-hidden="true" />
        <div className="qv-hero__field">
        <div className="qv-hero__copy">
          <p className="qv-hero__index">Sun Chenxi’s</p>
          <h1><span>Portfolio</span><span>A clear way into my studio.</span></h1>
          <p className="qv-hero__welcome">从这里快速认识我的经历与作品。</p>
        </div>
        <div className="qv-hero__decoration" aria-hidden="true">
          <span className="qv-hero__mint-dot qv-hero__mint-dot--1" />
          <span className="qv-hero__mint-dot qv-hero__mint-dot--2" />
          <span className="qv-hero__mint-dot qv-hero__mint-dot--3" />
          <span className="qv-hero__mint-dot qv-hero__mint-dot--4" />
          <i className="qv-hero__spark qv-hero__spark--1">★</i>
          <i className="qv-hero__spark qv-hero__spark--2">★</i>
        </div>
        </div>
        <button className="qv-hero__enter home-open home-open-gate__open" type="button" onClick={() => goTo('about')} data-cursor="Scroll" data-cursor-tone="light">向下看看</button>
      </div>
    </section>

    <section className="qv-section qv-about" id="about"><BrushMotifs /><div className="qv-about__scene"><SectionHeading no="01" zh="关于我" variant="portfolio">About me</SectionHeading>
      <div className="qv-about__body">
      <div className="qv-about__identity"><article className="qv-id qv-reveal" aria-label="个人简介 ID 卡">
        <div className="qv-id__scribbles" aria-hidden="true"><span>★</span><span>★</span><span>· · ·</span><span>↗</span><span>☆</span></div>
        <div className="qv-id__left">
          <div className="qv-id__portrait"><div><img src="/quick-view/id-portrait.webp" alt="个人形象线稿" loading="lazy" decoding="async" /></div></div>
          <div className="qv-id__ornament" aria-hidden="true"><span>★</span><i/><span>·</span><i/><span>★</span></div>
        </div>
        <div className="qv-id__info">
          <h3>Access Permit</h3>
          <span className="qv-id__watermark" aria-hidden="true">Sun</span>
          <dl>
            <div><dt>名字</dt><dd>孙晨茜</dd></div>
            <div><dt>年龄</dt><dd>22</dd></div>
            <div><dt>院校</dt><dd>天津传媒学院 · 广告学</dd></div>
            <div><dt>方向</dt><dd>整合营销 · 短视频 · AI 提效</dd></div>
          </dl>
          <div className="qv-id__foot"><small>MARKETING · CONTENT · AI<br/>Personal archive · 2026</small><span aria-hidden="true">☆</span></div>
        </div>
      </article><p className="qv-id__caption">SUN CHENXI / PROFILE 2026</p></div>
      <div className="qv-about__profile qv-reveal">
        <p className="qv-about__lead">广告学专业，拥有四段整合营销、品牌内容与新媒体运营相关实习经历。</p>
        <div className="qv-about__highlights" aria-label="核心能力"><span>整合营销</span><span>品牌内容</span><span>新媒体运营</span><span>达人投放</span><span>数据复盘</span><span>AI 提效</span></div>
      </div>
        <div className="qv-about__facts">
          <section><span>01 / SKILLS</span><h3>我会什么</h3><p>覆盖策略、内容、投放与复盘，可继续推进具体交付。</p><ul><li><strong>整合营销</strong> 竞品调研、传播主题、活动机制与提案</li><li><strong>内容运营</strong> 短视频选题、脚本剪辑与多平台运营</li><li><strong>投放复盘</strong> 达人协作、日报周报、CTR 与 ROI</li><li><strong>工具提效</strong> 来客、巨量、聚光、蒲公英与 AI</li></ul></section>
          <section><span>02 / EXPERIENCE</span><h3>我干过什么</h3><p>四段品牌市场与新媒体实习，覆盖品牌方和广告公司。</p><ul><li><strong>新白文化</strong> 矩阵账号、54 位达人、节点策划与投放</li><li><strong>行行行广告</strong> 快手整合营销与神州租车运营提案</li><li><strong>氪星创服</strong> 科创品牌内容、短视频与活动传播</li><li><strong>春山里</strong> 抖音账号运营、短视频与日常文案</li></ul></section>
          <section><span>03 / RESULTS</span><h3>我做出过什么</h3><p>以传播数据、客户反馈和完整交付验证工作结果。</p><ul><li><strong>18.41 亿+</strong> 快手项目话题曝光，累计上榜 39 个</li><li><strong>TOP1</strong> 快手最高榜位，规划热点 26 个</li><li><strong>ROI 2.89</strong> 袖珍世界样本周期单周投放结果</li><li><strong>客户认可</strong> 神州租车核心策略纳入内部参考库</li></ul></section>
          <section><span>04 / DIRECTION</span><h3>我期待什么</h3><p>求职方向聚焦整合营销、品牌内容与新媒体运营。</p><ul><li><strong>近期</strong> 独立承担调研、策划、内容与达人协作模块</li><li><strong>长期</strong> 提升品牌策略、平台增长与商业化投放能力</li></ul></section>
        </div>
      </div></div>
    </section>

    <section className="qv-section qv-experience" id="experience"><BrushMotifs /><SectionHeading no="02" zh="实习与项目经历" variant="portfolio">Experience</SectionHeading>
      <div className="experience-cat">
        <div className="experience-cat__top"><p>点击 01，自动画出经历小猫；节点亮起后可查看详情。</p><button className="experience-cat__prompt" type="button" onClick={drawCat} data-cursor="Replay" data-cursor-tone="dark">重新自动画一遍 <span aria-hidden="true">★</span></button></div>
        <div className="experience-cat__canvas">
          <svg viewBox="0 0 1000 600" role="img" aria-label="由经历节点连接而成的手绘小猫">
            <g className="experience-cat__stars" aria-hidden="true"><text x="80" y="110">☆</text><text x="850" y="105">★</text><text x="910" y="390">☆</text><text x="180" y="535">☆</text></g>
            <g className="experience-cat__paths">
              <path className={drawStep >= 1 ? 'is-drawn' : ''} d="M118 454 C72 330 112 205 300 150" />
              <path className={drawStep >= 2 ? 'is-drawn' : ''} d="M300 150 C352 148 395 142 430 138 L480 62 L548 142" />
              <path className={drawStep >= 3 ? 'is-drawn' : ''} d="M548 142 C590 134 625 139 660 148 L725 70 L770 128 C785 149 782 184 788 213" />
              <path className={drawStep >= 4 ? 'is-drawn' : ''} d="M788 213 C900 257 942 387 872 505" />
            </g>
            <g className={`experience-cat__face${drawStep >= 4 ? ' is-lit' : ''}`} aria-hidden="true">
              <path d="M580 274 c-20-30 32-42 32-4 c0 30-42 31-43 1 M675 274 c-20-30 32-42 32-4 c0 30-42 31-43 1" />
              <path d="M626 306 l14 20 l14-20 M641 327 L641 355 M624 372 Q641 386 658 372 M565 337 L500 322 M564 354 L490 354 M568 371 L507 401 M714 337 L779 320 M716 354 L790 354 M712 371 L773 402" />
              <path d="M606 414 L676 414" />
            </g>
            <g className={`experience-cat__words${drawStep >= 3 ? ' is-visible' : ''}`} aria-hidden="true"><text x="585" y="118">I have</text><text x="794" y="192">be</text><text x="760" y="540">(8)</text></g>
            {EXPERIENCES.map((item, index) => { const available = index === 0 || drawStep >= index + 1; return <g className={`experience-cat__node${index === 0 ? ' is-start' : ''}${drawStep >= index + 1 ? ' is-active' : ''}${selectedExperience === index ? ' is-selected' : ''}${available ? '' : ' is-locked'}`} key={item.no} transform={`translate(${item.x} ${item.y})`} role="button" tabIndex={available ? 0 : -1} aria-disabled={!available} aria-label={`${index === 0 && drawStep === 0 ? '开始绘制并' : ''}查看经历 ${item.no}：${item.title}`} data-cursor={available ? 'View' : undefined} data-cursor-tone="light" onClick={() => openExperience(index)} onKeyDown={(event) => { if (available && (event.key === 'Enter' || event.key === ' ')) openExperience(index); }}><circle r="19"/><text y="-30">{item.label}</text><text y="5">{item.no}</text></g>; })}
          </svg>
        </div>
        <div className="experience-cat__progress">{EXPERIENCES.map((item, index) => { const available = index === 0 || drawStep >= index + 1; return <button className={selectedExperience === index ? 'is-current' : ''} key={item.no} type="button" disabled={!available} data-cursor={available ? 'View' : undefined} data-cursor-tone="light" onClick={() => openExperience(index)}><span>{item.no}</span>{item.title}</button>; })}</div>
        {selectedExperience !== null && <article className="experience-cat__detail" key={selectedExperience} aria-live="polite">
          <header><span>{EXPERIENCES[selectedExperience].no} / EXPERIENCE</span><h3>{EXPERIENCES[selectedExperience].title}</h3><p>{EXPERIENCES[selectedExperience].detail}</p></header>
          <dl><div><dt>时间</dt><dd>{EXPERIENCES[selectedExperience].period}</dd></div><div><dt>项目</dt><dd>{EXPERIENCES[selectedExperience].organization}</dd></div><div><dt>岗位</dt><dd>{EXPERIENCES[selectedExperience].role}</dd></div></dl>
          <ul>{EXPERIENCES[selectedExperience].bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
        </article>}
      </div>
    </section>

    <section className="qv-section qv-works" id="works"><BrushMotifs /><SectionHeading no="03" zh="精选作品" variant="portfolio">Selected works</SectionHeading>
      <div className="qv-works__archive">
        <section className="qv-work-chapter qv-work-chapter--planning" aria-labelledby="qv-planning-title">
          <header className="qv-work-chapter__header"><div><span>01</span><h3 id="qv-planning-title">Planning</h3><small>策划案</small></div></header>
          <div className="qv-plan-index" role="tablist" aria-label="选择策划案">
            {PLAN_PREVIEWS.map((plan, index) => <button key={plan.id} type="button" role="tab" aria-selected={activePlan === index} className={activePlan === index ? 'is-active' : ''} onClick={() => setActivePlan(index)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{plan.title}</strong></button>)}
          </div>
          <article className="qv-plan-case" key={PLAN_PREVIEWS[activePlan].id} role="tabpanel">
            <figure><img src={PLAN_PREVIEWS[activePlan].cover} alt={`${PLAN_PREVIEWS[activePlan].title}策划案封面`} /><figcaption><span>{PLAN_PREVIEWS[activePlan].client}</span><span>{PLAN_PREVIEWS[activePlan].year}</span></figcaption></figure>
            <div className="qv-plan-case__copy"><h4>{PLAN_PREVIEWS[activePlan].title}</h4><div className="qv-plan-notes">
              {PLAN_PREVIEWS[activePlan].notes.map((note, index) => <details key={note.label}><summary><span>{String(index + 1).padStart(2, '0')}</span><strong>{note.label}</strong><p>{note.summary}</p><i aria-hidden="true">＋</i></summary><div>{note.detail}</div></details>)}
            </div>{PLAN_PREVIEWS[activePlan].slot === null ? (
              <button className="qv-work-enter" type="button" disabled>详细内容整理中</button>
            ) : (
              <button className="qv-work-enter" type="button" onClick={() => onExplore('plans', PLAN_PREVIEWS[activePlan].slot!)} data-cursor="Enter" data-cursor-tone="light">查看完整策划案 <span aria-hidden="true">↗</span></button>
            )}</div>
          </article>
        </section>

        <section className="qv-work-chapter" aria-labelledby="qv-video-title">
          <header className="qv-work-chapter__header"><div><span>02</span><h3 id="qv-video-title">Video</h3><small>视频</small></div></header>
          <div className="qv-video-directory">
            {VIDEO_GROUPS.map((group) => { const items = MEDIA_WORKS.filter((work) => work.channel === group.key); return <section key={group.key}><header><h4>{group.label}</h4><span>{String(items.length).padStart(2, '0')}</span></header><ol>{items.map((work) => <li key={work.id}><button type="button" onClick={() => onExplore('media')} data-cursor="View" data-cursor-tone="light"><span>{work.title}</span><small>{work.length}</small></button></li>)}</ol></section>; })}
          </div>
        </section>

        <section className="qv-work-chapter" aria-labelledby="qv-copy-title">
          <header className="qv-work-chapter__header"><div><span>03</span><h3 id="qv-copy-title">Copywriting</h3><small>文案</small></div></header>
          <div className="qv-copy-directory">{COPY_PROJECTS.map((project, index) => <details key={project.id}><summary data-cursor="Read" data-cursor-tone="light"><span>{String(index + 1).padStart(2, '0')}</span><strong>{project.title}</strong><small>{project.form ?? '品牌文案'}</small><i aria-hidden="true">＋</i></summary><div className="qv-copy-directory__text">{copyText(project)}</div></details>)}</div>
        </section>
      </div>
    </section>

    <section className="qv-section qv-contact" id="contact"><BrushMotifs /><div className="qv-contact__sky" aria-hidden="true"><span>☆</span><span>★</span><span>☆</span><span>·</span><span>☆</span></div><SectionHeading no="04" zh="联系" variant="portfolio">Let’s connect.</SectionHeading><div className="qv-contact__content qv-reveal"><span className="qv-contact__intro">期待与你相遇，在下一片绿地。</span><a className="qv-contact__email" href={`mailto:${CONTACT.email}`} data-cursor="Email" data-cursor-tone="dark"><small>EMAIL</small><strong>{CONTACT.email}</strong><i aria-hidden="true">↗</i></a><div className="qv-contact__actions"><a href={RESUME_URL} download={RESUME_FILENAME} data-cursor="Resume" data-cursor-tone="dark"><span>DOWNLOAD RESUME <i aria-hidden="true">↓</i></span><small>下载简历</small></a></div><button className="qv-enter-explore" type="button" onClick={() => onExplore()} data-cursor="Enter" data-cursor-tone="dark"><span>ENTER EXPLORE</span><small>进入建筑 · 探索内部空间</small></button></div></section>
  </main>
  </>;
}
