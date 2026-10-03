import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdmin } from '@/context/AdminContext';
import {
  createCarousel,
  type CarouselAPI,
  type SlotFace,
} from '@/lib/carousel/carousel-scene';
import {
  HANG_PATTERN,
  hasDiskOverride,
  rawSeedProject,
  seedProjects,
  type ProjectState,
} from '@/data/works';
import { WORK_OVERRIDES, type WorkOverride } from '@/data/works.local';
import {
  isPortableUrl,
  probeWriter,
  saveOverridesToDisk,
  uploadAsset,
} from '@/lib/carousel/works-editor-api';
import {
  WorkDetail,
  type ProjectDraft,
  type SaveOutcome,
} from '@/components/WorkDetail';
import { WorkProjectPage } from '@/components/WorkProjectPage';
import { WorksWheel, type WorksWheelHandle, type WheelOrigin } from '@/components/WorksWheel';
import {
  clearProjectLocally,
  objectUrl,
  readSavedProjects,
  revokeAllUrls,
  saveProjectLocally,
  type SavedProject,
} from '@/lib/carousel/project-storage';
import { StudioChrome } from '@/components/StudioChrome';
import { useEscape } from '@/lib/escape-stack';

type Props = {
  open: boolean;
  onClose: () => void;
  initialActive?: number | null;
  returnToQuickOnDetailClose?: boolean;
};

/**
 * 木马策划案浮层：点工作室里的旋转木马物件后**在站内**原地展开。
 *
 * 3D 是 carousel-lamp 的真实场景代码（src/lib/carousel/），这里只管
 * 生命周期、键盘、槽位兜底 UI、项目提交与详情面板。
 *
 * 展示模式：左字右图 + 高光图，淘汰完整 PDF 查看器。
 */
