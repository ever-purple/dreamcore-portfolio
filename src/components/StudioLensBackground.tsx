import { useEffect, useRef } from 'react';
import { LensDistortion } from '@paper-design/shaders-react';

/**
 * Studio 背景 = 两层叠在一起：
 *   ① 底层 `.studio-lens-distort`：LensDistortion 镜头畸变，铺满全屏（吃实时视频帧）
 *   ② 上层 `.studio-lens-clear`：原始循环视频，只用 CSS mask 在鼠标处露出**不规则的
 *      水波区域** → 露出的地方就是「加效果之前的样子」。
 *   两层共用同一个 <video>：视频在上层显示，同时把当前帧喂给下层的 shader，永远同帧同步。
 *
 * ⚠️ 三个坑（都踩过）：
 *  1. LensDistortion 默认 `fit="contain"`。16:9 底图放进 16:10 画面会左右留边、露出酒红底
 *     —— 就是之前那两条红边。这里显式 `fit="cover"` 铺满。
 *  2. **这个库只在上传时读一帧图**（fragment shader 里连 u_time 都没有），`image` 传静态
 *     首帧的话整个画面就"冻住"（木马不转）。所以下面用 rAF 把视频当前帧持续塞进
 *     `u_image` 纹理。注意 `LensDistortion` 是 `memo(function)` 而非 forwardRef，
 *     ref 传不到底层 div，只能靠 DOM 反查挂载实例：`canvas.parentElement.paperShaderMount`。
 *  3. 揭示区域**不能用正圆**（用户明确否决"规则图形"），但也**不能偏长条**
 *     （用户第二轮反馈"形状偏长条、要均匀一点"）。所以 mask 是 5 个软斑叠加
 *     （默认 mask 叠加 = union）：中心一个近圆核心 + 4 个半径相近、绕心距离相近、
 *     但**角间距不均**的外瓣 → 轮廓是不规则的有机形，且各个方向都被撑到、没有主导长轴。
 *     另外还有 2 个**低 alpha 的尾迹瓣**跟着更慢的 `--lens-tx/--lens-ty`，
 *     并沿"主水波→尾迹"方向再往外延一段 → 半清晰的拖尾。
 *     各瓣再由 CSS 关键帧缓慢漂移（`lens-drift-*`）→ 边界持续变形，有流动感。
 *     见 index.css 的 `.studio-lens-clear`。
 *
 * 拖尾：target → cur（主水波，弹簧-阻尼 ~0.25s 到位）→ trail（尾迹 ~0.47s 到位）。
 * 之前用 `cur += (target - cur) * 0.18` 约 0.05s 就到位，等于没有拖尾 —— 用户反馈"拖尾感不明显"。
 *
 * 调试：`?lensreveal=0.17,0.5` 把水波钉在指定位置（归一化坐标），方便无头截图看揭示效果。
 */
