/**
 * 旋转木马 3D 场景 —— 移植自 carousel-lamp 的 `lib/carousel-scene.ts`。
 *
 * 原作者：咕噜蛋Daria · https://github.com/Daria1216/carousel-lamp
 * 许可：Carousel Lamp 非商业使用许可 1.0（见项目根目录 LICENSES/carousel-lamp.md）
 *
 * 相对原版做的改动：
 * 1. 相框数量/排布由 `pattern` 决定（一单一双 = 6 个槽位），不再是写死的 16；
 * 2. 去掉"长按拖拽交换相片"，改为**点击任意相框（含空槽）**→ onPick；
 * 3. 相框封面支持"上传封面图"或"用项目标题现画一张卡"；
 * 4. 贴图路径改为站内 `./carousel/*.png`（跟随 vite `base: './'`）；
 * 5. 背景保持 alpha 透明，由外层 CSS 提供磨砂质感。
 */
import * as THREE from 'three';
import { readSavedView, saveView, type SavedView } from './view-storage';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getRoomEnv } from '../room-env';
import { createCarouselMotion } from './carousel-motion';
import { createMemoryProjections } from './memory-projections';
import { createHorse, addGarden, addPole } from './carousel-ornaments';

/**
 * ⚠️ HMR 陷阱：three.js 场景只在组件挂载时 `createCarousel()` 一次，
 * 这个模块热更新后旧场景实例会继续跑 —— 于是出现"JSX 变了但 3D 画面没变"
 * （比如灯绳、星屑死活不出现）。直接整页刷新，别在这上面浪费时间。
 */
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

export type HangSlot = 'single' | 'double';

export type SlotFace = {
  /** 档案编号，画在封面底部，如 PLAN_01 */
  code: string;
  /** 项目标题，画在占位卡上 */
  title: string;
  /** 封面图 URL（来自种子）；null = 没有封面图 */
  cover: string | null;
  /** 用户上传的 PDF Blob：场景会渲染 PDF 首页作为封面（"封面就用 PDF 首页"） */
  pdf?: Blob | null;
};

export type CarouselOptions = {
  /** 每个吊点挂几个相框：single = 1，double = 2（上下叠挂） */
  pattern: HangSlot[];
  /** 每个相框的封面信息，长度必须等于相框总数 */
  faces: SlotFace[];
  onPick: (index: number) => void;
  /** 放大看图时双击同一张（或提交模式下单击）—— 打开项目详情面板 */
  onDetail?: (index: number) => void;
  /** 点中了 3D 空白处（非相框）—— 可用于"点空白回到全景" */
  onMissPick?: () => void;
  /** 灯绳被拉动、夜灯状态翻转时回调（顶部按钮已删，留给以后做状态提示） */
  onNight?: (on: boolean) => void;
  onError?: (message: string) => void;
  onViewSave?: (saved: boolean) => void;
};

import { prefersReduced } from '@/lib/motion-pref';
export type CarouselAPI = {
  ready: Promise<void>;
  focus: (index: number) => void;
  reset: () => void;
  rotate: (on: boolean) => void;
  light: (on: boolean) => void;
  selectMode: (on: boolean) => void;
  /** 换掉某个相框的封面（src 为 null 时画占位卡） */
  setFace: (index: number, face: SlotFace) => Promise<void>;
  /** 暂停/恢复渲染循环（详情页整屏盖住木马时省主线程与 GPU，2026-09-15） */
  setPaused: (paused: boolean) => void;
  dispose: () => void;
};

/** 贴图按 vite 的 base 走相对路径，部署到子目录也不会 404。 */
const asset = (name: string) => `${import.meta.env.BASE_URL}carousel/${name}`;

/**
 * 木马相框只需 ~440–640px 宽，封面原图 2880px 太浪费带宽、拖慢相框上图。
 * 把任意 works/*.jpg（含已带 -w1600 的）换成 -w640 变体；blob: 等用户上传地址保持原样。
 */
function toFrameSrc(src: string): string {
  return src.replace(/(.*works\/[^?]+?)(-w\d+)?\.jpg(\?.*)?/i, '$1-w640.jpg$3');
}

function loadCover(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('封面图无法解码，请换成 JPG / PNG。'));
    image.src = src;
  });
}

/**
 * 构图（2026-09-14）：整台木马挪到页面左侧、略微缩小，给右侧留出空间。
 * 用「离轴投影」而不是改相机初始机位 —— localStorage 恢复的历史视角、
 * 用户拖拽后的任意机位都同样生效，也不用作废旧的视角存档。
 */
const VIEW_SHIFT_X = 0.2; // 画面内容左移画布宽度的 20%：模型中轴从屏幕 50% → 30%
const VIEW_SHRINK = 1.1;  // 视角张角放大 10% ≈ 模型观感缩小约 9%

/**
 * 常态风 —— 「来阵风」按钮已移除，风一直在吹。觉得风太大/太小就改这几个数。
 * ⚠️ WIND_FREQ 千万别往上调：悬挂链条是阻尼弹簧，驱动频率一旦超过它的固有频率
 * （约 2.6~3.2 rad/s ≈ 0.45Hz），摆幅会被弹簧滤掉，看起来又变成"没风"。
 */
/* 2026-09-16 用户点「吹风调小」：四个幅度常量整体砍到原来的 ~45%，
   相框不再被吹得满场晃，只剩"有一点空气感"的轻微摆动。
   注意只动幅度、不动 WIND_FREQ —— 频率一过 2.6 rad/s 弹簧就把摆幅滤没了。 */
const WIND_BASE = 0.25;  // 常态风力（0~1，1 ≈ 原来手动点一次阵风的强度）
const WIND_GUST = 0.20;  // 风力在这个幅度内缓慢起伏，像一阵阵吹，而不是死板的匀速摆
const WIND_FREQ = 2.0;   // 链条摆动角频率 rad/s（约 0.32Hz，弹簧跟得上）
const WIND_SWING = 0.10; // 满风时链条被吹歪的幅度 rad（约 5.7°，经弹簧放大更明显）
const WIND_SPIN = 0.06;  // 风推着转台来回滚摆的幅度 rad（有界，不改变平均转速）