export function WorksCarousel({ open, onClose, initialActive = null, returnToQuickOnDetailClose = false }: Props) {
  // 作者 / 访客模式来自全局上下文 —— 与 Green OS / About 页共用同一个开关
  const isAdmin = useAdmin();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [localDataReady, setLocalDataReady] = useState(false);
  /**
   * 运行时覆盖表 = 代码文件里的 `WORK_OVERRIDES` ⊕ 本会话里刚保存的改动。
   *
   * 两个用途：
   *  1. 保存接口每次都发完整的一份，若直接拿模块常量再拼，同一页面里连存两个槽位
   *     就会把前一次写的内容抹掉 —— 所以这里记住累积结果；
   *  2. 保存完模块常量还是旧的（要等 HMR 重载才刷新），运行时也得认这一份，
   *     否则"存完 → 关掉浮层 → 再打开"就看不到自己刚写的内容。
   */
  const diskOverridesRef = useRef<Record<string, WorkOverride>>(WORK_OVERRIDES);
  const [projects, setProjects] = useState<ProjectState[]>(() =>
    seedProjects(diskOverridesRef.current),
  );
  const [active, setActive] = useState<number | null>(() => {
    if (initialActive !== null && initialActive >= 0 && initialActive < projects.length) {
      return initialActive;
    }
    /**
     * ?wkp=N —— 无头/调试参数，直接预览第 N 个项目的整屏详情页。
     * 跟 ?about / ?greenos / ?diary / ?works / ?media / ?copy 一脉相承：省下起 3D 木马 +
     * 走到正中央 + 点那一格的交互，专给回归脚本和无头截图用。
     */
    const params = new URLSearchParams(window.location.search);
    const v = params.get('wkp');
    if (v !== null) {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  });
  /**
   * 正在编辑 / 提交的槽位（仅作者模式）。
   * 阅读这件事已经交给 WorkProjectPage（整屏详情页），
   * WorkDetail 现在只在「编辑 / 提交」时出场，不再承担浏览。
   */
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [submitMode, setSubmitMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<CarouselAPI | null>(null);
  const wheelRef = useRef<WorksWheelHandle>(null);
  /**
   * 共享元素（FLIP）的起点：详情页从轨道里这张封面长开、也缩回它身上。
   * 存 { slot, origin } 而不是裸的 origin —— 详情页内部还能「下一个项目」，
   * 换过项目之后必须缩回**新的**那一张，不能拿旧槽位的封面。
   */
  const [flipOrigin, setFlipOrigin] = useState<{ slot: number; origin: WheelOrigin | null } | null>(
    null,
  );
  /** 本机提交的原始 Blob（图片 / PDF），保存时"没换文件就沿用旧的"。 */
  const rawRef = useRef<Map<number, SavedProject>>(new Map());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const syncedFacesRef = useRef<string[]>([]);

  /* 入场 / 退场 */
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

  /* 打开时把本机提交的项目读回来，盖到种子内容上（cover 由 ensureCovers 异步渲染） */
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    const base = seedProjects(diskOverridesRef.current);
    readSavedProjects()
      .then((saved) => {
        if (cancelled) return;
        const map = new Map<number, SavedProject>();
        saved.forEach((p) => {
          if (!p || p.slot < 0 || p.slot >= base.length || !p.filled) return;
          /**
           * 已经被写进代码文件（works.local.ts）的槽位以「代码」为准，
           * 跳过浏览器里的旧副本 —— 否则以前存在 IndexedDB 的内容会一直遮住代码。
           */
          if (hasDiskOverride(p.slot, diskOverridesRef.current)) return;
          map.set(p.slot, p);
          base[p.slot] = {
            slot: p.slot,
            code: p.code || base[p.slot].code,
            title: p.title || base[p.slot].title,
            role: p.role ?? base[p.slot].role,
            client: p.client ?? base[p.slot].client,
            year: p.year ?? base[p.slot].year,
            summary: p.summary ?? '',
            tags: p.tags ?? '',
            cover: p.image ? objectUrl(`img-${p.slot}`, p.image) : base[p.slot].cover,
            pdf: p.pdf ? objectUrl(`pdf-${p.slot}`, p.pdf) : base[p.slot].pdf,
            pdfName: p.pdfName ?? '',
            highlightPage: base[p.slot].highlightPage,
            sections: p.sections?.length ? p.sections : base[p.slot].sections,
            link: base[p.slot].link,
            filled: true,
          };
        });
        rawRef.current = map;
        setProjects(base);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLocalDataReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  useEffect(() => () => revokeAllUrls(), []);

  /* 建场景 / 彻底销毁 */
  useEffect(() => {
    if (!mounted) return;
    const host = hostRef.current;
    if (!host) return;
    const faces: SlotFace[] = projectsRef.current.map((p) => ({
      code: p.code,
      title: p.filled ? p.title : '待提交项目',
      cover: p.cover,
    }));
    const api = createCarousel(host, {
      pattern: HANG_PATTERN,
      faces,
      onPick: (i) => pickRef.current(i),
      // 放大看图时双击同一张（提交模式下单击）→ 提交模式进表单，否则进整屏详情页
      onDetail: (i) => {
        activeRef.current = i;
        /* 从 3D 相框双击进来没有 DOM 里的缩略图可当共享元素 → 清掉，
           详情页退回整页淡入（别拿上一次那条轨道的封面瞎起飞）。 */
        setFlipOrigin(null);
        if (submitModeRef.current) setEditingSlot(i);
        else setActive(i);
      },
      // ⚠️ 这里读 ref 不读 state：createCarousel 只跑一次，闭包里的 state 永远是
      // 创建时的旧值（曾经因此让"点空白回全景"整个失效）。
      onMissPick: () => {
        if (focusedRef.current !== null || activeRef.current !== null || submitModeRef.current) {
          setActive(null);
          setSubmitMode(false);
          apiRef.current?.selectMode(false);
          apiRef.current?.reset();
          setFocused(null);
        }
      },
      onError: setError,
    });
    api.rotate(true);
    apiRef.current = api;
    /* 场景 API 暴露到 window（仅 dev）：回归脚本要模拟「聚焦相框 → 单击进内页」，
       需要能调 focus/reset 而不依赖 three.js 的像素级 raycast 命中。 */
    if (import.meta.env.DEV) (window as unknown as { __wkpCarousel?: CarouselAPI }).__wkpCarousel = api;
    // 场景建出来时相框一律是"占位卡"（解码是异步的）。已有 cover 先补上。
    projectsRef.current.forEach((p, i) => {
      const title = p.filled ? p.title : '待提交项目';
      syncedFacesRef.current[i] = `${p.code}|${title}|${p.cover ?? ''}`;
      if (p.cover) api.setFace(i, { code: p.code, title, cover: p.cover });
    });
    return () => {
      api.dispose();
      apiRef.current = null;
      syncedFacesRef.current = [];
      if (import.meta.env.DEV) delete (window as unknown as { __wkpCarousel?: CarouselAPI }).__wkpCarousel;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /* IndexedDB / 编辑结果只增量更新相框，不再为了数据变化销毁并重建整个 3D 场景。 */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    projects.forEach((p, i) => {
      const title = p.filled ? p.title : '待提交项目';
      const key = `${p.code}|${title}|${p.cover ?? ''}`;
      if (syncedFacesRef.current[i] === key) return;
      syncedFacesRef.current[i] = key;
      api.setFace(i, { code: p.code, title, cover: p.cover });
    });
  }, [projects]);

  /* 把「只有 PDF、没有 cover」的项目渲染出高光图（deck 首页 / 上传图），
     同时回填 3D 相框封面。seed 的 deck 是 58MB，一次性拉取后浏览器会缓存。 */
  useEffect(() => {
    if (!localDataReady) return;
    let cancelled = false;
    (async () => {
      const { pdfThumbUrl } = await import('@/lib/carousel/pdf-cover');
      for (const p of projectsRef.current) {
        if (cancelled) return;
        if (p.cover) continue;
        const raw = rawRef.current.get(p.slot);
        const source: Blob | string | null = raw?.image ?? p.pdf ?? null;
        if (!source) continue;
        const url = await pdfThumbUrl(source, `slot-${p.slot}`, p.highlightPage ?? 1);
        if (url && !cancelled) {
          setProjects((prev) => prev.map((x) => (x.slot === p.slot ? { ...x, cover: url } : x)));
          apiRef.current?.setFace(p.slot, { code: p.code, title: p.title, cover: url });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localDataReady]);

  const focusedRef = useRef<number | null>(null);
  const activeRef = useRef<number | null>(null);
  const submitModeRef = useRef(false);

  /**
   * 场景里点中相框 → 内部 focus() 会回调这里（onPick 与相机飞近走同一条路）。
   * 所以这里**不能**再调 focus，否则会无限递归。
   *
   * 交互约定（2026-09-14 起）：
   *  · 单击相框 → 镜头飞近放大
   *  · 放大状态下点**任何地方**（空白 / 别的相框 / 这张图本身）→ 回全景
   *  · 放大状态下**双击**同一张 → 打开详情面板（场景 onDetail 回调）
   *  · 提交模式下放大后**单击**同一张 → 直接打开详情（forceEdit）
   * 这里用 ref 而不是 state，因为 onPick 是从 three.js 同步回调进来的，
   * React 18 的自动批处理会让两次相邻点击看到同一个闭包值。
   */
  const handlePick = useCallback((i: number) => {
    if (i < 0) {
      focusedRef.current = null;
      activeRef.current = null;
      setFocused(null);
      setActive(null);
      return;
    }
    // 聚焦相框时暂停旋转（镜头要停在相框正面）；回到全景由场景 reset() 恢复
    apiRef.current?.rotate(false);
    focusedRef.current = i;
    setFocused(i);
  }, []);
  useEffect(() => { focusedRef.current = focused; }, [focused]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { submitModeRef.current = submitMode; }, [submitMode]);

  /* 详情页（WorkProjectPage）整屏不透明地盖在木马上时，暂停 GL 渲染循环（2026-09-15）：
     背后那个 three.js 场景每帧都在算风场/弹簧/投影，肉眼却完全看不见 —— 实测详情页
     滚动掉帧主要就是它在抢主线程与 GPU。延迟 0.9s 再停：入场过渡（FLIP/淡入 ~0.7s）
     期间木马还要在底下飞近，立刻停会让过渡期间背景冻住。关闭时立即恢复。 */
  const wkpOpen = active !== null && editingSlot === null;
  useEffect(() => {
    if (!wkpOpen) {
      apiRef.current?.setPaused(false);
      return;
    }
    const t = window.setTimeout(() => apiRef.current?.setPaused(true), 900);
    return () => window.clearTimeout(t);
  }, [wkpOpen]);
  const pickRef = useRef(handlePick);
  pickRef.current = handlePick;

  const resetView = useCallback(() => {
    apiRef.current?.reset();
    apiRef.current?.rotate(true);
    setFocused(null);
    setActive(null);
  }, []);

  /* Esc：详情页 / 编辑表单开着时由它们自己吃（它们后挂 = 在栈顶，见 @/lib/escape-stack）；
     这里只管"聚焦中"和"直接关"两种态。 */
  useEscape(() => {
    if (active !== null) {
      setActive(null);
      return;
    }
    if (focused !== null) {
      resetView();
      return;
    }
    onClose();
  }, mounted);

  /**
   * 保存一个槽位。两条路线，按"有没有写入代码的通道"分：
   *
   *  A. `vite dev` 下（`/__studio/ping` 探活成功）→ **写回源码文件**。
   *     图片 / PDF 先经 `/__studio/upload` 落成 `public/works/editor/` 里的实体文件，
   *     拿到 `/works/editor/xxx.jpg` 这种站内地址后才写进 `src/data/works.local.ts`。
   *     这样刷新、换端口、换浏览器、重新构建部署都还在，也能被 git 记录。
   *     ⚠️ 绝不能把 `blob:` 写进代码文件 —— 那是当前页面会话才有效的地址。
   *
   *  B. 没有通道（看的是构建产物 / 线上）→ 退回原来的 IndexedDB 方案，
   *     保存后明确提示"只存在本浏览器"，不让人误以为已经落盘。
   *
   * 失败时**抛错**，由 WorkDetail 就地显示原因（以前是静默失败，最坑人）。
   */
  const save = useCallback(
    async (slot: number, draft: ProjectDraft): Promise<SaveOutcome> => {
      const seed = rawSeedProject(slot);
      const current = projectsRef.current[slot];
      const raw = rawRef.current.get(slot);

      const title = draft.title.trim() || seed.title;
      const role = draft.role.trim();
      const year = draft.year.trim();
      const tagList = draft.tags.split(/\s+/).filter(Boolean);
      const sections = draft.sections;

      /* "没换文件就沿用上次传的"—— 新传 > 显式移除 > 沿用已存 */
      const imageBlob = draft.image
        ? draft.image
        : draft.removeImage
          ? null
          : (raw?.image ?? null);
      const pdfBlob = draft.pdf
        ? draft.pdf
        : draft.removePdf
          ? null
          : (raw?.pdf ?? null);

      /* ==================== 路线 A：写回代码文件 ==================== */
      const writer = await probeWriter();
      if (writer) {
        let coverOverride: string | null | undefined;
        let pdfOverride: string | null | undefined;
        let pdfNameOverride: string | undefined;

        if (draft.image && imageBlob) {
          const url = await uploadAsset(slot, 'cover', imageBlob);
          if (!url) throw new Error('封面图上传失败，本次没有写入代码文件。');
          coverOverride = url;
        } else if (draft.removeImage) {
          coverOverride = null;
        } else if (imageBlob && !isPortableUrl(current?.cover)) {
          /* 以前只存在浏览器里的图（blob:）→ 顺手转成站内实体文件，否则一刷新就丢 */
          const url = await uploadAsset(slot, 'cover', imageBlob);
          if (url) coverOverride = url;
        }
        /* 其余情况不动 cover：留空即"沿用种子里的封面"，覆盖表保持精简 */

        if (draft.pdf && pdfBlob) {
          const url = await uploadAsset(slot, 'pdf', pdfBlob);
          if (!url) throw new Error('PDF 上传失败，本次没有写入代码文件。');
          pdfOverride = url;
          pdfNameOverride = draft.pdf.name;
        } else if (draft.removePdf) {
          pdfOverride = null;
          pdfNameOverride = '';
        } else if (pdfBlob && !isPortableUrl(current?.pdf)) {
          const url = await uploadAsset(slot, 'pdf', pdfBlob);
          if (url) {
            pdfOverride = url;
            if (raw?.pdfName) pdfNameOverride = raw.pdfName;
          }
        }

        /* 拿"累积的覆盖表 + 本次改动"拼出完整一份发过去（服务端整份重写） */
        const nextSlots: Record<string, WorkOverride> = { ...diskOverridesRef.current };
        const override: WorkOverride = {
          ...nextSlots[String(slot)],
          title,
          role,
          year,
          summary: draft.summary,
          tags: tagList,
          sections,
        };
        if (coverOverride !== undefined) override.cover = coverOverride;
        if (pdfOverride !== undefined) override.pdf = pdfOverride;
        if (pdfNameOverride !== undefined) override.pdfName = pdfNameOverride;
        nextSlots[String(slot)] = override;

        await saveOverridesToDisk(nextSlots);
        diskOverridesRef.current = nextSlots;

        /* 代码已经说了算 —— 浏览器里的旧副本清掉，免得两处内容打架 */
        await clearProjectLocally(slot).catch(() => {});
        rawRef.current.delete(slot);

        const nextCover = coverOverride !== undefined ? coverOverride : (current?.cover ?? null);
        const nextPdf = pdfOverride !== undefined ? pdfOverride : (current?.pdf ?? null);

        setProjects((prev) =>
          prev.map((p, i) =>
            i === slot
              ? {
                  ...p,
                  code: seed.code,
                  title,
                  role,
                  year,
                  client: seed.client,
                  summary: draft.summary,
                  tags: draft.tags,
                  cover: nextCover,
                  pdf: nextPdf,
                  pdfName: pdfNameOverride ?? p.pdfName,
                  sections,
                  filled: true,
                }
              : p,
          ),
        );
        void apiRef.current?.setFace(slot, { code: seed.code, title, cover: nextCover });
        return 'code';
      }

      /* ================= 路线 B：只存在本浏览器（兜底） ================= */
      const record: SavedProject = {
        slot,
        code: seed.code,
        title,
        role,
        year,
        client: seed.client,
        summary: draft.summary,
        tags: draft.tags,
        image: imageBlob,
        pdf: pdfBlob,
        pdfName: draft.pdf ? draft.pdf.name : draft.removePdf ? '' : (raw?.pdfName ?? ''),
        sections,
        filled: true,
      };
      await saveProjectLocally(record);
      rawRef.current.set(slot, record);

      // 高光图：优先新上传的图；其次沿用已存的图；否则（seed 无图但有 PDF）渲染 PDF 首页
      let cover: string | null;
      if (draft.image) cover = await (await import('@/lib/carousel/pdf-cover')).pdfThumbUrl(draft.image, `slot-${slot}`);
      else if (draft.removeImage) cover = seed.cover;
      else if (raw?.image) cover = await (await import('@/lib/carousel/pdf-cover')).pdfThumbUrl(raw.image, `slot-${slot}`);
      else if (current?.pdf) cover = await (await import('@/lib/carousel/pdf-cover')).pdfThumbUrl(current.pdf, `slot-${slot}`, current.highlightPage ?? 1);
      else cover = seed.cover;

      const pdfUrl = pdfBlob ? objectUrl(`pdf-${slot}`, pdfBlob) : draft.removePdf ? null : (current?.pdf ?? null);

      setProjects((prev) =>
        prev.map((p, i) =>
          i === slot
            ? {
                ...p,
                title,
                role,
                year,
                client: seed.client,
                summary: draft.summary,
                tags: draft.tags,
                cover,
                pdf: pdfUrl,
                pdfName: record.pdfName,
                sections,
                filled: true,
              }
            : p,
        ),
      );
      void apiRef.current?.setFace(slot, { code: seed.code, title, cover });
      return 'browser';
    },
    [],
  );

  const clearSlot = useCallback(async (slot: number): Promise<SaveOutcome> => {
    await clearProjectLocally(slot);
    rawRef.current.delete(slot);
    objectUrl(`img-${slot}`, null);
    objectUrl(`pdf-${slot}`, null);

    /* 有了写回通道之后，清空也得把代码里的覆盖一并删掉 ——
       否则下次刷新，`seedProjects()` 又会把这份覆盖合回来，像是"没清掉"。 */
    let outcome: SaveOutcome = 'browser';
    const overrides = { ...diskOverridesRef.current };
    if (overrides[String(slot)]) {
      const writer = await probeWriter();
      if (writer) {
        delete overrides[String(slot)];
        await saveOverridesToDisk(overrides);
        diskOverridesRef.current = overrides;
        outcome = 'code';
      }
    }

    const seed = rawSeedProject(slot);
    setProjects((prev) =>
      prev.map((p, i) =>
        i === slot
          ? {
              ...seed,
              slot,
              pdf: seed.pdf,
              cover: seed.cover,
              sections: seed.sections,
              link: p.link,
            }
          : p,
      ),
    );
    void apiRef.current?.setFace(slot, { code: seed.code, title: '待提交项目', cover: seed.cover });
    return outcome;
  }, []);

  if (!mounted) return null;

  // 右侧弧形轨道的景深基准：优先跟随"已聚焦"的相框，其次跟随详情面板打开的那一项
  const dofIndex = focused ?? active;

  return (
    <div
      className={`works-overlay${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="策划档案木马"
      data-lenis-prevent
    >
      <div className="works-canvas-host" ref={hostRef} />

      {/* 统一外壳（第一档改造 ①）：左上「RETURN TO STUDIO」+ 右上「MENU」。
          原来是**右上角**一颗 `关闭 ✕` 胶囊 —— 位置、字族、措辞和别的板块全不一样，
          是"每页像两个站"里最明显的一处。
          「提交项目」是这页独有的作者功能，交给外壳的 extra 槽、排在 MENU 左边。 */}
      <StudioChrome
        label="Return to Studio"
        onBack={onClose}
        tone="light"
        extra={
          isAdmin ? (
            <button
              type="button"
              className={`works-btn${submitMode ? ' is-on' : ''}`}
              onClick={() => {
                const next = !submitMode;
                setSubmitMode(next);
                apiRef.current?.selectMode(next);
              }}
            >
              {submitMode ? '取消提交' : '＋ 提交项目'}
            </button>
          ) : null
        }
      />

      <p className="works-hint">拉动木马上的灯绳 · 开灯 / 关灯</p>

      <p className="works-credit">
        3D 旋转木马移植自{' '}
        <a href="https://github.com/Daria1216/carousel-lamp" target="_blank" rel="noreferrer noopener">
          carousel-lamp
        </a>{' '}
        · 原作者 咕噜蛋Daria（非商业使用许可）
      </p>

      {error ? (
        <div className="works-error" role="status">
          {error}
        </div>
      ) : null}

      {/* 右侧 3D 半圆弧轨道：一次滚轮 / 一次拖拽 = 走一个项目，
          焦点项放大提亮、两侧按景深虚化，方向键同样可以步进。
          点条目 = 打开详情面板 + 错开一帧让相机飞近（与场景 onDetail 同一套去向）。 */}
      <div className="works-wheel-host">
        <WorksWheel
          ref={wheelRef}
          projects={projects}
          focusIndex={dofIndex}
          onCenterChange={() => {}}
          onSelect={(i, origin) => {
            /* origin = 这张封面在**点击那一刻**的屏幕矩形（轨道还没转，
               所以它正是用户眼睛看到的位置）。详情页会从它长开成全屏大图。 */
            setFlipOrigin({ slot: i, origin });
            setFocused(i);
            setActive(i);
            // 先开面板，再用 setTimeout 错开相机飞近：否则 focus() 同步触发的
            // onPick 回调会与刚打开的面板抢状态
            window.setTimeout(() => apiRef.current?.focus(i), 0);
          }}
        />
      </div>

      {/* 点项目 → 整屏详情页（左栏固定 + 右栏滚动纸面）。
          阅读这件事已经完全交给它；原「左字右图」面板只在编辑/提交时出场。 */}
      {active !== null && editingSlot === null ? (
        <WorkProjectPage
          project={projects[active]}
          slots={projects}
          canEdit={isAdmin}
          /* 共享元素：只在这一项确实是「从轨道点进来」的那一项时才给，
             否则（比如从 3D 相框进来）传 null，详情页退回整页淡入。 */
          origin={flipOrigin?.slot === active ? (flipOrigin.origin?.el ?? null) : null}
          originRect={flipOrigin?.slot === active ? (flipOrigin.origin?.rect ?? null) : null}
          onClose={() => {
            if (returnToQuickOnDetailClose) {
              onClose();
              return;
            }
            setActive(null);
            apiRef.current?.reset();
            setFocused(null);
            setFlipOrigin(null);
          }}
          onSwitch={(slot) => {
            setActive(slot);
            setFocused(slot);
            /* 换了项目，共享元素也得换成**这一项**的封面 ——
               关闭时要缩回它身上。关掉之前轨道已经转到位，那时量的位置才准，
               所以这里只把元素挂上，不急着量飞入起点。 */
            const el = wheelRef.current?.coverOf(slot) ?? null;
            setFlipOrigin(el ? { slot, origin: { el, rect: el.getBoundingClientRect() } } : null);
            apiRef.current?.focus(slot);
          }}
          onEdit={isAdmin ? () => setEditingSlot(active) : undefined}
        />
      ) : null}

      {/* 编辑 / 提交表单：作者模式从详情页进来，或点顶栏「提交项目」后挑相框进来 */}
      <WorkDetail
        project={editingSlot === null ? null : projects[editingSlot]}
        totalSlots={projects.length}
        forceEdit
        canEdit={isAdmin}
        onClose={() => {
          setEditingSlot(null);
          setSubmitMode(false);
          apiRef.current?.selectMode(false);
          // 不是从详情页进来的（直接提交模式）→ 回木马全景
          if (active === null) {
            apiRef.current?.reset();
            setFocused(null);
          }
        }}
        onSwitch={(slot) => {
          setEditingSlot(slot);
          setActive(slot);
          setFocused(slot);
          apiRef.current?.focus(slot);
        }}
        onSave={(draft) =>
          editingSlot === null
            ? Promise.resolve<SaveOutcome>('browser')
            : save(editingSlot, draft)
        }
        onClear={() =>
          editingSlot === null
            ? Promise.resolve<SaveOutcome>('browser')
            : clearSlot(editingSlot)
        }
      />
    </div>
  );
}

export default WorksCarousel;
