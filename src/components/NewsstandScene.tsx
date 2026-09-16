import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getRoomEnv } from '@/lib/room-env';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BOOK_ROWS, createBook } from '@/lib/newsstandBooks';

type Props = {
  open: boolean;
  onClose: () => void;
  /**
   * 点开架上物件（2026-09-15）。
   * `row='devices'` = 第一排（顶层 DVD/DV/MP3）→ 视频与音乐；
   * `row='books'`   = 第二排（下层三本书）→ 文案与 AI 项目。
   * `index` = 设备在 DEVICE_SLOTS 里的序号（0 DVD / 1 DV / 2 MP3，即从左到右）。
   * 用户规划三台设备各进一个片单（横屏 / AI / 竖屏），所以序号要带出去；
   * 书架那边没有分流，固定传 0。
   */
  onPick?: (row: 'devices' | 'books', index: number) => void;
  /**
   * 被落地页盖住（2026-09-16）：书架第一/二排点进落地页后书架保持挂载，
   * 此时要 ① 暂停 GL 渲染循环（省 GPU，画面反正看不见）② 忽略 Esc ——
   * 否则用户在落地页按 Esc，书架的 window keydown 会把书架一起关掉，
   * 「Back 先回书架」就跳级了。落地页自己的 Esc 由它自己处理。
   */
  covered?: boolean;
};

/** 展架适配后的目标高度（世界单位），相机距离都按它推导，避免依赖原始模型比例 */
const FIT_HEIGHT = 2.4;
/** 展架整体下移量：让模型在视口中垂直居中 */
const FLOOR_DROP = 0.0;
/** 架子跟随鼠标：左右（Y 轴）小幅度转动（弧度） */
const ROTATE_LIMIT_Y = THREE.MathUtils.degToRad(14);
/** 上下（X 轴）倾角：鼠标在上方时幅度大一些，在下方时收小（避免露出太多底面） */
const ROTATE_LIMIT_X_UP = THREE.MathUtils.degToRad(8);
const ROTATE_LIMIT_X_DOWN = THREE.MathUtils.degToRad(3);
/** 与环境融合的雾色（暖调暗色） */
const FOG_COLOR = 0x17110b;

/** 悬停时书籍抬起幅度（模型单位）——要足够让整本书高出上层搁板底面 */
const HOVER_LIFT = 0.048;
/** 悬停时同时向前抽出，避免抬升过程中与上层搁板穿模 */
const HOVER_PULL = 0.065;
/** 悬停时书籍放大倍数（位移 + 缩放双过渡） */
const HOVER_SCALE = 1.12;
/** 悬停抬升 / 复位的缓动速度（每秒趋近比例） */
const HOVER_EASE = 9;

/**
 * 顶层搁板上的三件设备（从左到右：DVD 机 → DV 机 → MP3）。
 *
 * 坐标一律是**架子原始模型局部单位**，与 BookSpec 同一坐标系。
 * 数值由 `scripts/_probe-rack.mjs` 实测标定（不是猜的）：
 *   · 顶层台面      y = 0.74
 *   · 可用横向范围  x ∈ [-0.2065, 0.2126]  → 净宽 0.4191
 *   · 可用进深范围  z ∈ [-0.0721, 0.0548]  → 净深 0.1268
 *   · 天花板底面    y = 0.92               → 顶层净高 0.18（设备高度+抬升都要压在这之内）
 *
 * 字段：
 *   file   模型文件名（public/newsstand/）
 *   width  **摆放后 x 方向包围盒宽度**（含旋转），模型尺寸差异很大，统一按宽度归一化
 *   x/z    在搁板上的水平位置（width 已被居中处理，这里给的是中心）
 *   pitch  绕 X 俯仰（度，负值 = 向后倒）
 *   yaw    绕 Y 左右转（度）
 *   roll   绕 Z 侧倾（度）
 *   旋转按 YXZ 顺序施加：先 roll（自身侧倾）→ 再 pitch（倒下）→ 最后 yaw（整体转向），
 *   这样「先把机器放倒、再把它转向一侧」的直觉是对的。
 */
/**
 * 报刊亭顶层三件设备：**每件都必须「正面朝向镜头」**（DVD 的屏幕算正面）。
 *
 * 朝向不是猜的 —— 用 `?nsfit=1` 的 `__NSYAW(idx, deg)` 把每件绕 Y 转
 * 0/90/180/270 各渲一张（DPR=2 + clip scale 5）实测得出，脚本见
 * scripts/yawscan-device-facing.mjs + scripts/compose-yaw.py：
 *   · dvd.glb  正面法线在**局部 -X** → 绕 Y +90° 才正对镜头（yaw=0/180 都只能看到背面）
 *   · dv.glb   正面（镜头）法线在**局部 +Z** → yaw≈0 即正对镜头
 *   · mp3.glb  正面（转盘+屏）法线在**局部 +Z** → yaw≈0 即正对镜头；
 *              且俯仰/侧倾是绕 Z 的，不会把正面转走
 * 换模型后务必重跑一次该扫描，别沿用旧角度。
 *
 * 摆放顺序固定为从左到右 DVD 机 → DV 机 → MP3（由 x 递增保证）。
 */
const DEVICE_Y = 0.74;