export function StudioLensBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  /* ---------------- 鼠标水波揭示：位置 + 半径 + 拖尾 ---------------- */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    /**
     * 三级跟随，形成「水」的拖尾：
     *   target（鼠标）→ cur（主水波，弹簧-阻尼）→ trail（尾迹，再迟一步）
     * 用弹簧而不是简单的 `cur += (target - cur) * k`：
     * 指数插值虽然也滞后，但没有惯性、停得"死"，不像水；
     * 弹簧带一点过冲再收住，才有液体的重量感。
     * 参数是数值模拟选出来的（见 HANDOFF/日志）：主水波 ~0.25s 到位、过冲 ~15%；
     * 尾迹 ~0.47s 到位 → 快速甩动鼠标时尾迹明显落在主水波后面。
     */
    const STIFF = 0.022;   // 主水波刚度
    const FRIC = 0.86;     // 主水波阻尼（越小越黏）
    const STIFF_T = 0.008; // 尾迹刚度（越小拖得越长）
    const FRIC_T = 0.9;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const target = { x: 0.5, y: 0.5 };
    const cur = { x: 0.5, y: 0.5 };
    const vel = { x: 0, y: 0 };
    const trail = { x: 0.5, y: 0.5 };
    const tvel = { x: 0, y: 0 };

    const snap = () => {
      cur.x = trail.x = target.x;
      cur.y = trail.y = target.y;
      vel.x = vel.y = tvel.x = tvel.y = 0;
    };

    /** 量化的 CSS 变量写入：值没变就不写（省掉一次全屏 mask 重绘） */
    const last: Record<string, string> = {};
    const push = (name: string, v: number) => {
      const s = `${(Math.round(v * 25) / 25).toFixed(3)}%`;
      if (last[name] === s) return;
      last[name] = s;
      root.style.setProperty(name, s);
    };

    // 调试预览：把水波钉在指定位置，省得无头截图里没有鼠标事件
    const revealParam = new URLSearchParams(window.location.search).get('lensreveal');
    if (revealParam !== null) {
      const [px, py] = revealParam.includes(',') ? revealParam.split(',') : ['0.62', '0.54'];
      const fx = Number.parseFloat(px);
      const fy = Number.parseFloat(py);
      target.x = Number.isFinite(fx) ? fx : 0.62;
      target.y = Number.isFinite(fy) ? fy : 0.54;
      snap();
      root.classList.add('is-revealing');
    }

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
      target.x = Math.min(Math.max(nx, 0), 1);
      target.y = Math.min(Math.max(ny, 0), 1);
      // 鼠标在画面内才揭示；移到画面外（顶栏浮层等）就收回
      root.classList.toggle('is-revealing', inside);
    };
    const hide = () => {
      root.classList.remove('is-revealing');
      // 收起时让主水波/尾迹归位到鼠标处，免得下次进入时横穿整个画面
      snap();
    };

    const tick = () => {
      if (reduced) {
        cur.x = target.x;
        cur.y = target.y;
        trail.x = target.x;
        trail.y = target.y;
      } else {
        // 主水波：弹簧-阻尼 + 惯性
        vel.x += (target.x - cur.x) * STIFF;
        vel.y += (target.y - cur.y) * STIFF;
        vel.x *= FRIC;
        vel.y *= FRIC;
        cur.x += vel.x;
        cur.y += vel.y;

        // 尾迹：追的是主水波而不是鼠标 → 稳定地"落在后面"
        tvel.x += (cur.x - trail.x) * STIFF_T;
        tvel.y += (cur.y - trail.y) * STIFF_T;
        tvel.x *= FRIC_T;
        tvel.y *= FRIC_T;
        trail.x += tvel.x;
        trail.y += tvel.y;
      }

      // ⚠️ 只在真的变化时才写 CSS 变量：这几个属性一旦变化，整条 7 层
      // mask-image 都要重新解析 + 重绘。弹簧会无限逼近目标，每帧都产生
      // 极小差值 → 量化到 0.04%（约 0.5px）后，"鼠标静止"就是零开销。
      push('--lens-x', cur.x * 100);
      push('--lens-y', cur.y * 100);
      push('--lens-tx', trail.x * 100);
      push('--lens-ty', trail.y * 100);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', hide);
    document.addEventListener('pointerleave', hide);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', hide);
      document.removeEventListener('pointerleave', hide);
    };
  }, []);

  /* ---------------- 把视频当前帧喂给下面那层 shader（否则画面是静止的） ---------------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let raf = 0;
    let last = 0;

    // ShaderMount 实例挂在 shader 宿主 div 上（canvas.parentElement.paperShaderMount）。
    const resolveMount = (): { setTextureUniform: (n: string, img: unknown) => void } | null => {
      const host = rootRef.current?.querySelector('.studio-lens-distort canvas')?.parentElement;
      const m = (host as unknown as { paperShaderMount?: unknown } | null | undefined)?.paperShaderMount;
      return (m as { setTextureUniform: (n: string, img: unknown) => void } | undefined) ?? null;
    };

    // setTextureUniform 在 TS 里标了 private（运行时可用）。它要求传入对象带
    // complete / naturalWidth / naturalHeight —— 视频元素没有，这里按帧补上；
    // texImage2D 本身是接受 <video> 作为纹理源的。
    const pushFrame = () => {
      if (!video.videoWidth) return;
      const mount = resolveMount();
      if (!mount) return;

      const fake = video as unknown as {
        complete: boolean;
        naturalWidth: number;
        naturalHeight: number;
      };
      fake.complete = true;
      fake.naturalWidth = video.videoWidth;
      fake.naturalHeight = video.videoHeight;

      try {
        mount.setTextureUniform('u_image', video);
      } catch {
        /* 视频还没出帧，跳过这一帧 */
      }
    };

    const tick = (now: number) => {
      // 视频 24fps，纹理重上传不必跑满 60fps
      if (now - last > 33) {
        last = now;
        pushFrame();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // 有备无患：某些情况下 autoPlay 属性没能真的播起来，显式拉一把
    // （muted + playsInline 的自动播放是被允许的，失败也不会抛到外面）
    const kick = () => {
      const p = video.play();
      if (p) p.catch(() => {});
    };
    kick();
    video.addEventListener('canplay', kick);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('canplay', kick);
    };
  }, []);

  return (
    <div ref={rootRef} className="studio-lens-root">
      {/* ① 底层：镜头畸变，全屏，吃实时视频帧 */}
      <div className="studio-lens-distort">
        <LensDistortion
          speed={-0.3}
          spread={0.19}
          bias={0}
          angle={0}
          perspective={1}
          count={8}
          dispersion={1}
          dispersionShift={0}
          dispersionColor={0.6}
          focusCenter={0.8}
          focusEdges={1}
          swirl={0.35}
          noise={0}
          noiseFrequency={0.25}
          noiseOffset={0}
          lensBulge={0}
          lensCircle={0}
          grainMixer={0}
          grainOverlay={0}
          imageX={0}
          imageY={0}
          fit="cover"
          image="/studio/studio-poster.jpg"
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* ② 上层：清晰原视频。mask 只在不规则水波范围内不透明 → 其余地方透出下层畸变 */}
      <div className="studio-lens-clear">
        <video
          ref={videoRef}
          className="studio-lens-video"
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
    </div>
  );
}