export function createCarousel(
  el: HTMLDivElement,
  options: CarouselOptions,
): CarouselAPI {
  const { pattern, faces: slotFaces, onPick, onDetail, onMissPick, onNight, onError = () => {}, onViewSave = () => {} } = options;
  const SLOT_COUNT = slotFaces.length;

  const savedView = readSavedView();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.dataset.carouselFrames = String(SLOT_COUNT);
  renderer.domElement.dataset.carouselPivots = String(pattern.length);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 70);
  const home = new THREE.Vector3(5.95, 5.55, 10.8),
    homeTarget = new THREE.Vector3(0, 3.0, 0);
  camera.position.copy(home);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(homeTarget);
  if (savedView) {
    camera.position.fromArray(savedView.position);
    controls.target.fromArray(savedView.target);
    controls.update();
  }
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 20;
  controls.minPolarAngle = Math.PI * 0.22;
  controls.maxPolarAngle = Math.PI * 0.445;
  // 环境贴图 —— PMREM 按 renderer 缓存（lib/room-env），三个 3D 场景共用一份 RoomEnvironment 代码
  scene.environment = getRoomEnv(renderer);
  const hemi = new THREE.HemisphereLight('#eef3ff', '#939dad', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe0ae', 1.5);
  sun.position.set(-6, 7.5, 4);
  sun.target.position.set(0, 3, 0);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 8, bottom: -5 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 2;
  scene.add(sun);
  const blue = new THREE.DirectionalLight('#a7c3ef', 0.55);
  blue.position.set(4, 3, -4);
  scene.add(blue);
  // Low side-window light reaches the horses below the overhanging canopy.
  const daylight = new THREE.SpotLight('#ffdfad', 0, 24, 0.55, 0.8, 2);
  daylight.position.set(-5.5, 5.8, 5.5);
  daylight.target.position.set(0, 2.1, 0);
  daylight.castShadow = true;
  daylight.shadow.mapSize.set(1024, 1024);
  daylight.shadow.bias = -0.0002;
  daylight.shadow.normalBias = 0.015;
  scene.add(daylight, daylight.target);
  const daylightRim = new THREE.DirectionalLight('#fff1d6', 0);
  daylightRim.position.set(-4, 5, -5);
  daylightRim.target.position.set(0, 3, 0);
  scene.add(daylightRim, daylightRim.target);
  const bulbs: THREE.PointLight[] = [],
    spots: THREE.SpotLight[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3 + 0.4,
      x = Math.sin(angle) * 0.75,
      z = Math.cos(angle) * 0.75;
    const light = new THREE.PointLight('#ffbb68', 0, 8, 2);
    light.position.set(x, 5.26, z);
    scene.add(light);
    bulbs.push(light);
    const beam = new THREE.SpotLight('#ffc17a', 0, 7, 0.56, 0.92, 1.5);
    beam.position.set(x, 5.22, z);
    beam.target.position.set(x * 1.35, 0.75, z * 1.35);
    beam.castShadow = i === 0;
    beam.shadow.mapSize.set(1024, 1024);
    beam.shadow.bias = -0.001;
    scene.add(beam, beam.target);
    spots.push(beam);
  }
  const root = new THREE.Group();
  scene.add(root);
  const textures = new Set<THREE.Texture>();
  const material = (color: string, roughness = 0.65) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.03 });
  const cream = material('#f2e7c9'),
    red = material('#b35142'),
    sky = material('#648dae'),
    green = material('#79914f'),
    yellow = material('#d3a846');
  const gold = new THREE.MeshStandardMaterial({
    color: '#bc9446',
    roughness: 0.34,
    metalness: 0.68,
  });
  const trimColors = [red, sky, green, yellow];
  function mesh(
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    parent: THREE.Object3D = root,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function ring(
    radius: number,
    y: number,
    tube = 0.025,
    mat: THREE.Material = gold,
  ) {
    const m = mesh(
      new THREE.TorusGeometry(radius, tube, 8, 96),
      mat,
      root,
      0,
      y,
    );
    m.rotation.x = Math.PI / 2;
    return m;
  }
  const loader = new THREE.TextureLoader();
  let alive = true,
    raf = 0,
    active = -1,
    selecting = false,
    night = savedView?.night ? 1 : 0,
    nightTarget = savedView?.night ? 1 : 0,
    rotating = savedView?.spinning ?? false,
    transition = false;
  function texture(path: string) {
    const t = loader.load(
      path,
      () => {},
      undefined,
      () => {
        if (alive) onError('有一处装饰暂时没加载出来，请刷新重试。');
      },
    );
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures.add(t);
    return t;
  }
  const painted = texture(asset('carousel-panels.png')),
    columnPaint = texture(asset('carousel-column.png')),
    basePaint = texture(asset('carousel-base.png'));
  function panels(
    repeat: number,
    source: THREE.Texture = painted,
    offset = 0,
    height = 1,
  ) {
    const t = source.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(repeat, height);
    t.offset.y = offset;
    textures.add(t);
    return new THREE.MeshStandardMaterial({
      map: t,
      color: '#ffffff',
      roughness: 0.63,
      metalness: 0.035,
    });
  }
  const stageMetal = new THREE.MeshStandardMaterial({
    color: '#b68a26',
    roughness: 0.34,
    metalness: 0.72,
  });
  // Solid, tiered architecture remains real geometry so the whole lamp can be orbited.
  mesh(new THREE.CylinderGeometry(1.42, 1.36, 0.16, 96), sky, root, 0, 0.12);
  mesh(
    new THREE.CylinderGeometry(1.43, 1.43, 0.38, 96),
    panels(2, basePaint, 0, 0.56),
    root,
    0,
    0.39,
  );
  mesh(
    new THREE.CylinderGeometry(1.5, 1.46, 0.1, 96),
    panels(2, basePaint, 0.56, 0.44),
    root,
    0,
    0.63,
  );
  mesh(
    new THREE.CylinderGeometry(1.4, 1.46, 0.07, 96),
    stageMetal,
    root,
    0,
    0.71,
  );
  ring(1.43, 0.2, 0.025);
  ring(1.44, 0.58, 0.025);
  ring(1.47, 0.7, 0.022);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const foot = mesh(
      new THREE.SphereGeometry(0.13, 16, 12),
      sky,
      root,
      Math.sin(a) * 1.08,
      0.045,
      Math.cos(a) * 1.08,
    );
    foot.scale.set(1, 0.48, 1);
  }
  const sections = [
    { y: 1.17, h: 0.86, r1: 0.34, r2: 0.48 },
    { y: 2.1, h: 1, r1: 0.28, r2: 0.34 },
    { y: 3.14, h: 1, r1: 0.32, r2: 0.28 },
    { y: 4.15, h: 1, r1: 0.44, r2: 0.32 },
  ];
  sections.forEach((s, i) => {
    // Reserve the red pointed-arch band for the capital above these sections.
    const sectionPaint = panels(
      1,
      columnPaint,
      [0, 0.23, 0.48, 0.23][i],
      [0.23, 0.25, 0.255, 0.25][i],
    );
    if (i === 3) sectionPaint.color.set('#a9cfff');
    mesh(
      new THREE.CylinderGeometry(s.r1, s.r2, s.h, 48),
      sectionPaint,
      root,
      0,
      s.y,
    );
    ring(s.r2 + 0.02, s.y - s.h / 2, 0.035, trimColors[i]);
    ring(s.r1 + 0.025, s.y + s.h / 2, 0.027, gold);
  });
  // The capital continues into the roof. Light comes from a concealed ring, not a loose white orb.
  mesh(
    new THREE.CylinderGeometry(0.53, 0.44, 0.52, 64),
    panels(1, columnPaint, 0.735, 0.265),
    root,
    0,
    4.91,
  );
  ring(0.53, 5.17, 0.033, gold);
  mesh(new THREE.CylinderGeometry(0.24, 0.38, 0.92, 48), cream, root, 0, 5.61);
  mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 48), gold, root, 0, 6.1);
  const concealedLight = new THREE.MeshStandardMaterial({
    color: '#e0bd75',
    emissive: '#ffae4b',
    emissiveIntensity: 0,
    roughness: 0.45,
  });
  const lightRing = ring(0.75, 5.28, 0.042, concealedLight);
  lightRing.castShadow = false;
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI * 2) / 6,
      from = new THREE.Vector3(0, 5.98, 0),
      to = new THREE.Vector3(
        Math.sin(angle) * 1.83,
        5.4,
        Math.cos(angle) * 1.83,
      ),
      delta = to.clone().sub(from);
    const rib = mesh(
      new THREE.CylinderGeometry(0.012, 0.012, delta.length(), 8),
      gold,
    );
    rib.position.copy(from).add(to).multiplyScalar(0.5);
    rib.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    );
  }

  // A shallow striped canopy and scalloped fascia, with warm luminous lining.
  const roofProfile = [
    new THREE.Vector2(0.08, 6.22),
    new THREE.Vector2(0.22, 6.1),
    new THREE.Vector2(0.55, 5.93),
    new THREE.Vector2(1.04, 5.68),
    new THREE.Vector2(1.58, 5.46),
    new THREE.Vector2(2.13, 5.33),
  ];
  const roofMaterials = [
    material('#678fae'),
    material('#eee0bd'),
    material('#829ab1'),
    material('#eddfbd'),
  ];
  for (let i = 0; i < 16; i++) {
    const m = mesh(
      new THREE.LatheGeometry(
        roofProfile,
        10,
        (i * Math.PI) / 8,
        Math.PI / 8 + 0.001,
      ),
      roofMaterials[i % 4],
    );
    m.material.side = THREE.DoubleSide;
  }
  const shadeMat = new THREE.MeshStandardMaterial({
    color: '#fff0ca',
    emissive: '#ffc276',
    emissiveIntensity: 0.15,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const lining = mesh(
    new THREE.LatheGeometry(
      roofProfile.map((p) => new THREE.Vector2(p.x * 0.985, p.y - 0.028)),
      96,
    ),
    shadeMat,
    root,
  );
  lining.castShadow = false;
  const fascia = new THREE.CylinderGeometry(2.15, 2.15, 0.62, 224, 1, true);
  const positions = fascia.attributes.position;
  for (let i = 0; i <= 224; i++) {
    const fraction = ((i / 224) * 14) % 1;
    positions.setY(i, 0.31 + Math.sin(fraction * Math.PI) * 0.15);
  }
  positions.needsUpdate = true;
  fascia.computeVertexNormals();
  // Crop to the flower arches, excluding the unrelated horizontal borders.
  const fasciaMaterial = panels(2, painted, 0.14, 0.68);
  fasciaMaterial.side = THREE.DoubleSide;
  mesh(fascia, fasciaMaterial, root, 0, 5.3);
  ring(2.15, 4.99, 0.035, red);
  for (let i = 0; i < 14; i++) {
    const a = (i * Math.PI * 2) / 14;
    mesh(
      new THREE.SphereGeometry(0.045, 12, 8),
      trimColors[i % 4],
      root,
      Math.sin(a) * 2.15,
      5.49,
      Math.cos(a) * 2.15,
    );
  }
  mesh(new THREE.SphereGeometry(0.13, 20, 16), red, root, 0, 6.33);
  ring(0.18, 6.18, 0.03, gold);
  // Intentionally no floor plane, contact-shadow decal, or ground glow.
  function glowTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d')!;
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,213,149,.7)');
    g.addColorStop(0.4, 'rgba(255,186,110,.2)');
    g.addColorStop(1, 'rgba(255,178,105,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(cv);
    textures.add(t);
    return t;
  }
  const glowMap = glowTexture();
  const haloMat = new THREE.SpriteMaterial({
    map: glowMap,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.position.set(0, 5.26, 0);
  halo.scale.set(2.5, 1.3, 1);
  root.add(halo);
  // Local halation along the lit rim keeps the rest of the object crisp.
  const rimGlowMaterial = new THREE.SpriteMaterial({
    map: glowMap, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI * 2 / 16;
    const glint = new THREE.Sprite(rimGlowMaterial);
    glint.position.set(Math.sin(angle) * 2.1, 5.1, Math.cos(angle) * 2.1);
    glint.scale.set(0.65, 0.3, 1);
    root.add(glint);
  }
  // Soft shafts are real transparent volumes in the scene, with view-dependent edges.
  const volumeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      strength: { value: 0 },
      tint: { value: new THREE.Color('#ffd098') },
    },
    vertexShader: `varying vec2 beamUV;varying vec3 viewNormal;varying vec3 viewPosition;
      void main(){beamUV=uv;viewNormal=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.0);viewPosition=-p.xyz;gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform float strength;uniform vec3 tint;varying vec2 beamUV;varying vec3 viewNormal;varying vec3 viewPosition;
      void main(){float facing=pow(abs(dot(normalize(viewNormal),normalize(viewPosition))),1.4);
      float ends=smoothstep(0.0,0.26,beamUV.y)*(1.0-smoothstep(0.85,1.0,beamUV.y));
      float taper=mix(0.12,0.75,beamUV.y);gl_FragColor=vec4(tint,strength*ends*taper*facing);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3 + 0.4;
    const volume = mesh(
      new THREE.CylinderGeometry(0.18, 0.88, 3.7, 48, 1, true),
      volumeMaterial,
      root,
      Math.sin(angle) * 0.86,
      3.3,
      Math.cos(angle) * 0.86,
    );
    volume.castShadow = false;
    volume.receiveShadow = false;
    volume.renderOrder = 2;
  }
  const horses: THREE.Group[] = [];
  const rotatingStage = new THREE.Group();
  rotatingStage.name = 'rotating-carousel-assembly';
  root.add(rotatingStage);
  const motion = createCarouselMotion();
  motion.restore(savedView?.angle ?? 0);
  motion.play(rotating);
  ring(0.96, 5.7, 0.014, gold);
  ring(0.96, 0.765, 0.012, gold);
  for (let i = 0; i < 3; i++) {
    const angle = 0.3 + (i * Math.PI * 2) / 3,
      x = Math.sin(angle) * 0.96,
      z = Math.cos(angle) * 0.96;
    const horse = createHorse(i);
    horse.position.set(x, 1.4, z);
    horse.rotation.y = angle;
    horse.scale.setScalar(1.05);
    rotatingStage.add(horse);
    horses.push(horse);
    addPole(rotatingStage, x, z, 5.7);
  }
  addGarden(root);
  const pivots: THREE.Group[] = [],
    faces: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>[] = [],
    hits: THREE.Object3D[] = [],
    revisions = Array(SLOT_COUNT).fill(0);
  const neutral = material('#fff9e8');
  const faceFrames: THREE.Mesh[] = [];

  const FONT = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';

  function wrap(c: CanvasRenderingContext2D, text: string, maxWidth: number) {
    const lines: string[] = [];
    let line = '';
    for (const ch of text) {
      if (c.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    if (line) lines.push(line);
    return lines;
  }

  function labelFrame(c: CanvasRenderingContext2D, code: string) {
    c.fillStyle = '#fff9ed';
    c.fillRect(0, 560, 512, 80);
    c.fillStyle = '#856d5a';
    c.font = `22px ${FONT}`;
    c.textAlign = 'center';
    c.fillText(`${code}  /  策划案`, 256, 601);
  }

  /** 没有封面图时现画一张"待提交 / 标题卡"，比灰底更能传达这是个项目位。 */
  function placeholderCard(
    c: CanvasRenderingContext2D,
    index: number,
    title: string,
  ) {
    c.fillStyle = '#efe6d6';
    c.fillRect(36, 30, 440, 520);
    c.save();
    c.strokeStyle = '#c6b79c';
    c.lineWidth = 3;
    c.setLineDash([12, 9]);
    c.strokeRect(60, 56, 392, 468);
    c.restore();

    c.textAlign = 'center';
    c.fillStyle = '#b3a289';
    c.font = `bold 92px ${FONT}`;
    c.fillText(String(index + 1).padStart(2, '0'), 256, 236);

    c.fillStyle = '#8d7c66';
    c.font = `34px ${FONT}`;
    const lines = wrap(c, title || '待提交项目', 350).slice(0, 3);
    lines.forEach((line, i) => c.fillText(line, 256, 320 + i * 46));

    c.fillStyle = '#a8977f';
    c.font = `22px ${FONT}`;
    c.fillText('双击打开详情', 256, 500);
  }

  function frameTexture(
    index: number,
    code: string,
    title: string,
    image?: HTMLImageElement,
  ) {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 640;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#fff9ed';
    c.fillRect(0, 0, 512, 640);
    if (image) {
      /* 相框内窗是竖的（440×520 ≈ 0.85），而封面素材清一色横构图
         （2880×2160 / ×1994 / ×1620，比例 1.33~1.78）。三轮改法：
           · cover  → 两侧裁掉 16:9 只剩 47.6% 宽（用户：「封面显示不全」）
           · contain + 模糊铺底 → 不裁了但边缘虚化（用户：「不要虚化边缘的」）
           · contain + 纸色垫底 → 不裁也不虚化但上下大段纸色（用户：「要完整且铺满」）
         这次的做法：把照片画在一个**与图片同比例**的窗口里，居中放进内窗。
         照片边缘正好贴窗口（完整且铺满），窗口剩下的纸色是相框的"垫纸"，
         像裱过的相册页，不是图片的留白。 */
      const AREA_X = 36,
        AREA_Y = 30,
        AREA_W = 440,
        AREA_H = 520;
      const ar = image.width / image.height;
      let winW, winH;
      if (ar >= AREA_W / AREA_H) {
        winW = AREA_W;
        winH = AREA_W / ar;
      } else {
        winH = AREA_H;
        winW = AREA_H * ar;
      }
      const winX = AREA_X + (AREA_W - winW) / 2;
      const winY = AREA_Y + (AREA_H - winH) / 2;
      c.drawImage(image, winX, winY, winW, winH);
      /* 回归脚本（verify-covers.mjs）要断言"窗口与图片同比例、且没溢出内窗"。
         相框纹理是画在 canvas 上的，外面读不到，所以把每次的窗口尺寸挂出来 ——
         跟 __wkpLenis / __wkpFlip / __wkpPar 一个约定，只在 dev 构建存在。 */
      if (import.meta.env.DEV) {
        const dbg = (window as unknown as { __wkpFrameFits?: Record<number, number[]> });
        (dbg.__wkpFrameFits ??= {})[index] = [image.width, image.height, winW, winH];
      }
    } else {
      placeholderCard(c, index, title);
    }
    labelFrame(c, code);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures.add(t);
    return t;
  }
  function line(parent: THREE.Object3D, length: number) {
    mesh(
      new THREE.CylinderGeometry(0.008, 0.008, length, 6),
      gold,
      parent,
      0,
      -length / 2,
    );
  }
  function gem(parent: THREE.Object3D, y: number, index: number, size = 0.046) {
    const m = new THREE.MeshPhysicalMaterial({
      color: ['#b5cbdf', '#e6b5ae', '#e5d3a3', '#b7caab'][index % 4],
      roughness: 0.16,
      metalness: 0.1,
      transmission: 0.25,
      transparent: true,
      opacity: 0.9,
    });
    mesh(new THREE.IcosahedronGeometry(size, 1), m, parent, 0, y);
  }
  const charmShape = new THREE.Shape();
  for (let point = 0; point < 10; point++) {
    const angle = (point * Math.PI) / 5 + Math.PI / 2,
      radius = point % 2 ? 0.045 : 0.1;
    const x = Math.cos(angle) * radius,
      y = Math.sin(angle) * radius;
    if (point === 0) charmShape.moveTo(x, y);
    else charmShape.lineTo(x, y);
  }
  charmShape.closePath();
  const charmGeometry = new THREE.ExtrudeGeometry(charmShape, {
    depth: 0.018,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.006,
    bevelThickness: 0.006,
  });
  const charmMaterial = new THREE.MeshPhysicalMaterial({
    color: '#e8d7b4',
    roughness: 0.2,
    metalness: 0.25,
    iridescence: 1,
    clearcoat: 1,
    transparent: true,
    opacity: 0.88,
  });

  // 吊点数量 = pattern.length，每个吊点挂 1 或 2 个相框（原版是写死的 12 个吊点 / 16 张）。
  const PIVOTS = pattern.length;
  for (let i = 0; i < PIVOTS; i++) {
    const a = (i * Math.PI * 2) / PIVOTS + 0.15,
      p = new THREE.Group();
    p.position.set(Math.sin(a) * 2.04, 5.12, Math.cos(a) * 2.04);
    p.rotation.y = a;
    p.userData.phase = i * 1.37;
    p.userData.sway = { x: 0, z: 0, vx: 0, vz: 0 };
    rotatingStage.add(p);
    pivots.push(p);
    const len = 0.8 + (i % 4) * 0.31,
      double = pattern[i] === 'double',
      total = len + 0.87 + (double ? 1.1 : 0);
    line(p, total);
    gem(p, -0.24, i);
    gem(p, -0.52, i + 1, 0.032);
    for (let j = 0; j < (double ? 2 : 1); j++) {
      const index = faces.length,
        group = new THREE.Group();
      group.position.y = -len - 0.42 - j * 1.1;
      group.rotation.z = Math.sin(i * 4.1 + j) * 0.07;
      p.add(group);
      const frame = mesh(
        new THREE.BoxGeometry(0.63, 0.8, 0.027),
        neutral.clone(),
        group,
      );
      frame.userData.photo = index;
      hits.push(frame);
      faceFrames.push(frame);
      const info = slotFaces[index];
      const face = mesh(
        new THREE.PlaneGeometry(0.62, 0.79),
        new THREE.MeshStandardMaterial({
          map: frameTexture(index, info?.code ?? `PLAN_${index + 1}`, info?.title ?? ''),
          roughness: 0.83,
          side: THREE.DoubleSide,
        }),
        group,
        0,
        0,
        0.017,
      ) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
      face.userData.photo = index;
      faces.push(face);
      hits.push(face);
      const back = mesh(
        new THREE.PlaneGeometry(0.62, 0.79),
        face.material,
        group,
        0,
        0,
        -0.017,
      );
      back.rotation.y = Math.PI;
      back.userData.photo = index;
      hits.push(back);
      mesh(
        new THREE.BoxGeometry(0.048, 0.14, 0.07),
        trimColors[index % 4],
        group,
        0,
        0.42,
        0.04,
      );
    }
    if (i % 3 === 1) mesh(charmGeometry, charmMaterial, p, 0, -total - 0.12);
    gem(p, -total, i + 2, 0.075);
    gem(p, -total + 0.18, i + 1, 0.035);
    if (i % 3 === 0) {
      const bell = mesh(
        new THREE.ConeGeometry(0.07, 0.1, 16, 1, true),
        gold,
        p,
        0,
        -total - 0.14,
      );
      bell.rotation.z = Math.PI;
    }
  }
  /* ——————————————————————————————————————————————————————————————
     夜灯拉绳 —— 从屋檐左缘垂下来的一根绳，末端一颗木珠。
     点一下（或按住往下拽）就把夜灯打开 / 关掉，松手后绳子自己弹回去荡两下。

     位置：方位角 -0.85 rad ≈ 画面左侧（相机初值在 +X/+Z 方向），半径 2.16
     刚好在顶棚最大半径 2.13 之外 —— 视线全程都在木马拉开的圆柱外面走，
     所以既不会被顶棚挡，也不会被转到前面的相框（最外 2.064）遮住，永远点得到。
     顶端 5.29 贴着顶棚外缘（2.13, 5.33），看起来就是"从灯罩边垂下来"。
     —————————————————————————————————————————————————————————————— */
  const CORD_ANGLE = -0.85;
  const CORD_R = 2.16;
  const CORD_TOP = 5.29;
  const CORD_LEN = 0.88;
  const CORD_GRAB = 0.18;
  const CORD_MAX_PULL = 0.34; // 手最多能拽下去多少（米）
  const CORD_TRIGGER = 0.1;   // 拽过这个行程，松手就换灯
  const cordRoot = new THREE.Group();
  cordRoot.position.set(
    Math.sin(CORD_ANGLE) * CORD_R,
    CORD_TOP,
    Math.cos(CORD_ANGLE) * CORD_R,
  );
  cordRoot.rotation.y = CORD_ANGLE;
  root.add(cordRoot);
  // 柱壁上的小铜件，绳从它中间穿出来
  mesh(
    new THREE.CylinderGeometry(0.028, 0.038, 0.055, 14),
    gold,
    cordRoot,
    0,
    -0.024,
    0.012,
  );
  const cordMat = new THREE.MeshStandardMaterial({
    color: '#f4ead4',
    roughness: 0.9,
    metalness: 0.04,
    emissive: '#ffd79a',
    emissiveIntensity: 0.12,
  });
  const cord = mesh(
    new THREE.CylinderGeometry(0.018, 0.018, CORD_LEN, 8),
    cordMat,
    cordRoot,
    0,
    -CORD_LEN / 2,
  );
  cord.castShadow = false;
  const knobMat = new THREE.MeshStandardMaterial({
    color: '#c9853c',
    roughness: 0.42,
    metalness: 0.18,
    emissive: '#ffbd63',
    emissiveIntensity: 0.35,
  });
  const knob = mesh(
    new THREE.SphereGeometry(0.072, 20, 16),
    knobMat,
    cordRoot,
    0,
    -CORD_LEN,
  );
  // 木珠外圈的光晕：一闪一闪，告诉人"这里可以拉"
  const knobGlowMat = new THREE.SpriteMaterial({
    map: glowMap,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const knobGlow = new THREE.Sprite(knobGlowMat);
  knobGlow.scale.set(0.42, 0.42, 1);
  knob.add(knobGlow);
  // 绳子太细点不中，套一个看不见的粗管当判定区（材质不可见，不影响 raycast）
  const cordHit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, CORD_LEN + CORD_GRAB, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  cordHit.position.y = -(CORD_LEN + CORD_GRAB) / 2 + 0.02;
  cordHit.userData.cord = true;
  cordRoot.add(cordHit);
  hits.push(cordHit);
  /**
   * 提示星屑：木珠每闪一下，就从它周围蹦出几颗小星星，
   * 划一道抛物线落到地上停住，再淡掉。纯视觉，不参与拾取。
   */
  function sparkTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d')!;
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,244,214,0.96)');
    g.addColorStop(0.5, 'rgba(255,208,126,0.4)');
    g.addColorStop(1, 'rgba(255,178,86,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,252,240,1)';
    c.lineWidth = 3.8;
    c.beginPath();
    c.moveTo(32, 7);
    c.lineTo(32, 57);
    c.moveTo(7, 32);
    c.lineTo(57, 32);
    c.stroke();
    c.strokeStyle = 'rgba(255,232,170,0.85)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(16, 16);
    c.lineTo(48, 48);
    c.moveTo(48, 16);
    c.lineTo(16, 48);
    c.stroke();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    textures.add(t);
    return t;
  }
  const sparkTex = sparkTexture();
  const SPARK_POOL = 30; // 持续撒播时空中同时十几颗，池子留足余量
  const SPARK_GROUND = 0.06; // 飘落到这个高度就算"落地"
  const SPARK_GRAVITY = 3.6;
  type Spark = {
    sprite: THREE.Sprite;
    vel: THREE.Vector3;
    life: number;
    landed: boolean;
    base: number;
  };
  const sparks: Spark[] = [];
  for (let i = 0; i < SPARK_POOL; i++) {
    /**
     * 注意混合模式：这里**故意不用**加法混合（AdditiveBlending）。
     * 星星是围着木珠飞的，开灯后灯罩 / 光晕 / 光锥全在自发光，
     * 加法混合的小点叠到亮背景上会直接饱和成白色 → 看起来就像"开灯后不掉星星了"。
     * 普通混合 + 暖橙色，白天压在灰暗背景上够亮，夜里压在亮灯罩上也还看得见色相。
     */
    const mat = new THREE.SpriteMaterial({
      map: sparkTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.scale.setScalar(0.2);
    root.add(sprite);
    sparks.push({ sprite, vel: new THREE.Vector3(), life: 0, landed: false, base: 0.2 });
  }
  let sparkCursor = 0;
  let sparkTimer = 0;
  /** 拉过一次灯绳就不再撒星屑 —— 这只是"这里能点"的引导提示，用户学会后就不该再干扰 */
  let cordPulled = false;
  /** 从木珠当前位置撒一把星星（向上为主、水平散开，之后交给重力）。 */
  function burstSparks() {
    const origin = new THREE.Vector3();
    knob.getWorldPosition(origin);
    /**
     * 夜灯一亮，灯罩 / 光晕 / 光锥全在发光，加法混合的小星星叠上去会直接饱和成白色
     * —— 看起来就像"开灯后不掉星星了"。所以夜里把它调得更大、更饱和（金橙），
     * 并且多撒一颗，落到下面暗处时才看得清。
     */
    const nightBoost = night;
    const lit = night > 0.5 || nightTarget === 1;
    const count = (lit ? 5 : 4) + Math.floor(Math.random() * 3);
    for (let k = 0; k < count; k++) {
      const s = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % sparks.length;
      const angle = Math.random() * Math.PI * 2;
      // 起始点就落在木珠球心附近（偏差 ≤2cm），保证"星星是从圆球里蹦出来的"
      const r = Math.random() * 0.02;
      s.sprite.position.set(
        origin.x + Math.cos(angle) * r,
        origin.y + (Math.random() - 0.35) * 0.02,
        origin.z + Math.sin(angle) * r,
      );
      s.vel.set(
        Math.cos(angle) * (0.22 + Math.random() * 0.5),
        0.95 + Math.random() * 0.7,
        Math.sin(angle) * (0.22 + Math.random() * 0.5),
      );
      s.life = 2.2;
      s.landed = false;
      s.base = (0.17 + Math.random() * 0.11) * (1 + nightBoost * 0.18);
      s.sprite.scale.setScalar(s.base);
      // 夜里换成更饱和的金橙（白点叠在暖白灯罩上会糊掉，橙点不会）
      s.sprite.material.color.set(lit ? '#ff9f3c' : '#ffd88a');
      s.sprite.material.opacity = 1;
      s.sprite.visible = true;
    }
  }
  let cordPull = 0,
    cordVel = 0,
    cordSwingX = 0,
    cordSwingZ = 0,
    cordSwingVX = 0,
    cordSwingVZ = 0,
    cordDrag = false,
    cordArmed = false,
    cordHover = false,
    cordHoverAmt = 0,
    dragStartY = 0;
  /** 放大看图时"单击同一张 = 回全景"要等一小段时间，给双击留出判定窗口 */
  let pendingTap = 0;
  /** 翻转夜灯。拉绳和（保留下来的）light() API 都走这里。 */
  function toggleLight() {
    nightTarget = nightTarget === 1 ? 0 : 1;
    cordPulled = true; // 提示达成，之后不再撒星屑
    burstSparks(); // 拉一下绳也撒最后一把，给个即时反馈
    persistView();
    onNight?.(nightTarget === 1);
  }
  /** 拽一下绳子：给一个向下的初速度 + 一点随机横向冲量，之后交给弹簧。 */
  function yankCord(speed: number) {
    cordVel = speed;
    cordSwingVX += (Math.random() - 0.5) * 2.4;
    cordSwingVZ += (Math.random() - 0.5) * 2.4;
  }
  function endCordDrag() {
    if (!cordDrag) return;
    cordDrag = false;
    cordArmed = false;
    controls.enabled = active < 0 && !transition;
  }

  const projections = createMemoryProjections(scene, renderer.getPixelRatio());
  const filled = Array(SLOT_COUNT).fill(false);
  const targetPos = new THREE.Vector3(),
    targetLook = new THREE.Vector3();
  const overviewPosition = camera.position.clone(), overviewTarget = controls.target.clone();
  let persistedView = '', lastViewWrite = 0, viewSaveFailed = false;
  function persistView() {
    // Photo close-ups are temporary; reopening returns to the last whole-lamp view.
    if (active < 0 && !transition) {
      overviewPosition.copy(camera.position);
      overviewTarget.copy(controls.target);
    }
    const view: SavedView = {
      night: nightTarget === 1, spinning: rotating,
      position: overviewPosition.toArray() as SavedView['position'],
      target: overviewTarget.toArray() as SavedView['target'],
      angle: rotatingStage.rotation.y,
    };
    const serialized = JSON.stringify(view);
    if (serialized === persistedView) return;
    try {
      saveView(view);
      persistedView = serialized;
      viewSaveFailed = false;
      onViewSave(true);
    } catch {
      onViewSave(false);
      if (!viewSaveFailed) onError('当前浏览器无法保存视角和模式，请检查网站存储设置。');
      viewSaveFailed = true;
    }
  }
  const saveOnHide = () => { if (document.visibilityState === 'hidden') persistView(); };
  controls.addEventListener('end', persistView);
  window.addEventListener('pagehide', persistView);
  document.addEventListener('visibilitychange', saveOnHide);

  function focus(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= faces.length) return;
    clearTimeout(pendingTap);
    pendingTap = 0;
    persistView();
    active = index;
    onPick(index);
    const face = faces[index];
    face.updateWorldMatrix(true, false);
    face.getWorldPosition(targetLook);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(
      face.matrixWorld,
    );
    targetPos.copy(targetLook).addScaledVector(normal, 2.15);
    targetPos.y += 0.04;
    transition = true;
    controls.enabled = false;
    highlight();
  }
  function reset() {
    clearTimeout(pendingTap);
    pendingTap = 0;
    overviewPosition.copy(home);
    overviewTarget.copy(homeTarget);
    active = -1;
    onPick(-1);
    // 回到全景必须恢复旋转 —— 「暂停旋转」按钮已删，转台没有手动开关了；
    // 不在这里 resume 的话，聚焦相框后关掉详情面板，转台会永远停在原地。
    rotating = true;
    motion.play(true);
    targetLook.copy(homeTarget);
    targetPos.copy(home);
    transition = true;
    controls.enabled = false;
    highlight();
  }
  function highlight() {
    faceFrames.forEach((frame, i) => {
      const m = frame.material as THREE.MeshStandardMaterial;
      m.color.set(i === active ? '#f5c665' : selecting ? '#9bc8e7' : '#fff9e8');
      m.emissive.set(selecting || i === active ? '#568bb7' : '#000');
      m.emissiveIntensity = selecting ? 0.28 : 0.08;
    });
  }
  async function setFace(index: number, face: SlotFace) {
    const version = ++revisions[index];
    let img: HTMLImageElement | undefined;
    let pdf: Blob | null = face.pdf ?? null;
    // 优先级：用户上传的 PDF 第一页 > 种子封面图 > 占位卡
    if (pdf) {
      try {
        const { pdfFirstPage, pdfFallbackImage } = await import('./pdf-cover');
        img = (await pdfFirstPage(pdf, `slot-${index}`)) ?? undefined;
        if (!img) img = pdfFallbackImage(face.code, face.title);
      } catch {
        pdf = null;
      }
    }
    if (!img && face.cover) {
      try {
        img = await loadCover(toFrameSrc(face.cover));
      } catch {
        img = undefined;
      }
    }
    if (!alive || version !== revisions[index]) return;
    const m = faces[index].material,
      previous = m.map;
    m.map = frameTexture(index, face.code, face.title, img);
    m.emissiveMap = m.map;
    m.emissive.set('#fff5e4');
    filled[index] = Boolean(face.cover) || Boolean(pdf);
    renderer.domElement.dataset.carouselCovers = String(filled.filter(Boolean).length);
    m.needsUpdate = true;
    if (previous) {
      textures.delete(previous);
      previous.dispose();
    }
  }
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let downX = 0, downY = 0;
  function hitAt(e: Pick<PointerEvent, 'clientX' | 'clientY'>) {
    const r = renderer.domElement.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    return ray.intersectObjects(hits, false)[0];
  }
  const down = (e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    const hit = hitAt(e);
    if (hit && hit.object.userData.cord) {
      // 抓住绳子了：接下来是"拽"，别让 OrbitControls 把镜头也一起转了
      cordDrag = true;
      cordArmed = false;
      dragStartY = e.clientY;
      cordVel = 0;
      controls.enabled = false;
    }
  };
  const move = (e: PointerEvent) => {
    if (cordDrag) {
      cordPull = THREE.MathUtils.clamp(
        (e.clientY - dragStartY) / 230,
        0,
        CORD_MAX_PULL,
      );
      if (cordPull >= CORD_TRIGGER) cordArmed = true;
      renderer.domElement.style.cursor = 'grabbing';
      return;
    }
    if (active >= 0 || transition) {
      renderer.domElement.style.cursor = 'grab';
      return;
    }
    const hit = hitAt(e);
    cordHover = Boolean(hit && hit.object.userData.cord);
    renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
  };
  const up = (e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0) return;
    if (cordDrag) {
      endCordDrag();
      // 没怎么动的松手就是"点一下"；拽够行程的松手才算"拉到位"
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (cordArmed || moved < 6) {
        yankCord(cordArmed ? -0.8 : 4.6);
        toggleLight();
      } else {
        yankCord(-0.8);
      }
      cordArmed = false;
      return;
    }
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
    const hit = hitAt(e);
    if (hit && hit.object.userData.cord) {
      clearTimeout(pendingTap);
      pendingTap = 0;
      yankCord(4.6);
      toggleLight();
      return;
    }
    if (active >= 0 && !transition) {
      /**
       * 放大看图状态：点这张图本身 → 直接进详情页（2026-09-14 用户要求
       * 「点击旋转木马模型上的图片也要进入内页」，把原来「双击进详情 / 单击回全景」
       * 的隐藏双击改成了单击直进 —— 双击太隐蔽，用户根本发现不了）。
       * 回全景改为：点空白、点别的相框、或 Esc。
       */
      const index = hit ? (hit.object.userData.photo as number) : -1;
      if (index === active) {
        clearTimeout(pendingTap);
        pendingTap = 0;
        onDetail?.(active);
        return;
      }
      clearTimeout(pendingTap);
      pendingTap = 0;
      reset();
      return;
    }
    if (hit) {
      focus(hit.object.userData.photo as number);
      return;
    }
    onMissPick?.();
  };
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointercancel', endCordDrag);
  const resize = () => {
    const w = el.clientWidth,
      h = el.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(36) / 2) * Math.max(1, .85 / (w / h)))) * VIEW_SHRINK;
    // 整体构图左移：离轴投影把画面往左推（模型中轴落到屏幕 ~30% 处）。
    // setViewOffset 内部会调 updateProjectionMatrix；射线拾取与轨道控制
    // 基于同一份投影矩阵，所以点击/拖拽不会因为画面左移而错位。
    camera.setViewOffset(w, h, w * VIEW_SHIFT_X, 0, w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  resize();
  const clock = new THREE.Timer(),
    reduced = prefersReduced();
  clock.connect(document);
  /* 详情页（WorkProjectPage）整屏不透明地盖在木马上时，外层会调 setPaused(true)
     把渲染循环挂起：rAF 照转但什么都不算不画，主线程与 GPU 全让给滚动页。
     否则详情页里滚动一卡一卡的 —— 实测滚动掉帧主要就是背后这个 GL 循环在抢。 */
  let renderPaused = false;
  function animate() {
    raf = requestAnimationFrame(animate);
    if (renderPaused) return;
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.04),
      t = clock.getElapsed();
    /**
     * 常态风：风力不再衰减到 0，而是在 WIND_BASE 上下缓慢起伏
     * （约二十几秒一个来回），像有风断断续续地吹，而不是死板的匀速摆动。
     */
    const wind = WIND_BASE + WIND_GUST * (0.5 + 0.5 * Math.sin(t * 0.26 + Math.sin(t * 0.13) * 1.6));
    night = THREE.MathUtils.lerp(
      night,
      nightTarget,
      reduced ? 1 : 1 - Math.exp(-dt * 3),
    );
    bulbs.forEach((light) => {
      light.intensity = night * 4.8;
    });
    spots.forEach((light) => {
      light.intensity = night * 22;
    });
    concealedLight.emissiveIntensity = night * 2.2;
    shadeMat.emissiveIntensity = night * 0.68;
    hemi.intensity = 0.40 - night * 0.18;
    sun.intensity = 3.1 - night * 2.98;
    sun.color.setRGB(1, .745, .423).lerp(new THREE.Color('#fff0dc'), night);
    daylight.intensity = 105 * (1 - night);
    daylightRim.intensity = .85 * (1 - night);
    blue.intensity = 0.55 - night * 0.20;
    haloMat.opacity = night * 0.36;
    rimGlowMaterial.opacity = night * 0.72;
    volumeMaterial.uniforms.strength.value = night * 0.19;
    renderer.toneMappingExposure = 0.94 + night * 0.04;
    scene.environmentIntensity = 0.28 - night * 0.10;
    const movement = motion.update(dt, active >= 0 || selecting, reduced);
    /**
     * 风推着转台来回滚一点点。这里必须是**有界摆动**而不是累积量：
     * 原来「来阵风」是瞬间触发，累积推进没问题；现在风一直吹，
     * 累积会让转速被永久叠加（约 3 倍速），所以改成围绕 0 摆，平均转速不变。
     */
    const windSpin = reduced ? 0 : Math.sin(t * 0.31) * wind * WIND_SPIN;
    // Each suspended chain has its own damped response to rotation and wind.
    pivots.forEach((p, i) => {
      if (active >= 0 || selecting) return;
      const sway = p.userData.sway;
      const spin = movement.speed / (Math.PI * 2 / 28);
      const amount = reduced ? 0 : 0.012 + wind * 0.11;
      /**
       * 风要用「低频大幅度」驱动 —— 这正是原来「来阵风」点了没反应的根因：
       * 悬挂链条是个阻尼弹簧（stiffness 7~10.3 → 固有频率约 2.6~3.2 rad/s），
       * 而风力原本加在 1.1~1.35Hz（≈7~8.5 rad/s）的高频微摆项上，远高于固有频率，
       * 被弹簧按 (ωn/ω)²≈0.1 滤掉：0.11rad 的目标传到相框只剩 0.01rad（约 0.6°），
       * 肉眼根本看不见。改成 ~0.32Hz（2.0 rad/s）的低频推力后弹簧跟得上，
       * 再配合大幅度，才是"被风吹歪、再荡回来"的样子。
       * 注：风现在是持续的环境动效，所以 reduce-motion 下按规矩完全关闭
       * （原来是按钮触发时才给一小段）。
       */
      const gustPush = reduced ? 0 : Math.sin(t * WIND_FREQ + i * 0.55) * wind * WIND_SWING;
      const targetX = (reduced ? 0 : -0.045 * spin * spin
        + Math.sin(t * (1.1 + i * 0.017) + i) * (amount * 0.55 + Math.abs(spin) * 0.026))
        + gustPush * 0.45;
      const targetZ = (reduced ? 0 : -spin * 0.04
        + Math.sin(t * (1.35 + i * 0.023) + i * 1.7) * (amount + Math.abs(spin) * 0.04))
        + gustPush;
      const stiffness = 7 + (i % 4) * 1.1;
      sway.vx += ((targetX - sway.x) * stiffness - sway.vx * 2.2) * dt;
      sway.vz += ((targetZ - sway.z) * stiffness - sway.vz * 2.2) * dt;
      sway.x += sway.vx * dt;
      sway.z += sway.vz * dt;
      p.rotation.x = sway.x;
      p.rotation.z = sway.z;
    });
    rotatingStage.rotation.y = movement.angle + windSpin;
    horses.forEach((horse, index) => {
      horse.position.y = movement.heights[index];
    });
    /**
     * 灯绳：手上拽着的时候完全跟手（cordPull 直接由指针位移给）；
     * 一松手就交给阻尼弹簧 —— 先被抻长，再回弹、过冲、荡两下停住。
     * ω≈20.5 rad/s（k=420），阻尼比约 0.32，回弹 2~3 下肉眼刚好舒服。
     */
    if (!cordDrag) {
      const k = reduced ? 620 : 420,
        damp = reduced ? 34 : 13;
      cordVel += (-cordPull * k - cordVel * damp) * dt;
      cordPull += cordVel * dt;
      if (cordPull < -0.1) {
        cordPull = -0.1;
        cordVel *= -0.25;
      }
    }
    cordSwingVX += (-cordSwingX * 92 - cordSwingVX * 5.2) * dt;
    cordSwingVZ += (-cordSwingZ * 92 - cordSwingVZ * 5.2) * dt;
    cordSwingX += cordSwingVX * dt;
    cordSwingZ += cordSwingVZ * dt;
    // 风也吹得绳子轻轻晃，静止时不至于像根铁丝
    const cordWind = reduced ? 0 : wind * 0.035;
    cordRoot.rotation.x = cordSwingX + Math.sin(t * 1.7) * cordWind;
    cordRoot.rotation.z = cordSwingZ + Math.cos(t * 1.35) * cordWind * 0.8;
    const cordLen = CORD_LEN + cordPull;
    cord.scale.y = cordLen / CORD_LEN;
    cord.position.y = -cordLen / 2;
    knob.position.y = -cordLen;
    cordHit.scale.y = (cordLen + CORD_GRAB) / (CORD_LEN + CORD_GRAB);
    cordHit.position.y = -(cordLen + CORD_GRAB) / 2 + 0.02;
    cordHoverAmt += (Number(cordHover) - cordHoverAmt) * (reduced ? 1 : 1 - Math.exp(-dt * 12));
    /**
     * 木珠一闪一闪地发光（每 ~2.9 秒一次暖光脉冲），像门铃按钮的呼吸灯，
     * 提示"这里可以拉"。悬停时亮得更稳，拽动时也跟着变亮。
     * reduce-motion 下不闪，改成常亮的柔和光。
     */
    const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2), 5);
    // reduce-motion 下不闪，换成更慢更浅的一次"呼吸"：提示仍在，但不刺激
    const breathe = reduced ? Math.pow(0.5 + 0.5 * Math.sin(t * 0.8), 2) * 0.45 : pulse;
    knobMat.emissiveIntensity =
      0.35 + breathe * 1.7 + cordHoverAmt * 0.6 + Math.max(0, cordPull) * 0.9;
    knobGlowMat.opacity = 0.3 + breathe * 0.7 + cordHoverAmt * 0.3;
    knobGlow.scale.setScalar(0.42 + breathe * 0.16 + cordHoverAmt * 0.12);
    knob.scale.setScalar(1 + cordHoverAmt * 0.16);
    // 绳身跟着一起亮一下，不然只有小球在闪、绳子还是没存在感
    cordMat.emissiveIntensity = 0.12 + breathe * 0.6;
    /**
     * 星屑：一进页面就一直在掉（"这里能拉"），拉过一次灯绳就停。
     * ⚠️ 这里**故意不看 reduced**：系统开了"减少动态效果"时，引导提示也该在，
     * 只是把节拍放慢一倍、并去掉闪烁（见下面 twinkle）—— 是"减弱"而不是"移除"。
     * （之前写成 `!reduced` 硬闸门，一旦系统开了减少动效，星星会整个消失，看起来就像功能坏了。）
     */
    if (!cordPulled) {
      sparkTimer -= dt;
      if (sparkTimer <= 0) {
        burstSparks();
        sparkTimer = reduced ? 1.5 + Math.random() * 0.7 : 0.7 + Math.random() * 0.6;
      }
    }
    sparks.forEach((s) => {
      if (!s.sprite.visible) return;
      if (!s.landed) {
        s.life -= dt;
        // 出球的前 0.18s 慢慢加速，视觉上就是"从圆球里冒出来"，而不是凭空出现在旁边
        const ramp = Math.min(1, (2.2 - s.life) / 0.18);
        s.vel.y -= SPARK_GRAVITY * dt * ramp;
        s.sprite.position.addScaledVector(s.vel, dt * ramp);
        const twinkle = reduced ? 0.86 : 0.72 + 0.28 * Math.sin((2.2 - s.life) * 26);
        s.sprite.material.opacity = twinkle;
        s.sprite.scale.setScalar(s.base * (0.85 + 0.35 * twinkle));
        if (s.sprite.position.y <= SPARK_GROUND || s.life <= 0) {
          s.sprite.position.y = Math.max(s.sprite.position.y, SPARK_GROUND);
          s.landed = true;
          s.life = 0.6; // 落地后的淡出时间
        }
      } else {
        s.life -= dt;
        s.sprite.material.opacity = Math.max(0, s.life / 0.6);
        if (s.life <= 0) {
          s.sprite.visible = false;
          s.sprite.material.opacity = 0;
        }
      }
    });
    if (transition) {
      // 收敛比原版（×4）快一档：放大/回全景后尽快交还点击判定，
      // 拖太久的 transition 会让"点哪里都回全景"晚几秒才生效。
      const alpha = reduced ? 1 : 1 - Math.exp(-dt * 5.5);
      camera.position.lerp(targetPos, alpha);
      controls.target.lerp(targetLook, alpha);
      if (camera.position.distanceTo(targetPos) < 0.008) {
        transition = false;
        controls.enabled = active < 0;
      }
    }
    faces.forEach((face, index) => {
      face.material.emissiveIntensity = filled[index] ? night * 0.33 : 0;
    });
    projections.update(night, t, reduced, wind, movement.angle + windSpin);
    controls.update();
    renderer.render(scene, camera);
    if (t - lastViewWrite >= .3) { persistView(); lastViewWrite = t; }
  }
  animate();
  const keyboard = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest('input,button,[role="dialog"]')) return;
    /* ⚠️ 2026-09-16 第一档改造 ③ 移除了这里的 `if (e.key === 'Escape') reset();` ——
       全站的 Esc 现在统一走 @/lib/escape-stack（window 捕获阶段 + 命中即停），
       本模块这条 bubble 监听收不到 Esc 了（留着就是一条骗人的死代码）。
       语义没丢：WorksCarousel 的 useEscape 在"聚焦中"那一分支调的就是 resetView()，
       而 resetView() 内部正是 apiRef.current.reset()（= 本文件的 reset），
       还顺带清了 focused / active —— 是原行为的超集。 */
    if (active >= 0 && e.key === 'ArrowRight')
      focus((active + 1) % SLOT_COUNT);
    if (active >= 0 && e.key === 'ArrowLeft')
      focus((active + SLOT_COUNT - 1) % SLOT_COUNT);
  };
  window.addEventListener('keydown', keyboard);
  const contextLost = (event: Event) => {
    event.preventDefault();
    onError('画面暂时中断，请刷新页面重新打开。');
  };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  return {
    ready: Promise.resolve(),
    focus,
    reset,
    rotate(on) {
      rotating = on;
      motion.play(on);
      persistView();
    },
    light(on) {
      nightTarget = on ? 1 : 0;
      persistView();
      onNight?.(nightTarget === 1);
    },
    selectMode(on) {
      selecting = on;
      highlight();
    },
    setFace,
    setPaused(on) {
      renderPaused = on;
    },
    dispose() {
      persistView();
      clearTimeout(pendingTap);
      controls.removeEventListener('end', persistView);
      window.removeEventListener('pagehide', persistView);
      document.removeEventListener('visibilitychange', saveOnHide);
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      window.removeEventListener('keydown', keyboard);
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointercancel', endCordDrag);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      clock.dispose();
      projections.dispose();
      daylight.shadow.dispose();
      sun.shadow.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            m.dispose(),
          );
        }
      });
      textures.forEach((t) => t.dispose());
      sparks.forEach((s) => s.sprite.material.dispose());
      knobGlowMat.dispose();
      haloMat.dispose();
      rimGlowMaterial.dispose();
      // 环境贴图归 room-env 的 WeakMap 缓存所有，不在这里 dispose
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
