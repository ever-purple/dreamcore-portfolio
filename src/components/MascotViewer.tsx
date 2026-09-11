import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type MascotHandle = {
  /** 挥手打招呼（整体摆动，非骨骼动作） */
  wave: () => void;
  /** 蹦跳一下（整体起跳 + 挤压） */
  jump: (power?: number) => void;
  /** 被拎着拖动时的即时速度，用于身体倾斜 */
  setCarry: (vx: number, vy: number) => void;
};

type Props = {
  /** glb 地址 */
  src?: string;
  /** 模型加载完成（用于父层淡入） */
  onReady?: () => void;
  className?: string;
};

/** 相机竖直 FOV */
const FOV = 26;
/** 归一化后模型高度 = 1，画面留出的取景高度 */
const FIT_HEIGHT = 1.18;
/** 动作时长（毫秒） */
const WAVE_MS = 1900;
const JUMP_MS = 1250;

/**
 * 3D 小人：把压缩后的 mascot.glb（843KB）画在透明 canvas 上。
 * - 只有 About 浮层打开时才加载 three 与模型（父层用 React.lazy 分包）
 * - 自动取景：模型缩放到高度 1、脚底贴 y=0，相机按高度取景
 * - 常态微动：缓慢摇晃 + 上下呼吸 + 跟随鼠标小幅转头
 * - 通过 ref 触发 wave / jump / setCarry（模型无骨骼，全部是整体位移与形变）
 * - 卸载时彻底 dispose（含强制释放 WebGL context），避免上下文泄漏
 */
