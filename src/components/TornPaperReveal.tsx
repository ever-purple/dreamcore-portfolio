import { useEffect, useId, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export type TornPaperConfig = {
  seed: number;
  position: number;
  roughness: number;
  pointSpacing: number;
  fiberDensity: number;
  grain: number;
  halftone: number;
  topTravel: number;
  bottomTravel: number;
};

export const TEAR_CONFIG: TornPaperConfig = {
  seed: 41723,
  position: .52,
  roughness: .94,
  pointSpacing: 8,
  fiberDensity: 2.3,
  grain: .14,
  halftone: .18,
  topTravel: 1.08,
  bottomTravel: 1.16,
};

type TornPaperRevealProps = {
  imageSrc: string;
  config?: Partial<TornPaperConfig>;
  className?: string;
  scrollDriven?: boolean;
};

type Point = { x: number; y: number };
type Fiber = { x1: number; y1: number; x2: number; y2: number; width: number; opacity: number };

function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function buildTear(config: TornPaperConfig) {
  const width = 1000;
  const height = 600;
  const center = height * config.position;
  const random = mulberry32(config.seed);
  const count = Math.ceil(width / config.pointSpacing);
  const lowAnchors = Array.from({ length: Math.ceil(count / 9) + 2 }, () => (random() - .5) * 42 * config.roughness);
  const mediumAnchors = Array.from({ length: Math.ceil(count / 4) + 2 }, () => (random() - .5) * 16 * config.roughness);
  const points: Point[] = [];

  for (let index = 0; index <= count; index += 1) {
    const x = Math.min(width, index * width / count);
    const lowIndex = Math.floor(index / 9);
    const lowMix = (index % 9) / 9;
    const low = lowAnchors[lowIndex] * (1 - lowMix) + lowAnchors[lowIndex + 1] * lowMix;
    const mediumIndex = Math.floor(index / 4);
    const mediumMix = (index % 4) / 4;
    const medium = mediumAnchors[mediumIndex] * (1 - mediumMix) + mediumAnchors[mediumIndex + 1] * mediumMix;
    const high = (random() - .5) * 5 * config.roughness;
    const notch = random() > .94 ? (random() > .5 ? 1 : -1) * (7 + random() * 13) * config.roughness : 0;
    let y = center + low + medium + high + notch;
    if (index > 0 && random() > .88) y = points[index - 1].y + (random() - .5) * 2.5;
    points.push({ x, y });
  }

  const seam = `M${points.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}`;
  const reversed = [...points].reverse();
  const top = `M0 0H${width}L${reversed.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}Z`;
  const bottom = `${seam}L${width} ${height}H0Z`;
  const fibers: Fiber[] = [];
  let cursor = 8 + random() * 18;
  while (cursor < width - 8) {
    const pointIndex = Math.min(points.length - 2, Math.max(1, Math.round(cursor / width * count)));
    const point = points[pointIndex];
    const previous = points[pointIndex - 1];
    const next = points[pointIndex + 1];
    const angle = Math.atan2(next.y - previous.y, next.x - previous.x) + Math.PI / 2 + (random() - .5) * .55;
    const length = 3 + random() * 14;
    fibers.push({
      x1: point.x - Math.cos(angle) * length * .28,
      y1: point.y - Math.sin(angle) * length * .28,
      x2: point.x + Math.cos(angle) * length * .72,
      y2: point.y + Math.sin(angle) * length * .72,
      width: .35 + random() * 1.7,
      opacity: .22 + random() * .68,
    });
    cursor += (15 + random() * 25) / Math.max(.2, config.fiberDensity);
  }
  return { width, height, seam, top, bottom, fibers };
}

export function TornPaperReveal({ imageSrc, config: overrides, className = '', scrollDriven = true }: TornPaperRevealProps) {
  const rootRef = useRef<HTMLElement>(null);
  const maskId = useId().replace(/:/g, '');
  const config = useMemo(() => ({ ...TEAR_CONFIG, ...overrides }), [overrides]);
  const tear = useMemo(() => buildTear(config), [config]);

  useEffect(() => {
    if (!scrollDriven || !rootRef.current) return;
    const scrollRoot = rootRef.current.closest<HTMLElement>('[data-tear-scroll-root]');
    if (!scrollRoot) return;
    const context = gsap.context(() => {
      gsap.set('.torn-paper__edge', { opacity: 0 });
      gsap.timeline({ scrollTrigger: {
        trigger: scrollRoot,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1.55,
        pin: scrollRoot.querySelector('.qv-hero__stage'),
        pinSpacing: false,
        anticipatePin: 1,
      } })
        .fromTo('.torn-paper__edge', { opacity: 0 }, { opacity: 1, duration: .15, ease: 'power2.in', immediateRender: false }, .1)
        .to('.torn-paper__base', { opacity: 0, duration: .08, ease: 'power2.in' }, .14)
        .to('.torn-paper__top', { yPercent: -config.topTravel * 100, x: -6, rotation: -.55, duration: .55, ease: 'power3.inOut' }, .25)
        .to('.torn-paper__edge-top', { yPercent: -config.topTravel * 100, x: -6, rotation: -.55, duration: .55, ease: 'power3.inOut' }, .25)
        .to('.torn-paper__bottom', { yPercent: config.bottomTravel * 100, x: 5, rotation: .32, duration: .58, ease: 'power4.inOut' }, .25)
        .to('.torn-paper__edge-bottom', { yPercent: config.bottomTravel * 100, x: 5, rotation: .32, duration: .58, ease: 'power4.inOut' }, .25)
        .to('.torn-paper__shadow', { opacity: .58, duration: .24, ease: 'power2.out' }, .28)
        .to('.torn-paper__edge', { opacity: 0, duration: .2, ease: 'power2.out' }, .72);
    }, rootRef);
    return () => context.revert();
  }, [config, scrollDriven, tear.height, tear.width]);

  const layer = (side: 'top' | 'bottom') => <div className={`torn-paper__layer torn-paper__${side}`}>
    <svg viewBox={`0 0 ${tear.width} ${tear.height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <mask id={`${maskId}-${side}`} maskUnits="userSpaceOnUse"><rect width={tear.width} height={tear.height} fill="black"/><path d={side === 'top' ? tear.top : tear.bottom} fill="white"/></mask>
        <pattern id={`${maskId}-${side}-dots`} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".85" fill="#111"/></pattern>
        <filter id={`${maskId}-${side}-grain`} x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".78" numOctaves="3" seed={config.seed % 97}/><feColorMatrix type="saturate" values="0"/></filter>
      </defs>
      <g mask={`url(#${maskId}-${side})`}><image href={imageSrc} width={tear.width} height={tear.height} preserveAspectRatio="xMidYMid slice"/><rect width={tear.width} height={tear.height} fill={`url(#${maskId}-${side}-dots)`} opacity={config.halftone}/><rect width={tear.width} height={tear.height} filter={`url(#${maskId}-${side}-grain)`} opacity={config.grain}/></g>
    </svg>
  </div>;

  const edge = (side: 'top' | 'bottom') => <div className={`torn-paper__edge-layer torn-paper__edge-${side}`} aria-hidden="true">
    <svg className="torn-paper__edge-svg" viewBox={`0 0 ${tear.width} ${tear.height}`} preserveAspectRatio="xMidYMid slice">
      <defs>
        <filter id={`${maskId}-shadow-${side}`} x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>
        <filter id={`${maskId}-rough-${side}`} x="-10%" y="-35%" width="120%" height="170%">
          <feTurbulence type="fractalNoise" baseFrequency=".025 .16" numOctaves="3" seed={(config.seed + (side === 'top' ? 13 : 29)) % 97} result="fiberNoise"/>
          <feDisplacementMap in="SourceGraphic" in2="fiberNoise" scale="5.5" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
      </defs>
      <path className="torn-paper__shadow torn-paper__edge" d={tear.seam} filter={`url(#${maskId}-shadow-${side})`}/>
      <g filter={`url(#${maskId}-rough-${side})`}>
        <path className="torn-paper__fiber-bed torn-paper__edge" d={tear.seam}/>
        <path className="torn-paper__dark torn-paper__edge" d={tear.seam}/>
        <path className="torn-paper__paper torn-paper__edge" d={tear.seam}/>
        <g className="torn-paper__fibers torn-paper__edge">{tear.fibers.map((fiber, index) => <line key={index} x1={fiber.x1} y1={fiber.y1} x2={fiber.x2} y2={fiber.y2} strokeWidth={fiber.width} opacity={fiber.opacity}/>)}</g>
      </g>
    </svg>
  </div>;

  return <figure ref={rootRef} className={`torn-paper ${className}`} aria-label="横向撕开的作品集主视觉">
    <img className="torn-paper__base" src={imageSrc} alt="" />
    {layer('top')}{layer('bottom')}{edge('top')}{edge('bottom')}
  </figure>;
}