const DEVICE_SLOTS = [
  {
    file: 'dvd.glb',
    /**
     * **水平摆放**（2026-09-14 定稿）。这台是翻盖式便携 DVD：模型本身就是半开的 ——
     * 上盖立起是屏幕（局部 -X 法线，yaw=90 转到朝镜头），底座朝上是光盘托盘。
     *
     * 「看不到放光盘的地方」的几何原因：托盘顶面朝上，而相机（local y≈0.535）比
     * 顶层台面（0.74）低 —— 平视构图下托盘永远只有一条边。试过的两条路：
     *   ① 机器前倾 30° → 用户不接受（「dvd 机是斜着放的」）；
     *   ② 相机抬高俯视 → 用户也不接受（「不用把相机抬高，水平就行」）。
     * 所以最终就是：机器平放、平视构图，接受托盘可见性让位于构图 —— 这是用户自己的取舍。
     * hover 姿态 = 静止姿态（悬停只抬升/放大/前抽，不改变姿态）。
     */
    frontAxis: [-1, 0, 0],
    width: 0.112,
    x: -0.1187,
    z: -0.005,
    pitch: 0,
    yaw: 90,
    roll: 0,
    hoverPitch: 0,
    hoverRoll: 0,
  },
  {
    file: 'dv.glb',
    /** 竖直摆放；机身本来就扁宽，宽度归一化后自然比 DVD 矮。镜头（正面）法线在局部 +Z，yaw≈0 即朝镜头 */
    frontAxis: [0, 0, 1],
    width: 0.105,
    x: 0.0216,
    z: -0.012,
    pitch: 0,
    yaw: 3,
    roll: 0,
    hoverPitch: 0,
    hoverRoll: 0,
  },
  {
    file: 'mp3.glb',
    /**
     * ⚠️ 用户明确要求「MP3 不要竖直摆放，需微微倾斜并放倒」。
     * 做法 = 绕 Z 侧倒 78°（长轴由竖直变成水平 → 明确是"放倒"了），
     * 但**不转到 90°**，留 12° 倾角，加 -6° 俯仰与 10° 偏航 → 「微微倾斜」。
     * 选侧倒而不是后仰躺平：绕 Z 旋转不改变正面法线（正面法线在局部 +Z，正是旋转轴），
     * 放倒后正面依然朝镜头，仍认得出是台 MP3；
     * 若改为后仰躺平，正面朝上，从正面看只剩一条 ~10px 的薄边。
     *
     * ⚠️ 2026-09-13 追加：用户看到悬停后的样子说「不用这么竖，45° 就行」——
     * 悬停原本一路扶正到 0°（笔直站立），太直；现在 hoverRoll = -45°，
     * 即从 -78° 只站起一半，保持「半倚」的松弛感。
     */
    frontAxis: [0, 0, 1],
    width: 0.075,
    x: 0.1434,
    z: -0.004,
    pitch: -6,
    yaw: 10,
    roll: -78,
    hoverPitch: -6,
    hoverRoll: -45,
  },
] as const;

/** 按文件名取「正面法线（局部空间）」——探针用它把「正面是否朝镜头」变成可断言的数值 */
const frontAxisOf = (file: string): readonly [number, number, number] | undefined =>
  DEVICE_SLOTS.find((s) => s.file === file)?.frontAxis;

/** 设备的悬停幅度：比书小（净高只有 0.18，抬多了会顶到天花板） */
const DEVICE_LIFT = 0.028;
const DEVICE_PULL = 0.078;
const DEVICE_SCALE = 1.14;

/**
 * 报刊亭 → 创作档案（Creative Lab）3D 场景。
 *
 * 点工作室里的「报刊亭」物件后**在站内**原地展开。布局：
 * - 下层搁板：程序化书籍（BOOK_ROWS）；
 * - 顶层搁板：三件设备，从左到右 DVD 机 → DV 机 → MP3（DEVICE_SLOTS，模型在
 *   public/newsstand/{dvd,dv,mp3}.glb，原始各 150 万面 / 80MB，用
 *   scripts/compress-devices.sh 压到 7.5 万面 / 0.85MB）；
 * - 底层是「旋转木马同款」的高斯模糊磨砂玻璃背景（backdrop-filter，把身后工作室糊掉）；
 * - 顶层透明 WebGL canvas 只画展架（仅靠 RoomEnvironment 环境反射照明，无直射灯）。
 *
 * 交互（2026-09 精简版）：
 *  · 已移除点击推近 / 滚轮缩放 —— 相机固定在展架正前方。
 *  · 唯一交互 = 悬停物件：向上抬起 + 向前抽出 + 放大（位移 + 缩放双过渡）；
 *    放倒的设备（MP3）同时**转正立起来**，移开平滑复位。
 *  · 右上角「关闭 ✕」/ Esc → 关闭浮层。
 */