export const MascotViewer = forwardRef<MascotHandle, Props>(function MascotViewer(
  { src = '/about/mascot.glb', onReady, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // 动作状态（用 ref 以免触发 React 重渲染）
  const actionRef = useRef({ kind: 'idle' as 'idle' | 'wave' | 'jump', t0: 0, power: 1 });
  const carryRef = useRef({ vx: 0, vy: 0 });
  const hoverRef = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      wave: () => {
        actionRef.current = { kind: 'wave', t0: performance.now(), power: 1 };
      },
      jump: (power = 1) => {
        actionRef.current = { kind: 'jump', t0: performance.now(), power };
      },
      setCarry: (vx: number, vy: number) => {
        carryRef.current = { vx, vy };
      },
    }),
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setFailed(true);
      return;
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.pointerEvents = 'none'; // 指针事件交给外层容器（拖动）
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);
    const cameraY = FIT_HEIGHT * 0.5;
    const distance = cameraY / Math.tan((FOV * Math.PI) / 360);
    camera.position.set(0, cameraY, distance);
    camera.lookAt(0, cameraY, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.45;

    const hemi = new THREE.HemisphereLight(0xffffff, 0xd2e4c6, 1.15);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e2, 2.6);
    key.position.set(1.5, 2.6, 2.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe9ff, 1.0);
    rim.position.set(-2.0, 1.6, -1.8);
    scene.add(rim);

    const group = new THREE.Group();
    group.position.y = cameraY;
    scene.add(group);
    // motion 承载所有动作（摇晃/呼吸/挥手/蹦跳），不影响取景基准
    const motion = new THREE.Group();
    group.add(motion);

    let disposed = false;
    let ready = false;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      src,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const scale = 1 / (size.y || 1);
        model.scale.setScalar(scale);
        // 水平居中、脚底对齐 motion 局部的 y = -FIT_HEIGHT/2
        model.position.set(
          -center.x * scale,
          -box.min.y * scale - FIT_HEIGHT * 0.5,
          -center.z * scale,
        );
        model.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.frustumCulled = false;
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat) mat.envMapIntensity = 0.6;
          }
        });
        motion.add(model);
        ready = true;
        onReady?.();
      },
      undefined,
      () => {
        if (!disposed) setFailed(true);
      },
    );

    // 鼠标横向位置 → 小幅转头
    let pointer = 0;
    let eased = 0;
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0) return;
      pointer = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    };
    window.addEventListener('pointermove', onPointerMove);

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

    const clock = new THREE.Clock();
    let carryX = 0;
    let carryY = 0;
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const now = performance.now();

      // 拖动惯性（松手后回正）
      carryX += (carryRef.current.vx - carryX) * 0.25;
      carryY += (carryRef.current.vy - carryY) * 0.25;
      carryRef.current.vx *= 0.9;
      carryRef.current.vy *= 0.9;

      eased += (pointer - eased) * 0.06;

      let rotX = 0;
      let rotY = Math.sin(t * 0.45) * 0.1 + eased * 0.42;
      let rotZ = Math.sin(t * 0.33) * 0.018;
      let posY = Math.sin(t * 0.9) * 0.012;
      let scaleY = 1;
      let scaleXZ = 1;

      const action = actionRef.current;
      if (action.kind === 'wave') {
        const p = (now - action.t0) / WAVE_MS;
        if (p >= 1) {
          actionRef.current = { kind: 'idle', t0: 0, power: 1 };
        } else {
          const damp = 1 - p * 0.25;
          // 快速左右摆动 + 轻微侧倾，读起来像在挥手打招呼
          rotY += Math.sin(p * Math.PI * 6) * 0.38 * damp;
          rotZ += Math.sin(p * Math.PI * 6 + 0.6) * 0.1 * damp;
          posY += Math.sin(p * Math.PI) * 0.03;
        }
      } else if (action.kind === 'jump') {
        const p = (now - action.t0) / JUMP_MS;
        if (p >= 1) {
          actionRef.current = { kind: 'idle', t0: 0, power: 1 };
        } else {
          const power = action.power;
          const air = Math.sin(Math.min(1, p) * Math.PI);
          // 起跳前蓄力下压 → 腾空 → 落地回弹
          const crouch = p < 0.16 ? Math.sin((p / 0.16) * Math.PI * 0.5) * 0.1 : 0;
          const land = p > 0.78 ? Math.sin(((p - 0.78) / 0.22) * Math.PI) * 0.08 : 0;
          const squash = crouch + land;
          posY += air * 0.34 * power;
          scaleY = 1 - squash + air * 0.06;
          scaleXZ = 1 + squash * 0.6 - air * 0.03;
          rotX += air * 0.1;
        }
      }

      // 被拖动时：身体随移动方向倾斜 + 轻微拉伸
      const speed = Math.hypot(carryX, carryY);
      if (speed > 0.5) {
        const k = Math.min(1, speed / 26);
        rotZ += THREE.MathUtils.clamp(-carryX * 0.012, -0.28, 0.28) * k;
        rotX += THREE.MathUtils.clamp(carryY * 0.009, -0.22, 0.22) * k;
        scaleY += 0.03 * k;
        scaleXZ -= 0.015 * k;
      }

      // 悬停时略微抬头看你
      if (hoverRef.current > 0) rotX -= hoverRef.current * 0.05;

      if (reduce) {
        motion.rotation.set(0, eased * 0.4, 0);
        motion.position.y = 0;
        motion.scale.set(1, 1, 1);
      } else {
        motion.rotation.set(rotX, rotY, rotZ);
        motion.position.y = posY;
        motion.scale.set(scaleXZ, scaleY, scaleXZ);
      }
      if (ready) renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if (!m) return;
          const mat = m as THREE.MeshStandardMaterial;
          mat.map?.dispose();
          mat.normalMap?.dispose();
          mat.roughnessMap?.dispose();
          mat.metalnessMap?.dispose();
          mat.dispose();
        });
      });
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [src, onReady]);

  return (
    <div
      className={`about-mascot ${className ?? ''}`}
      ref={hostRef}
      onPointerEnter={() => {
        hoverRef.current = 1;
      }}
      onPointerLeave={() => {
        hoverRef.current = 0;
      }}
      aria-hidden="true"
    >
      {failed && <p className="about-mascot-fail">3D 模型加载失败</p>}
    </div>
  );
});
