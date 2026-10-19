import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import gsap from 'gsap';
import QRCode from 'qrcode';
import { StudioChrome } from '@/components/StudioChrome';
import { useEscape } from '@/lib/escape-stack';
import { playFilmPrinter } from '@/lib/filmPrinterAudio';

type Props = { onClose: () => void; initialReading?: boolean };

const FIRST_MIX_DEMO_URL = (import.meta.env.VITE_FIRST_MIX_DEMO_URL as string | undefined)?.trim() || 'https://firstmix.everpurple.top';
export default function ProductLabPage({ onClose, initialReading = false }: Props) {
  const [entered, setEntered] = useState(false);
  const projectOpen = true;
  const [pagesRevealed, setPagesRevealed] = useState(initialReading);
  const [scanPosition, setScanPosition] = useState({ x: 0, y: 0 });
  const [scannerReady, setScannerReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isPrinted, setIsPrinted] = useState(false);
  const [isExposed, setIsExposed] = useState(false);
  const [activeScan, setActiveScan] = useState(1);
  const [activeConceptStep, setActiveConceptStep] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const caseRef = useRef<HTMLDivElement>(null);
  const scanStageRef = useRef<HTMLDivElement>(null);
  const scanZoneRef = useRef<HTMLDivElement>(null);
  const scanItemRef = useRef<HTMLButtonElement>(null);
  const demoQrRef = useRef<HTMLCanvasElement>(null);
  const animatingRef = useRef(false);
  const scanDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const suppressScanClickRef = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const placeObject = () => {
      const stage = scanStageRef.current;
      const zone = scanZoneRef.current;
      const item = scanItemRef.current;
      if (!stage || !zone || !item) return;
      const stageBounds = stage.getBoundingClientRect();
      const zoneBounds = zone.getBoundingClientRect();
      const itemBounds = item.getBoundingClientRect();
      stage.style.setProperty('--scan-zone-top', `${zoneBounds.top - stageBounds.top}px`);
      stage.style.setProperty('--scan-zone-right', `${stageBounds.right - zoneBounds.right}px`);
      stage.style.setProperty('--scan-zone-bottom', `${stageBounds.bottom - zoneBounds.bottom}px`);
      stage.style.setProperty('--scan-zone-left', `${zoneBounds.left - stageBounds.left}px`);
      const compact = stageBounds.width < 560;
      const x = Math.max(compact ? 12 : 28, stageBounds.width * .055);
      const y = Math.max(12, stageBounds.height - itemBounds.height - (compact ? 154 : 202));
      setScanPosition({ x, y: Math.min(y, stageBounds.height - itemBounds.height - 12) });
      setIsScanning(false);
      setIsPrinted(false);
      setIsExposed(false);
      setScannerReady(true);
    };
    const frame = requestAnimationFrame(placeObject);
    window.addEventListener('resize', placeObject);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', placeObject);
    };
  }, []);

  useEffect(() => {
    const canvas = demoQrRef.current;
    if (!pagesRevealed || !canvas || !FIRST_MIX_DEMO_URL) return;
    void QRCode.toCanvas(canvas, FIRST_MIX_DEMO_URL, {
      width: 148,
      margin: 1,
      color: { dark: '#34362f', light: '#e7eee4' },
      errorCorrectionLevel: 'M',
    });
  }, [pagesRevealed]);

  useEffect(() => {
    if (!pagesRevealed) return;
    const sections = Array.from({ length: 7 }, (_, index) => document.getElementById(`first-mix-scan-${index + 1}`)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveScan(Number((visible.target as HTMLElement).id.split('-').pop()));
    }, { root: scrollerRef.current, rootMargin: '-22% 0px -52% 0px', threshold: [0, .2, .5] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [pagesRevealed]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const context = gsap.context(() => {
      gsap.set(caseRef.current, { autoAlpha: 1, pointerEvents: 'auto' });
    }, root);
    return () => {
      context.revert();
    };
  }, []);

  const closeProject = () => {
    if (animatingRef.current) return;
    onClose();
  };

  useEscape(() => {
    if (animatingRef.current) return;
    closeProject();
  });

  const updateScanState = (x: number, y: number) => {
    const stage = scanStageRef.current;
    const zone = scanZoneRef.current;
    const item = scanItemRef.current;
    if (!stage || !zone || !item) return false;
    const stageBounds = stage.getBoundingClientRect();
    const zoneBounds = zone.getBoundingClientRect();
    const itemBounds = item.getBoundingClientRect();
    const left = stageBounds.left + x;
    const top = stageBounds.top + y;
    const padding = stageBounds.width < 560 ? 8 : 20;
    const overlaps = !(
      left + itemBounds.width < zoneBounds.left + padding
      || left > zoneBounds.right - padding
      || top + itemBounds.height < zoneBounds.top + padding
      || top > zoneBounds.bottom - padding
    );
    setIsScanning(overlaps);
    if (!overlaps) {
      setIsPrinted(false);
      setIsExposed(false);
    }
    return overlaps;
  };

  const exposeScan = () => {
    if (!isPrinted || animatingRef.current) return;
    setIsExposed((current) => !current);
  };

  const printFilm = () => {
    if (!isScanning || isPrinted || animatingRef.current) return;
    setIsPrinted(true);
    playFilmPrinter();
  };

  const handleScannerPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || animatingRef.current) return;
    const itemBounds = event.currentTarget.getBoundingClientRect();
    scanDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - itemBounds.left,
      offsetY: event.clientY - itemBounds.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleScannerPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = scanDragRef.current;
    const stage = scanStageRef.current;
    const item = scanItemRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !stage || !item) return;
    const stageBounds = stage.getBoundingClientRect();
    const itemBounds = item.getBoundingClientRect();
    const x = Math.max(0, Math.min(stageBounds.width - itemBounds.width, event.clientX - stageBounds.left - drag.offsetX));
    const y = Math.max(0, Math.min(stageBounds.height - itemBounds.height, event.clientY - stageBounds.top - drag.offsetY));
    if (Math.abs(x - scanPosition.x) + Math.abs(y - scanPosition.y) > 3) drag.moved = true;
    setScanPosition({ x, y });
    updateScanState(x, y);
  };

  const handleScannerPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = scanDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressScanClickRef.current = drag.moved;
    scanDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    requestAnimationFrame(() => { suppressScanClickRef.current = false; });
  };

  const revealPages = () => {
    if (!projectOpen || !isScanning || !isExposed || animatingRef.current) return;
    if (!pagesRevealed) setPagesRevealed(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      const reader = scroller?.querySelector<HTMLElement>('.product-reader');
      if (scroller && reader) scroller.scrollTo({ top: reader.offsetTop, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }));
  };

  const returnToScanner = () => {
    setPagesRevealed(false);
    setActiveScan(1);
    requestAnimationFrame(() => scrollerRef.current?.scrollTo({ top: 0, behavior: 'instant' }));
  };

  const scrollToScan = (event: MouseEvent<HTMLAnchorElement>, index: number) => {
    event.preventDefault();
    const target = document.getElementById(`first-mix-scan-${index}`);
    const scroller = scrollerRef.current;
    if (!target || !scroller) return;
    setActiveScan(index);
    const headerHeight = scroller.querySelector<HTMLElement>('.product-reader__header')?.getBoundingClientRect().height ?? 128;
    scroller.scrollTo({
      top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - headerHeight - 8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return (
    <div ref={rootRef} className={`product-lab-shell${entered ? ' is-in' : ''}`}>
      <div ref={caseRef} className="product-case" role="dialog" aria-modal={projectOpen} aria-label="FIRST MIX 产品档案" aria-hidden={!projectOpen} data-lenis-prevent>
        <div ref={scrollerRef} className={`product-case__scroller product-case__scroller--printer${pagesRevealed ? ' is-reading' : ''}`}>
          {!pagesRevealed && (
            <main className={`product-security-scanner${isScanning ? ' is-scanning' : ''}${isPrinted ? ' is-printed' : ''}${isExposed ? ' is-exposed' : ''}`} aria-label="FIRST MIX 安检透视台">
              <div className="product-security-scanner__noise" aria-hidden="true" />
              {isPrinted && (
                <header className="product-security-scanner__header" aria-live="polite">
                  <div><i /><small>PERSONAL EXPERIMENT / XR–FM–01</small><h1>FIRST MIX</h1><span>零经验用户的打碟练习产品</span></div>
                </header>
              )}
              <div ref={scanStageRef} className={`product-security-scanner__stage${scannerReady ? ' is-ready' : ''}`}>
                <p className="product-security-scanner__instruction">拖入扫描框，点击物品打印底片<small>[ DRAG · SELECT · PRINT ]</small></p>
                <div ref={scanZoneRef} className="product-security-scanner__zone" aria-label="X 光透视区域">
                  <span>SCAN BED / XR–FM–01</span><i /><b>{isPrinted ? 'FILM READY' : isScanning ? 'SELECT OBJECT' : 'AWAITING OBJECT'}</b>
                </div>
                <div className="product-security-scanner__xray-layer" aria-hidden="true">
                  <img className="product-security-scanner__object product-security-scanner__object--xray" src="/product/first-mix-controller-xray-v1.png" alt="" style={{ left: scanPosition.x, top: scanPosition.y }} />
                </div>
                <button
                  ref={scanItemRef}
                  className="product-security-scanner__object product-security-scanner__object--solid"
                  type="button"
                  style={{ left: scanPosition.x, top: scanPosition.y }}
                  onPointerDown={handleScannerPointerDown}
                  onPointerMove={handleScannerPointerMove}
                  onPointerUp={handleScannerPointerUp}
                  onPointerCancel={handleScannerPointerUp}
                  onClick={() => { if (isScanning && !suppressScanClickRef.current) printFilm(); }}
                  onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && isScanning) printFilm(); }}
                  aria-label={isScanning ? '打印 FIRST MIX 项目底片' : '拖动 FIRST MIX 打碟机到透视区域'}
                >
                  <img src="/product/first-mix-controller-solid-v1.png" alt="FIRST MIX 白色双唱盘打碟机" draggable="false" />
                </button>
                <div className="product-security-scanner__output" aria-live="polite">
                  <div className="product-security-scanner__film-gate">
                    <i className="product-security-scanner__print-slot" aria-hidden="true" />
                    <button
                      className="product-security-scanner__film"
                      type="button"
                      onClick={exposeScan}
                      disabled={!isPrinted}
                      aria-hidden={!isPrinted}
                      tabIndex={isPrinted ? 0 : -1}
                      aria-label={isExposed ? '关闭 FIRST MIX X 光底片灯箱' : '点亮 FIRST MIX X 光底片灯箱'}
                    >
                      <img src="/product/first-mix-printed-xray-film.png" alt="FIRST MIX 打碟机与耳机的 X 光底片" draggable="false" />
                    </button>
                  </div>
                  {isExposed && <button className="product-security-scanner__enter" type="button" onClick={revealPages}>查看完整项目 →</button>}
                </div>
                <aside className="product-security-scanner__telemetry" aria-live="polite">
                  <span>SCAN TELEMETRY READOUT</span>
                  <div><b>{isPrinted ? 'STATUS: FILM READY' : isScanning ? 'STATUS: SELECT' : 'STATUS: IDLE'}</b><i>RAD_LVL</i></div>
                  <em><i style={{ transform: `scaleX(${isPrinted ? 1 : isScanning ? .72 : .1})` }} /></em>
                  <small>OBJ.MATCH: {isScanning ? 'FIRST_MIX_CONTROLLER' : 'N/A'}</small>
                  <small>ANOMALY: {isScanning ? 'EXPERIMENTAL PRODUCT' : 'NONE'}</small>
                </aside>
              </div>
            </main>
          )}
          {pagesRevealed && (
            <main className="product-reader" aria-label="FIRST MIX 产品档案阅读台">
              <header className="product-reader__header">
                <div className="product-reader__masthead">
                  <div><span>FILE 01 / PERSONAL EXPERIMENT</span><h1>FIRST MIX</h1></div>
                </div>
                <nav className="product-reader__scan-index" aria-label="项目章节">
                  {['项目概览', '洞察与问题', '产品构思', 'AI 能力', '真机体验', '开发迭代', '上线反馈'].map((label, index) => (
                    <a className={activeScan === index + 1 ? 'is-active' : ''} href={`#first-mix-scan-${index + 1}`} onClick={(event) => scrollToScan(event, index + 1)} aria-current={activeScan === index + 1 ? 'location' : undefined} key={label}><i /><small>{String(index + 1).padStart(2, '0')}</small><span>{label}</span></a>
                  ))}
                </nav>
                <div className="product-reader__chapter-state" aria-live="polite">
                  <span>CURRENT SCAN</span><b>{String(activeScan).padStart(2, '0')} / 07</b>
                  <button type="button" onClick={returnToScanner}>返回扫描台 ↑</button>
                </div>
              </header>
              <div className="product-reader__workspace">
                <div className="product-reader__scanbed">
                  <section className="product-reader__chapter product-reader__chapter--demo" id="first-mix-scan-1" aria-label="FIRST MIX 项目概览设计演示">
                    <div className="product-dossier">
                      <div className="product-dossier__rail"><span>XR / FM — 01</span><span>PERSONAL EXPERIMENT</span><span>SCAN 01 / 07</span></div>
                      <div className="product-dossier__hero">
                        <figure className="product-dossier__radiograph">
                          <img src="/product/first-mix-cover-xray-expanded-v4.png" alt="横向扩展的打碟机、耳机与音乐波形 X 光影像" />
                          <figcaption><span>FIG. 01 / CONTROL UNIT</span><span>XR–FM–01</span></figcaption>
                        </figure>
                        <div className="product-dossier__story">
                          <span className="product-dossier__eyebrow">PROJECT 01</span>
                          <h2><span>FIRST</span><span><em>MIX.</em></span></h2>
                          <div className="product-dossier__tags" aria-label="项目属性"><span>INDIVIDUAL AI PRODUCT</span><span>WEB DJ LEARNING</span><span>00–07 COURSE</span></div>
                          <p className="product-dossier__zh">零经验用户的<br />打碟练习产品</p>
                          <p className="product-dossier__intro">从第一次按下按钮开始，<br />完成一段能亲耳听见的转场。</p>
                          <div className="product-dossier__signal"><i /><span>WEB-BASED DJ LEARNING SYSTEM</span><b>00 → 07</b></div>
                        </div>
                      </div>
                      <div className="product-dossier__overview">
                        <header className="product-dossier__overview-heading">
                          <span>01 / PROJECT OVERVIEW</span>
                          <h3>项目概览</h3>
                        </header>
                        <p className="product-dossier__overview-lead">FIRST MIX 面向想尝试打碟、但尚未准备购买设备的零经验用户。产品通过渐进课程和可操作的双 Deck 控台，让用户从第一次按下按钮开始，完成一段能亲耳听见的转场。</p>
                        <div className="product-dossier__overview-body">
                          <div className="product-dossier__manifest" aria-label="从用户起点到首次成功的产品路径">
                            <div><small>01 / USER START</small><strong>想尝试打碟<br />尚未准备购买设备</strong><span>用户起点</span></div>
                            <div><small>02 / LEARNING SYSTEM</small><strong>渐进课程<br />可操作双 Deck 控台</strong><span>产品方式</span></div>
                            <div><small>03 / FIRST SUCCESS</small><strong>完成一次<br />能亲耳听见的转场</strong><span>首次成功</span></div>
                          </div>
                          <aside className="product-dossier__credit">
                            <span>INDEPENDENT AI PRODUCT / 个人项目</span>
                            <p>这是我独立完成的个人 AI 产品项目：从行业与用户研究、竞品分析、产品定位和功能取舍，到课程、交互与视觉设计、前端及音频开发、AI 能力设计、测试、上线和推广，均由我负责。AI 用于辅助实现和加快迭代，产品判断与最终验收由我完成。</p>
                          </aside>
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="product-reader__chapter product-reader__chapter--diagnosis" id="first-mix-scan-2" aria-label="FIRST MIX 洞察与问题定义">
                    <div className="product-diagnosis">
                      <div className="product-diagnosis__rail"><span>XR / FM — 02</span><span>洞察与问题定义</span><span>SCAN 02 / 07</span></div>
                      <div className="product-diagnosis__canvas">
                        <header className="product-diagnosis__question">
                          <span>02 / 洞察与问题定义</span>
                          <h2><span>为什么迟迟</span><span>没有开始？</span></h2>
                          <p>研究问题：对打碟感兴趣的人，为什么迟迟没有开始第一次操作？</p>
                        </header>
                        <figure className="product-diagnosis__art">
                          <img src="/product/first-mix-insight-xray-butterflies-v1.png" alt="骨骼与三只蝴蝶交叠的艺术性 X 光影像" loading="lazy" />
                          <span className="product-diagnosis__slice product-diagnosis__slice--a" aria-hidden="true"><img src="/product/first-mix-insight-xray-butterflies-v1.png" alt="" /></span>
                          <span className="product-diagnosis__slice product-diagnosis__slice--b" aria-hidden="true"><img src="/product/first-mix-insight-xray-butterflies-v1.png" alt="" /></span>
                          <span className="product-diagnosis__slice product-diagnosis__slice--c" aria-hidden="true"><img src="/product/first-mix-insight-xray-butterflies-v1.png" alt="" /></span>
                        </figure>
                        <div className="product-diagnosis__evidence">
                        <div className="product-diagnosis__evidence-list">
                          <article><span>01 / 内容环境</span><p>行业观察显示，DJ、电子音乐受到短视频玩法带动。我对汽水音乐一份变装 BGM 主题歌单中的 50 首歌进行人工归类，其中至少 30 首带有 DJ、Remix、卡点或强节拍特征。这提示了内容创作场景，但不能证明创作者一定需要打碟工具。</p></article>
                          <article><span>02 / 用户阻碍</span><p>整理国内 30 条、海外 34 条公开表达后，出现最多的是“不知道从哪开始”（16 条）、学习负担（13 条）和设备门槛（12 条）。用户并非没有兴趣，而是在第一次操作前面临太多选择。</p></article>
                          <article><span>03 / 竞品机会</span><p>rekordbox、Serato DJ Lite、djay 和 DJ.Studio 各有入门支持，但首次实时练习仍涉及设备、音乐来源、完整界面或不同制作流程的选择。FIRST MIX 因此聚焦一个更短的起步路径：打开网页，使用预置音乐，按指引开始操作。</p></article>
                        </div>
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="product-reader__chapter product-reader__chapter--concept" id="first-mix-scan-3" aria-label="FIRST MIX 产品构思">
                    <div className="product-concept" style={{ '--concept-step': activeConceptStep, '--concept-scan-x': `${10 + activeConceptStep * 20}%`, '--concept-progress': 12.5 + activeConceptStep * 25 } as CSSProperties}>
                      <div className="product-concept__rail"><span>XR / FM — 03</span><span>PRODUCT CONCEPT</span><span>SCAN 03 / 07</span></div>
                      <div className="product-concept__canvas">
                        <header className="product-concept__copy">
                          <span>03 / 产品构思</span>
                          <h2>产品体验闭环</h2>
                          <p>产品把“完成一次转场”设为第一个成功节点，而非要求用户先学完 DJ 知识。学习体系分为基础路线和技巧课。基础路线从 00 课开始，逐步认识控件并完成转场；技巧课则在此基础上探索更多打碟玩法。课程中一次聚焦一个动作，自由练习时再开放完整打碟台。操作会改变实际声音，练习结果可以录制、回听并备注。</p>
                        </header>

                        <figure className="product-concept__interface">
                          <div className="product-concept__screen">
                            <svg className="product-concept__map-geometry" viewBox="0 0 1200 430" preserveAspectRatio="none" aria-hidden="true">
                              <path className="product-concept__map-base" d="M94 242H1106" />
                              <path className="product-concept__map-progress" pathLength="100" d="M94 242H1106" />
                              {[94, 347, 600, 853, 1106].map((cx) => <circle className="product-concept__map-node" cx={cx} cy="242" r="7" key={cx} />)}
                            </svg>
                            <i className="product-concept__scanline" aria-hidden="true" />
                            <ol className="product-concept__steps">
                              {[
                                ['ENTER', '进入 00 课', '只有一个明确入口'],
                                ['ACT', '操作真实控台', '当前只突出一个控件'],
                                ['HEAR', '听见转场', '状态与声音同时反馈'],
                                ['REVIEW', '录制与回看', '保留结果、添加备注'],
                                ['RETURN', '自由练习', '在同一套控件上继续'],
                              ].map(([code, title, detail], index) => (
                                <li className={`${index === activeConceptStep ? 'is-active' : ''} ${index < activeConceptStep ? 'is-passed' : ''}`} key={code}>
                                  <button type="button" aria-pressed={index === activeConceptStep} onMouseEnter={() => setActiveConceptStep(index)} onFocus={() => setActiveConceptStep(index)} onClick={() => setActiveConceptStep(index)}>
                                    <small>{String(index + 1).padStart(2, '0')} / {code}</small><strong>{title}</strong><span>{detail}</span>
                                  </button>
                                </li>
                              ))}
                            </ol>
                            <div className="product-concept__modes">
                              <span><b>课程模式</b><small>控制信息量，先完成当前动作。</small></span>
                              <span><b>自由模式</b><small>开放参数，把首次体验延伸为自主练习。</small></span>
                            </div>
                          </div>
                          <figcaption><span>图 2｜核心体验路径</span><span>MAP 02 / EXPERIENCE</span></figcaption>
                        </figure>
                      </div>
                    </div>
                  </section>
                  <section className="product-reader__chapter product-reader__chapter--ai" id="first-mix-scan-4" aria-label="FIRST MIX AI 能力与边界">
                    <div className="product-ai">
                      <div className="product-ai__rail"><span>XR / FM — 04</span><span>AI CAPABILITY &amp; BOUNDARY</span><span>SCAN 04 / 07</span></div>
                      <div className="product-ai__canvas">
                        <header className="product-ai__intro">
                          <span>04 / AI 能力与边界</span>
                          <h2>AI 只负责解释</h2>
                          <div className="product-ai__intro-copy">
                            <p>AI 分别在练习中和录制后介入，两者都属于<strong>在真实操作数据之上的解释层</strong>。播放、课程进度和基础判定由产品本身完成。</p>
                          </div>
                        </header>
                        <div className="product-ai__matrix">
                          <div className="product-ai__matrix-labels" aria-hidden="true"><span>DETERMINISTIC INPUT</span><span>AI EXPLANATION</span><span>HARD BOUNDARY</span></div>
                          <table>
                            <thead><tr><th>介入时点</th><th>可用依据</th><th>AI 提供什么</th><th>不交给 AI 的事</th></tr></thead>
                            <tbody>
                              <tr>
                                <th scope="row">练习中<small>IN PRACTICE</small></th>
                                <td data-label="可用依据">播放状态、两首歌的 BPM 差、LOW、音量、推子位置及本地评分</td>
                                <td data-label="AI 提供什么">提示当前最值得调整的一个动作；展示节拍、交接、清晰度评分</td>
                                <td data-label="不交给 AI 的事">替用户操作，或声称自己听过音频</td>
                              </tr>
                              <tr>
                                <th scope="row">录制后<small>AFTER RECORDING</small></th>
                                <td data-label="可用依据">用户自己的两首音乐、作品的节奏与能量指标，以及操作记录</td>
                                <td data-label="AI 提供什么">生成风格描述、亮点、需注意的问题及下一步练习建议</td>
                                <td data-label="不交给 AI 的事">分析内置练习曲，或在数据不足时编造结论</td>
                              </tr>
                            </tbody>
                          </table>
                          <p className="product-ai__boundary"><span>CORE RULE / 04</span>播放、课程进度、完成条件和技术分由程序判断。模型不可用时，核心练习仍可继续。</p>
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="product-live-demo" id="first-mix-scan-5" aria-label="FIRST MIX 手机端真机体验">
                    <div className="product-live-demo__rail"><span>XR / FM — 05</span><span>LIVE PROTOTYPE / MOBILE</span><span>SCAN 05 / 07</span></div>
                    <div className="product-live-demo__copy">
                      <span>05 / 点击真机体验</span>
                      <h2>点击真机体验</h2>
                      <p>作品集阐述页嵌入可实际点击的网页版，而不是用演示视频代替产品。访客可以从学习页进入课程、操作控件并听到声音变化；需要更大画面时，可打开完整产品，也可以扫码在手机上体验。</p>
                      <a href={FIRST_MIX_DEMO_URL} target="_blank" rel="noreferrer">打开完整产品 ↗</a>
                    </div>
                    <div className="product-live-demo__phone" id="first-mix-live-phone" aria-label="手机体验窗口">
                      <i className="product-live-demo__speaker" aria-hidden="true" />
                      <iframe title="FIRST MIX 手机端体验" src={FIRST_MIX_DEMO_URL} loading="lazy" allow="autoplay; microphone" />
                    </div>
                    <div className="product-live-demo__qr">
                      <canvas ref={demoQrRef} aria-label="FIRST MIX 手机体验二维码" />
                      <span>SCAN TO ENTER</span>
                      <small>手机相机扫码</small>
                    </div>
                  </section>
                  <section className="product-reader__chapter" id="first-mix-scan-6">
                    <figure className="product-reader__chapter-art product-reader__chapter-art--iteration" aria-hidden="true"><img src="/product/first-mix-iteration-hand-xray-v2.png" alt="" loading="lazy" /></figure>
                    <header><span>SCAN 06 / ITERATION</span><h2>开发与迭代</h2><i>BEFORE / AFTER</i></header>
                    <div className="product-reader__lead"><p>开发重点不是不断增加功能，而是检查用户能否顺利完成下一步。</p></div>
                    <div className="product-reader__iterations">
                      <article><b>课程动线</b><span>停留在说明弹窗</span><i>→</i><strong>进入课程后直接指向当前控件</strong></article>
                      <article><b>控台层级</b><span>同时展示大量控件</span><i>→</i><strong>课程单点高亮，自由练习展示完整参数</strong></article>
                      <article><b>AI 反馈</b><span>可能过早打断操作</span><i>→</i><strong>程序先确认事实，AI 再解释原因与建议</strong></article>
                      <article><b>设备适配</b><span>气泡溢出、短屏裁切、高亮缺边</span><i>→</i><strong>调整定位、滚动与高亮范围并继续真机复测</strong></article>
                    </div>
                  </section>
                  <section className="product-reader__chapter product-reader__chapter--archive" id="first-mix-scan-7">
                    <figure className="product-reader__chapter-art product-reader__chapter-art--archive" aria-hidden="true"><img src="/product/first-mix-archive-botanical-xray-v2.png" alt="" loading="lazy" /></figure>
                    <header><span>SCAN 07 / RESULT</span><h2>渠道适配与上线反馈</h2><i>ARCHIVE RESULT</i></header>
                    <div className="product-reader__lead"><p>小红书小工具采用离线环境。我优先保留课程、内置音乐和操作反馈；在线 AI 教练、「我的」AI 分析与本地导入音乐暂不放入小工具版。完整版网页仍保留这些能力。</p></div>
                    <div className="product-reader__channels"><a href="https://www.xiaohongshu.com/explore/6ad0517b000000001a0296c2" target="_blank" rel="noreferrer"><span>POST 01</span><b>项目的灵感来源</b><i>小红书 App 查看 ↗</i></a><a href="https://www.xiaohongshu.com/explore/6ad1e097000000001a02bd1a" target="_blank" rel="noreferrer"><span>POST 02</span><b>产品玩法展示</b><i>小红书 App 查看 ↗</i></a></div>
                    <p className="product-reader__channel-note">小红书限制部分笔记在电脑端直接浏览；点击后可使用小红书 App 扫码查看原帖。</p>
                    <div className="product-reader__metrics"><span>封面点击率<em>玩法篇 17.70%<br />灵感篇 16.90%</em></span><span>产品使用人数<em>450＋人</em></span><span>统计周期<em>2026.10.15–10.17</em></span></div>
                    <p className="product-reader__feedback-note">10 月 15 日至 17 日，产品已有 450＋人使用；两篇推广内容的封面点击率分别为 16.90% 和 17.70%。</p>
                    <div className="product-reader__archive-actions"><a href={FIRST_MIX_DEMO_URL} target="_blank" rel="noreferrer">重新体验产品 ↗</a><button type="button" onClick={returnToScanner}>返回扫描台 ↑</button></div>
                  </section>
                </div>
              </div>
            </main>
          )}
        </div>
        <StudioChrome label={initialReading ? 'Back to Selected Works' : 'Back to Newsstand'} onBack={closeProject} tone="dark" />
      </div>
    </div>
  );
}