export default function NewsstandScene({ open, covered = false, onClose, onPick }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const pointerInsideRef = useRef(false);
  /**
   * onPick 用 ref 镜像：建场景的 effect 只在 mounted 变化时跑一次，
   * 直接闭包捕获 onPick 会永远是首次渲染那一个（父组件重渲染后回调就过期了）。
   */
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  /* covered 同样用 ref 镜像：GL 循环的闭包只在 mounted 变化时建一次，
     直接捕获 props.covered 会永远是首次渲染的值（和上面 onPickRef 同一个坑）。 */
  const coveredRef = useRef(covered);
  useEffect(() => {
    coveredRef.current = covered;
  }, [covered]);

  /* 入场 / 退场（与 WorksCarousel 同款淡入淡出） */
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

  /* 建场景 / 彻底销毁 */
  useEffect(() => {
    if (!mounted) return;
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setFailed(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(FOG_COLOR, FIT_HEIGHT * 3.2, FIT_HEIGHT * 6.4);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    /**
     * 相机抬高到展架**上方**俯视（2026-09-14 定稿；?nscam=机位高度,注视高度 可临时改）。
     *
     * 为什么必须抬高：顶层搁板在 local y=0.74（世界 ≈1.66），而 DVD 机是翻开的 ——
     * 光盘托盘在**顶面**。原相机高 FIT_HEIGHT*0.5=1.2，比顶层还低 0.46，
     * 平放的机器只能看到正面和底边，托盘永远只有一条边 —— 用户那句
     * 「都看不到放光盘的地方」就是这个几何事实。试过把机器前倾 30°，
     * 用户又明确不接受（「dvd 机是斜着放的」）。
     *
     * 2026-09-14 结论：抬高相机到 3.3、俯角 20° 确实能让托盘正对镜头（见 _pick_camup_*.png），
     * 但用户明确说「不用把相机抬高，水平就行」—— 保持原平视构图，机器水平摆放。
     * 代价是托盘顶面只能看到一条边；想再试俯视就加 `?nscam=3.3,1.72`。
     *
     * ?nscam=机位高度,注视高度 —— 开发用：临时改机位（默认即下面的平视值）。
     */
    const camOv = new URLSearchParams(window.location.search).get('nscam')?.split(',').map(Number);
    camera.position.set(0, camOv?.[0] ?? FIT_HEIGHT * 0.5, FIT_HEIGHT * 1.9);
    camera.lookAt(0, camOv?.[1] ?? FIT_HEIGHT * 0.5, 0);

    // 环境反射（唯一照明来源）—— PMREM 按 renderer 缓存，见 lib/room-env
    scene.environment = getRoomEnv(renderer);
    scene.environmentIntensity = 1.0;

    // 展架组：整体下移贴合画面底部
    const rackGroup = new THREE.Group();
    rackGroup.position.y = -FLOOR_DROP;
    scene.add(rackGroup);

    let disposed = false;

    /**
     * 架上物件的运行态（下层书籍 + 顶层三件设备）。
     * 幅度参数放在条目上而不是用全局常量：书在净高 0.189 的下层、设备在净高 0.18 的顶层，
     * 且设备被按宽度归一化过（baseScale 不是 1），放大时必须在它基础上乘。
     */
    type HoverItem = {
      group: THREE.Group;
      /**
       * 身份标签。**别用数组下标认物件**：书籍在展架回调里同步 push，
       * 而设备是等展架就绪后异步放置的，顺序会变成「先 3 本书、后 3 件设备」，
       * 和 DEVICE_SLOTS 的顺序无关。按下标去操作会打到书上。
       */
      label: string;
      /**
       * 所在排（2026-09-15）：'devices' = 顶层三件设备（第一排 → 视频/音乐）；
       * 'books' = 下层三本书（第二排 → 文案/AI）。点开时据此决定进哪个页面。
       */
      row: 'devices' | 'books';
      /** 设备序号（0 DVD / 1 DV / 2 MP3）；书架恒为 0 —— 决定进哪个片单 */
      deviceIndex: number;
      baseY: number;
      baseZ: number;
      /** 摆放时的基准缩放（设备按宽度归一化过，不是 1） */
      baseScale: number;
      /** 静止姿态（弧度），悬停时按 standUp 比例过渡到 hover* */
      restPitch: number;
      restRoll: number;
      /**
       * 悬停到顶（t=1）时的目标姿态（弧度）——**不一定是 0**。
       * MP3 用户明确要求「不用这么竖，45° 就行」，所以它的目标是 roll=-45°
       * （从躺倒 -78° 只站起一半），而不是完全立正。
       */
      hoverPitch: number;
      hoverRoll: number;
      /** 「立起来」的程度：1 = 参与姿态过渡（设备）；书本来就微微后仰，保持不动所以是 0 */
      standUp: number;
      lift: number;
      target: number;
      liftAmount: number;
      pullAmount: number;
      scaleAmount: number;
    };
    const hoverItems: HoverItem[] = [];
    let hovered: THREE.Object3D | null = null;

    /** 每帧把 lift 缓动到 target：Y 抬升 + Z 前抽 + 放大 +（设备）立正姿态 */
    const updateHover = (dt: number) => {
      const k = 1 - Math.exp(-HOVER_EASE * dt);
      for (const b of hoverItems) {
        if (Math.abs(b.lift - b.target) < 1e-5) continue;
        b.lift += (b.target - b.lift) * k;
        const t = b.lift / b.liftAmount;
        b.group.position.y = b.baseY + b.lift;
        b.group.position.z = b.baseZ + t * b.pullAmount;
        b.group.scale.setScalar(b.baseScale * (1 + t * (b.scaleAmount - 1)));
        // 「立起来」：放倒的设备朝 hover 姿态过渡（MP3 只站起到 45°）；书的 standUp=0，姿态不受影响
        const s = b.standUp * t;
        b.group.rotation.x = b.restPitch + (b.hoverPitch - b.restPitch) * s;
        b.group.rotation.z = b.restRoll + (b.hoverRoll - b.restRoll) * s;
      }
    };
    const resetHover = () => {
      hovered = null;
      hoverItems.forEach((b) => {
        b.target = 0;
      });
      renderer.domElement.style.cursor = '';
    };

    const loader = new GLTFLoader();
    // 压缩后的 GLB 使用 EXT_meshopt_compression，必须注册解码器
    loader.setMeshoptDecoder(MeshoptDecoder);

    /**
     * 开发用姿态覆盖：`?nsrot=dvd.glb:0,90,30,0.095`（pitch,yaw,roll,width；width 可省）。
     * 可重复出现，一次试多个设备。
     *
     * 关键点：覆盖在**摆放阶段**生效，于是 AABB 会随新姿态重新「居中 + 贴台面」
     * （见 placeDevice）—— 想试角度只要刷页面，不用改代码重构建，
     * 而且量到的就是真实摆放结果。反之若用运行时改 rotation 的探针，
     * 因为枢轴在模型局部原点（不是几何中心），包围盒会被整体甩到搁板外，读数全是假象。
     */
    const poseOverrides = (() => {
      const map = new Map<string, number[]>();
      for (const raw of new URLSearchParams(window.location.search).getAll('nsrot')) {
        const [file, nums] = raw.split(':');
        const v = (nums ?? '').split(',').map(Number).filter(Number.isFinite);
        if (file && v.length >= 3) map.set(file, v);
      }
      return map;
    })();

    /**
     * 顶层设备：按「施加姿态 → 按宽度归一化 → 底座贴台面 → 水平居中」摆到搁板上。
     *
     * 旋转全部放在 holder 上（YXZ 顺序），并额外备好一个**拾取代理盒**：
     * 真实网格 7.5 万面，pointermove 每次都做射线检测会明显卡顿，
     * 所以把真实网格的 raycast 关掉，另挂一个隐形盒（12 面）承担拾取。
     * 代理是 holder 的子节点 → 跟着设备一起转，任何姿态下都贴合。
     */
    const placeDevice = (parent: THREE.Object3D, template: THREE.Object3D, spot: (typeof DEVICE_SLOTS)[number]) => {
      // 模型自身的局部包围盒（未加姿态）—— 只用于做拾取代理
      template.updateMatrixWorld(true);
      const localBox = new THREE.Box3().setFromObject(template);

      const holder = new THREE.Group();
      // YXZ：先 roll（自身侧倾）→ 再 pitch（倒下）→ 最后 yaw（整体转向）
      const ov = poseOverrides.get(spot.file);
      const sPitch = ov?.[0] ?? spot.pitch;
      const sYaw = ov?.[1] ?? spot.yaw;
      const sRoll = ov?.[2] ?? spot.roll;
      const sWidth = ov?.[3] ?? spot.width;
      holder.rotation.order = 'YXZ';
      holder.rotation.set(
        THREE.MathUtils.degToRad(sPitch),
        THREE.MathUtils.degToRad(sYaw),
        THREE.MathUtils.degToRad(sRoll),
      );
      holder.add(template);
      // 加进场景前算盒子：此时 holder 无父节点，盒子就是「搁板坐标系」下（已含姿态）的 AABB
      holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(holder);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = sWidth / (size.x || 1);
      holder.scale.setScalar(scale);
      holder.position.set(
        spot.x - center.x * scale,
        DEVICE_Y - box.min.y * scale, // 底座（含姿态后的最低点）正好落在台面
        spot.z - center.z * scale,
      );
      parent.add(holder);

      template.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh) m.raycast = () => {}; // 拾取交给代理盒
      });
      const lsize = localBox.getSize(new THREE.Vector3());
      const lcenter = localBox.getCenter(new THREE.Vector3());
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(lsize.x, lsize.y, lsize.z),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      proxy.position.copy(lcenter);
      proxy.frustumCulled = false;
      holder.add(proxy);

      hoverItems.push({
        group: holder,
        label: spot.file,
        row: 'devices', // 顶层三件设备 = 第一排 → 视频/音乐页
        // 从左到右 0 DVD / 1 DV / 2 MP3 —— 三台设备各进一个片单
        deviceIndex: Math.max(0, DEVICE_SLOTS.indexOf(spot)),
        baseY: holder.position.y,
        baseZ: holder.position.z,
        baseScale: scale,
        restPitch: holder.rotation.x,
        restRoll: holder.rotation.z,
        hoverPitch: THREE.MathUtils.degToRad(spot.hoverPitch),
        hoverRoll: THREE.MathUtils.degToRad(spot.hoverRoll),
        standUp: 1, // 静止是放倒/歪的 → 悬停朝 hover 姿态过渡
        lift: 0,
        target: 0,
        liftAmount: DEVICE_LIFT,
        pullAmount: DEVICE_PULL,
        scaleAmount: DEVICE_SCALE,
      });
      return holder;
    };

    loader.load(
      `${import.meta.env.BASE_URL}newsstand/rack.glb`,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        /* ?nsgeo=1 几何探针：dump 架子「朝上面」按 y 分桶的 z/x 范围，用于标定层板高度 */
        const wantGeo = new URLSearchParams(window.location.search).has('nsgeo');
        if (wantGeo) {
          model.updateMatrixWorld(true);
          let meshNode: THREE.Mesh | null = null;
          model.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh && !meshNode) meshNode = m;
          });
          const mesh = meshNode as THREE.Mesh | null;
          if (mesh) {
            const rel = new THREE.Matrix4()
              .copy(mesh.matrixWorld)
              .premultiply(new THREE.Matrix4().copy(model.matrixWorld).invert());
            const pos = mesh.geometry.attributes.position;
            const idx = mesh.geometry.index;
            const triCount = (idx ? idx.count : pos.count) / 3;
            const vA = new THREE.Vector3();
            const vB = new THREE.Vector3();
            const vC = new THREE.Vector3();
            const e1 = new THREE.Vector3();
            const e2 = new THREE.Vector3();
            const nrm = new THREE.Vector3();
            const B = 0.012;
            const buckets = new Map<number, { n: number; zMin: number; zMax: number; xMin: number; xMax: number }>();
            const ia = [0, 0, 0];
            for (let t = 0; t < triCount; t++) {
              for (let j = 0; j < 3; j++) ia[j] = idx ? idx.getX(t * 3 + j) : t * 3 + j;
              vA.fromBufferAttribute(pos, ia[0]).applyMatrix4(rel);
              vB.fromBufferAttribute(pos, ia[1]).applyMatrix4(rel);
              vC.fromBufferAttribute(pos, ia[2]).applyMatrix4(rel);
              e1.subVectors(vB, vA);
              e2.subVectors(vC, vA);
              nrm.crossVectors(e1, e2);
              if (nrm.lengthSq() < 1e-14) continue;
              nrm.normalize();
              if (nrm.y < 0.55) continue;
              const cx = (vA.x + vB.x + vC.x) / 3;
              const cy = (vA.y + vB.y + vC.y) / 3;
              const cz = (vA.z + vB.z + vC.z) / 3;
              const key = Math.round(cy / B);
              let b = buckets.get(key);
              if (!b) {
                b = { n: 0, zMin: cz, zMax: cz, xMin: cx, xMax: cx };
                buckets.set(key, b);
              }
              b.n++;
              b.zMin = Math.min(b.zMin, cz);
              b.zMax = Math.max(b.zMax, cz);
              b.xMin = Math.min(b.xMin, cx);
              b.xMax = Math.max(b.xMax, cx);
            }
            const localBox = new THREE.Box3().setFromObject(model);
            (
              window as unknown as { __NSGEO: unknown }
            ).__NSGEO = {
              tris: triCount,
              box: { min: localBox.min, max: localBox.max },
              buckets: [...buckets.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([k, v]) => ({ y: +(k * B).toFixed(3), ...v })),
            };
          }
        }

        const scale = FIT_HEIGHT / (size.y || 1);
        model.scale.setScalar(scale);
        // 水平居中、脚底贴组本地 y=0（组再整体下移 FLOOR_DROP）
        model.position.set(
          -center.x * scale,
          -box.min.y * scale,
          -center.z * scale,
        );
        model.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh) {
            m.frustumCulled = false;
            const mat = m.material as THREE.MeshStandardMaterial;
            if (mat) {
              mat.envMapIntensity = 0.8;
              mat.side = THREE.FrontSide;
            }
          }
        });
        rackGroup.add(model);

        /* 下层书籍：完整展示（程序化生成，每本独立 canvas 封面） */
        BOOK_ROWS.forEach((row) => {
          row.books.forEach((spec) => {
            const book = createBook(spec);
            book.position.set(spec.x, row.lipY, row.z);
            // 绕书脚微微后仰（参考图 A 字架姿态），封面正对镜头
            book.rotation.set(
              THREE.MathUtils.degToRad(-spec.tilt),
              THREE.MathUtils.degToRad(spec.yaw),
              0,
            );
            model.add(book);
            hoverItems.push({
              group: book,
              label: `book:${spec.cover}`,
              row: 'books', // 下层三本书 = 第二排 → 文案/AI 项目页
              deviceIndex: 0, // 书架不分流
              baseY: book.position.y,
              baseZ: book.position.z,
              baseScale: 1,
              restPitch: book.rotation.x,
              restRoll: book.rotation.z,
              // standUp=0 → 姿态始终停在 rest，这两个值不会被用到，填同值最安全
              hoverPitch: book.rotation.x,
              hoverRoll: book.rotation.z,
              standUp: 0, // 书本来就是竖的（只微微后仰），不参与「立正」
              lift: 0,
              target: 0,
              liftAmount: HOVER_LIFT,
              pullAmount: HOVER_PULL,
              scaleAmount: HOVER_SCALE,
            });
          });
        });

        setLoading(false);
      },
      undefined,
      () => {
        if (!disposed) setFailed(true);
      },
    );

    /* 顶层三件设备（DVD 机 / DV 机 / MP3）—— 异步加载，任一失败只缺一件，不影响展架 */
    DEVICE_SLOTS.forEach((spot) => {
      loader.load(
        `${import.meta.env.BASE_URL}newsstand/${spot.file}`,
        (gltf) => {
          if (disposed) return;
          const obj = gltf.scene;
          obj.traverse((child) => {
            const m = child as THREE.Mesh;
            if (m.isMesh) {
              m.frustumCulled = false;
              const mat = m.material as THREE.MeshStandardMaterial;
              if (mat) mat.envMapIntensity = 0.9;
            }
          });
          // 挂到与书相同的坐标系：等 rack 就位后再放
          const tryAttach = (attempt: number) => {
            if (disposed) return;
            const rackModel = rackGroup.children[0];
            if (rackModel) placeDevice(rackModel, obj, spot);
            else if (attempt < 200) setTimeout(() => tryAttach(attempt + 1), 250);
          };
          tryAttach(0);
        },
        undefined,
        () => {},
      );
    });

    /* ---- 无头验证探针（?nsfit=1）：暴露架上物件的真实落位与姿态 ----
       纯读数，不参与渲染。用于在软渲染下拿不到清晰截图时，确认
       「左→右 = DVD/DV/MP3」「底座贴板、不穿天花板」「悬停转正立起来」。
       坐标统一换算回**搁板坐标系**（rackGroup.children[0] 的局部空间），
       这样可以直接和 DEVICE_Y=0.74 / 天花板 0.92 / x∈[-0.2065,0.2126] 比对。 */
    let fitTimer = 0;
    let fitDumpTimer = 0;
    if (new URLSearchParams(window.location.search).has('nsfit')) {
      const w = window as unknown as Record<string, unknown>;
      const expected = 3 + BOOK_ROWS.reduce((n, r) => n + r.books.length, 0);
      const dump = () => {
        const rackModel = rackGroup.children[0];
        if (!rackModel) return;
        /**
         * ⚠️ 一定要在 **rackModel 局部空间**里量，不能「世界包围盒 × inv」。
         * 踩过的坑：架子会跟随鼠标转 ±14°，而 AABB 经过一次旋转变换后会被**撑大**
         * （世界 AABB 再乘 inv，等于给旋转过的盒子取外接盒）。
         * 于是明明摆得好好的三件设备，读数却显示互相重叠、底座离台面、z 超出搁板 ——
         * 全是测量假象。而且不同鼠标位置读数还不一样，非常难查。
         * 正确做法：逐个网格取 geometry.boundingBox，用「相对 rackModel 的矩阵」变换后并集。
         * 这样读数只取决于真实摆放，与相机/架子转动完全无关。
         */
        const inv = new THREE.Matrix4().copy(rackModel.matrixWorld).invert();
        const tmpM = new THREE.Matrix4();
        const tmpQ = new THREE.Quaternion();
        const tmpP = new THREE.Vector3();
        const tmpS = new THREE.Vector3();
        const boxOf = (g: THREE.Object3D) => {
          const box = new THREE.Box3();
          g.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh || !m.geometry) return;
            if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
            const lb = m.geometry.boundingBox;
            if (!lb) return;
            tmpM.copy(inv).multiply(m.matrixWorld);
            box.union(lb.clone().applyMatrix4(tmpM));
          });
          return box;
        };
        w.__NSFIT = {
          count: hoverItems.length,
          items: hoverItems.map((b, i) => {
            const bb = boxOf(b.group);
            const ax = frontAxisOf(b.label);
            let fv: THREE.Vector3 | null = null;
            let up: THREE.Vector3 | null = null;
            if (ax) {
              tmpM.copy(inv).multiply(b.group.matrixWorld).decompose(tmpP, tmpQ, tmpS);
              fv = new THREE.Vector3(ax[0], ax[1], ax[2]).applyQuaternion(tmpQ).normalize();
              // 模型自身的「上」方向：顶面（DVD 的光盘位在这里）是否朝镜头倾斜，看它的 z
              up = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ).normalize();
            }
            return {
              i,
              label: b.label,
              kind: b.standUp > 0 ? 'device' : 'book',
              front: fv ? { x: +fv.x.toFixed(3), y: +fv.y.toFixed(3), z: +fv.z.toFixed(3) } : null,
              up: up ? { x: +up.x.toFixed(3), y: +up.y.toFixed(3), z: +up.z.toFixed(3) } : null,
              x: [+bb.min.x.toFixed(4), +bb.max.x.toFixed(4)],
              y: [+bb.min.y.toFixed(4), +bb.max.y.toFixed(4)],
              z: [+bb.min.z.toFixed(4), +bb.max.z.toFixed(4)],
              baseScale: +b.baseScale.toFixed(4),
              scaleNow: +b.group.scale.x.toFixed(4),
              restPitchDeg: +THREE.MathUtils.radToDeg(b.restPitch).toFixed(1),
              restRollDeg: +THREE.MathUtils.radToDeg(b.restRoll).toFixed(1),
              pitchNowDeg: +THREE.MathUtils.radToDeg(b.group.rotation.x).toFixed(1),
              rollNowDeg: +THREE.MathUtils.radToDeg(b.group.rotation.z).toFixed(1),
              yawNowDeg: +THREE.MathUtils.radToDeg(b.group.rotation.y).toFixed(1),
              lift: +b.lift.toFixed(5),
            };
          }),
        };
      };
      /** 把第 idx 件钉在「完全抬起 / 转正」状态，其余复位（dump 是持续刷新的，无需再触发） */
      w.__NSPOKE = (idx: number) => {
        hoverItems.forEach((b, i) => {
          b.target = i === idx ? b.liftAmount : 0;
        });
      };
      /**
       * 第 idx 件在**视口里的投影包围盒**（把包围盒 8 个角投影到屏幕后取 AABB）。
       * 只给中心点不够用：设备在屏幕上只有几十像素，裁切框稍偏就拍不到，
       * 给整个投影矩形才能精确裁切放大。
       */
      w.__NSAT = (idx: number) => {
        const b = hoverItems[idx];
        if (!b) return null;
        const bb = new THREE.Box3().setFromObject(b.group);
        const r = renderer.domElement.getBoundingClientRect();
        const v = new THREE.Vector3();
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < 8; i++) {
          v.set(
            i & 1 ? bb.max.x : bb.min.x,
            i & 2 ? bb.max.y : bb.min.y,
            i & 4 ? bb.max.z : bb.min.z,
          ).project(camera);
          const px = r.left + ((v.x + 1) / 2) * r.width;
          const py = r.top + ((1 - v.y) / 2) * r.height;
          x0 = Math.min(x0, px);
          x1 = Math.max(x1, px);
          y0 = Math.min(y0, py);
          y1 = Math.max(y1, py);
        }
        return {
          x: Math.round((x0 + x1) / 2),
          y: Math.round((y0 + y1) / 2),
          x0: Math.round(x0),
          y0: Math.round(y0),
          x1: Math.round(x1),
          y1: Math.round(y1),
          w: Math.round(x1 - x0),
          h: Math.round(y1 - y0),
        };
      };
      /**
       * 运行时把第 idx 件绕 Y 转到指定角度 —— 只用于**确定模型正面朝哪边**：
       * 转 0/90/180/270 各截一张图，看哪一面是屏幕。
       * 不写 rotation.x/z，因此不会被 updateHover 每帧覆盖。
       */
      w.__NSYAW = (idx: number, deg: number) => {
        const b = hoverItems[idx];
        if (!b) return null;
        b.group.rotation.y = THREE.MathUtils.degToRad(deg);
        return +THREE.MathUtils.radToDeg(b.group.rotation.y).toFixed(1);
      };
      /**
       * 第 idx 件的**正面法线**在世界空间的方向（用 DEVICE_SLOTS.frontAxis 换算）。
       * 相机在 +Z 看向原点 → 「正面朝镜头」等价于 front.z 接近 +1。
       * 这把「朝向对不对」从肉眼看图变成了可断言的数值。
       */
      w.__NSFRONT = (idx: number) => {
        const b = hoverItems[idx];
        const ax = b ? frontAxisOf(b.label) : undefined;
        if (!b || !ax) return null;
        const v = new THREE.Vector3(ax[0], ax[1], ax[2])
          .applyQuaternion(b.group.getWorldQuaternion(new THREE.Quaternion()))
          .normalize();
        return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
      };
      /**
       * ⚠️ 必须**持续**刷新，不能 dump 一次就 clearInterval。
       * 踩过的坑：最初只在「物件数量到齐」时 dump 一次，之后 `window.__NSFIT` 永远是
       * 加载那一刻的快照（lift 恒为 0）—— 于是悬停看起来"完全没生效"，
       * 而其实 `canvas.style.cursor` 已经变成 pointer（拾取是好的），
       * 差点去改一段本来正确的悬停代码。测量快照必须是活的。
       * 每次 dump 只有 6 次 setFromObject，5Hz 的开销可以忽略。
       */
      /**
       * 运行时设置某件的静止姿态（单位：度）。**仅用于离线扫描**「怎么摆才看得见某个面」——
       * 相机位置是固定的，而顶层搁板比镜头高 0.46（世界坐标），视线是**从下往上看**，
       * 所以平放的顶面（比如 DVD 的光盘位）天然看不见。要给某件单独找到一个
       * 「既能看见正面、又能看见顶面」的姿态，靠手算欧拉角很费劲，扫一遍最快。
       * 同时写入 restPitch/restRoll，避免 updateHover 的缓动把它覆盖掉。
       */
      w.__NSPOSE = (idx: number, pitch: number, yaw: number, roll: number, dz = 0) => {
        const b = hoverItems[idx];
        if (!b) return null;
        b.restPitch = THREE.MathUtils.degToRad(pitch);
        b.restRoll = THREE.MathUtils.degToRad(roll);
        b.baseZ += dz;
        b.group.rotation.set(b.restPitch, THREE.MathUtils.degToRad(yaw), b.restRoll);
        b.group.position.z = b.baseZ;
        return { pitch, yaw, roll, dz };
      };
      fitTimer = window.setInterval(() => {
        if (hoverItems.length >= expected) {
          dump();
          w.__NSREADY = true;
        }
      }, 200);
    }

    /* Raycaster：命中某件物件（书 / 设备）→ 返回它的 group（用于 hover 抬起+放大+立正） */
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitsItem = (clientX: number, clientY: number): THREE.Group | null => {
      if (!hoverItems.length) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0) return null;
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(
        hoverItems.map((b) => b.group),
        true,
      );
      if (!hits.length) return null;
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !hoverItems.some((b) => b.group === o)) o = o.parent;
      return (o as THREE.Group | null) ?? null;
    };

    /* 架子跟随鼠标：不按键，悬停移动时左右/上下小幅度转动；hover 探测同时进行 */
    const rotateState = {
      targetY: 0,
      targetX: 0,
      currentY: 0,
      currentX: 0,
      pointerInside: false,
    };

    const onPointerMove = (e: PointerEvent) => {
      pointerInsideRef.current = true;
      rotateState.pointerInside = true;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1; // [-1,1] 左→右
        const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1; // [-1,1] 上→下
        rotateState.targetY = THREE.MathUtils.clamp(nx * ROTATE_LIMIT_Y, -ROTATE_LIMIT_Y, ROTATE_LIMIT_Y);
        // 鼠标在下方（ny>0）时倾角上限更小
        const limitX = ny > 0 ? ROTATE_LIMIT_X_DOWN : ROTATE_LIMIT_X_UP;
        rotateState.targetX = THREE.MathUtils.clamp(-ny * ROTATE_LIMIT_X_UP, -limitX, limitX);
      }
      const g = hitsItem(e.clientX, e.clientY);
      if (g === hovered) return;
      hovered = g;
      renderer.domElement.style.cursor = g ? 'pointer' : '';
      hoverItems.forEach((b) => {
        b.target = b.group === g ? b.liftAmount : 0;
      });
    };
    const onPointerLeave = () => {
      pointerInsideRef.current = false;
      rotateState.pointerInside = false;
      rotateState.targetY = 0;
      rotateState.targetX = 0;
      resetHover();
    };

    /**
     * 点击架上物件 → 打开对应的作品列表页（2026-09-15）。
     *
     * 用「按下-抬手位移阈值」区分点击与拖选：架子是跟随鼠标转的，
     * 用户在上面划来划去很正常，不能每抬一次手就当一次点击。
     * 阈值 6px 与 WorkProjectPage 左栏的写法一致。
     */
    const downPt = { x: 0, y: 0 };
    const onPointerDown = (e: PointerEvent) => {
      downPt.x = e.clientX;
      downPt.y = e.clientY;
    };
    const onPointerClick = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 6) return; // 是拖，不是点
      const g = hitsItem(e.clientX, e.clientY);
      if (!g) return;
      const item = hoverItems.find((b) => b.group === g);
      if (item) onPickRef.current?.(item.row, item.deviceIndex);
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('click', onPointerClick);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, clock.getDelta());
      // 被落地页盖住（covered）时：跳过 hover/转动/渲染，只留空转 rAF（2026-09-16）。
      // getDelta 照常吃掉时间，恢复时不会因为大 dt 跳帧。
      if (coveredRef.current) return;
      updateHover(dt);
      // 架子跟随鼠标的平滑转动（左右 + 上下）
      if (
        Math.abs(rotateState.currentY - rotateState.targetY) > 1e-5 ||
        Math.abs(rotateState.currentX - rotateState.targetX) > 1e-5
      ) {
        const k = 1 - Math.exp(-10 * dt);
        rotateState.currentY += (rotateState.targetY - rotateState.currentY) * k;
        rotateState.currentX += (rotateState.targetX - rotateState.currentX) * k;
        rackGroup.rotation.y = rotateState.currentY;
        rackGroup.rotation.x = rotateState.currentX;
      }
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (fitTimer) window.clearInterval(fitTimer);
      window.clearTimeout(fitDumpTimer);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('click', onPointerClick);
      observer.disconnect();
      // 环境贴图归 room-env 的 WeakMap 缓存所有，不在这里 dispose
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose?.();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose?.();
        }
      });
      renderer.forceContextLoss();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /* Esc 关闭 */
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 被落地页盖住时 Esc 归上层落地页管（否则一按把书架也关了，跳过「Back 回书架」）
      if (coveredRef.current) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onClose]);

  if (!mounted) return null;

  return (
    <div
      ref={overlayRef}
      className={`newsstand-overlay${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="创作档案 · 报刊亭"
      data-lenis-prevent
    >
      {/* 接触阴影：让展架「踩」在画面底部，不悬浮 */}
      <div className="newsstand-contact" aria-hidden="true" />

      <div className="newsstand-canvas-host" ref={hostRef} />

      {/* 关闭：白圈 ×，置于页面上部正中。
          会与顶部的「作者 / 访客」切换徽标重叠 —— 收尾时那个徽标会整个移除，重叠无妨。 */}
      <button type="button" className="newsstand-close-circle" onClick={onClose} aria-label="关闭创作档案">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
      </button>

      {loading && !failed ? (
        <div className="newsstand-loading" role="status">
          <span className="newsstand-spinner" aria-hidden="true" />
          展架加载中…
        </div>
      ) : null}

      {!loading && !failed ? (
        <p className="newsstand-hint">悬停物件 · 点击打开（上层设备 = 视频与音乐，下层档案 = 文案与 AI）</p>
      ) : null}

      {failed ? (
        <div className="newsstand-error" role="status">
          展架模型加载失败，请刷新重试。
        </div>
      ) : null}
    </div>
  );
}
