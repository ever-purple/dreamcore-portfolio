import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdmin } from '@/context/AdminContext';
import {
  createCarousel,
  type CarouselAPI,
  type SlotFace,
} from '@/lib/carousel/carousel-scene';
import {
  HANG_PATTERN,
  seedProjects,
  type ProjectState,
} from '@/data/works';
import { WorkDetail, type ProjectDraft } from '@/components/WorkDetail';
import {
  clearProjectLocally,
  objectUrl,
  readSavedProjects,
  revokeAllUrls,
  saveProjectLocally,
  type SavedProject,
} from '@/lib/carousel/project-storage';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * 木马策划案浮层：点工作室里的旋转木马物件后**在站内**原地展开。
 *
 * 3D 是 carousel-lamp 的真实场景代码（src/lib/carousel/），这里只管
 * 生命周期、键盘、槽位兜底 UI、项目提交与详情面板。
 *
 * 展示模式：左字右图 + 高光图，淘汰完整 PDF 查看器。
 */
export function WorksCarousel({ open, onClose }: Props) {
  // 作者 / 访客模式来自全局上下文 —— 与 Green OS / About 页共用同一个开关
  const isAdmin = useAdmin();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<ProjectState[]>(() => seedProjects());
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(true);
  const [night, setNight] = useState(false);
  const [submitMode, setSubmitMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<CarouselAPI | null>(null);
  /** 本机提交的原始 Blob（图片 / PDF），保存时"没换文件就沿用旧的"。 */
  const rawRef = useRef<Map<number, SavedProject>>(new Map());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

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
    const base = seedProjects();
    readSavedProjects()
      .then((saved) => {
        if (cancelled) return;
        const map = new Map<number, SavedProject>();
        saved.forEach((p) => {
          if (!p || p.slot < 0 || p.slot >= base.length || !p.filled) return;
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
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  useEffect(() => () => revokeAllUrls(), []);

  /* 建场景 / 彻底销毁 */
  useEffect(() => {
    if (!mounted || !hydrated) return;
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
      onMissPick: () => {
        const dirty = focused !== null || active !== null || submitMode;
        if (dirty) {
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
    // 场景建出来时相框一律是"占位卡"（解码是异步的）。已有 cover 先补上。
    projectsRef.current.forEach((p, i) => {
      if (p.cover) api.setFace(i, { code: p.code, title: p.title, cover: p.cover });
    });
    return () => {
      api.dispose();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, hydrated]);

  /* 把「只有 PDF、没有 cover」的项目渲染出高光图（deck 首页 / 上传图），
     同时回填 3D 相框封面。seed 的 deck 是 58MB，一次性拉取后浏览器会缓存。 */
  useEffect(() => {
    if (!hydrated) return;
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
  }, [hydrated]);

  const focusedRef = useRef<number | null>(null);
  const activeRef = useRef<number | null>(null);
  const submitModeRef = useRef(false);

  /**
   * 场景里点中相框 → 内部 focus() 会回调这里；缩略图按钮直接调 api.focus()，
   * 走的是同一条路。所以这里**不能**再调 focus，否则会无限递归。
   *
   * 交互约定：
   *  · 第一次点相框 → 镜头飞近（focus），不弹详情
   *  · 再点同一张封面 → 才打开详情（"再点一下封面"）
   *  · 点了别的相框 → 改聚焦目标，不弹详情
   *  · 点 3D 空白 → 走 onMissPick 回全景
   *
   * 这里用 ref 而不是 state，因为 onPick 是从 three.js 同步回调进来的，
   * React 18 的自动批处理会让两次相邻点击看到同一个闭包值，没法判断"再点一次"。
   */
  const handlePick = useCallback((i: number) => {
    if (i < 0) {
      focusedRef.current = null;
      activeRef.current = null;
      setFocused(null);
      setActive(null);
      return;
    }
    setSpinning(false);
    apiRef.current?.rotate(false);
    if (activeRef.current !== null) return;
    if (focusedRef.current === i && !submitModeRef.current) {
      activeRef.current = i;
      setActive(i);
      return;
    }
    focusedRef.current = i;
    setActive(null);
    setFocused(i);
  }, []);
  useEffect(() => { focusedRef.current = focused; }, [focused]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { submitModeRef.current = submitMode; }, [submitMode]);
  const pickRef = useRef(handlePick);
  pickRef.current = handlePick;

  const resetView = useCallback(() => {
    apiRef.current?.reset();
    apiRef.current?.rotate(true);
    setFocused(null);
    setSpinning(true);
    setActive(null);
  }, []);

  /* Esc：详情开着时由 WorkDetail 捕获并吃掉；这里只处理"聚焦中"和"直接关" */
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (active !== null) {
        setActive(null);
        return;
      }
      if (focused !== null) {
        resetView();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, active, focused, onClose, resetView]);

  const save = useCallback(
    async (slot: number, draft: ProjectDraft) => {
      const seed = seedProjects()[slot];
      const raw = rawRef.current.get(slot);
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

      const record: SavedProject = {
        slot,
        code: seed.code,
        title: draft.title.trim() || seed.title,
        role: draft.role.trim(),
        year: draft.year.trim(),
        client: seed.client,
        summary: draft.summary,
        tags: draft.tags,
        image: imageBlob,
        pdf: pdfBlob,
        pdfName: draft.pdf ? draft.pdf.name : draft.removePdf ? '' : (raw?.pdfName ?? ''),
        sections: draft.sections,
        filled: true,
      };
      await saveProjectLocally(record);
      rawRef.current.set(slot, record);

      // 高光图：优先新上传的图；其次沿用已存的图；否则（seed 无图但有 PDF）渲染 PDF 首页
      let cover: string | null;
      if (draft.image) cover = await (await import('@/lib/carousel/pdf-cover')).pdfThumbUrl(draft.image, `slot-${slot}`);
      else if (draft.removeImage) cover = seed.cover;
      else if (raw?.image) cover = await (await import('@/lib/carousel/pdf-cover')).pdfThumbUrl(raw.image, `slot-${slot}`);
      else if (projects[slot].pdf) cover = await (await import('@/lib/carousel/pdf-cover')).pdfThumbUrl(projects[slot].pdf!, `slot-${slot}`, projects[slot].highlightPage ?? 1);
      else cover = seed.cover;

      const pdfUrl = pdfBlob ? objectUrl(`pdf-${slot}`, pdfBlob) : draft.removePdf ? null : projects[slot].pdf;

      setProjects((prev) =>
        prev.map((p, i) =>
          i === slot
            ? {
                ...p,
                title: record.title,
                role: record.role,
                year: record.year,
                client: record.client,
                summary: record.summary,
                tags: record.tags,
                cover,
                pdf: pdfUrl,
                pdfName: record.pdfName,
                sections: record.sections,
                filled: true,
              }
            : p,
        ),
      );
      void apiRef.current?.setFace(slot, { code: seed.code, title: record.title, cover });
    },
    [projects],
  );

  const clearSlot = useCallback(async (slot: number) => {
    await clearProjectLocally(slot);
    rawRef.current.delete(slot);
    objectUrl(`img-${slot}`, null);
    objectUrl(`pdf-${slot}`, null);
    const seed = seedProjects()[slot];
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
  }, []);

  if (!mounted) return null;

  return (
    <div
      className={`works-overlay${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="策划档案木马"
      data-lenis-prevent
    >
      <div className="works-canvas-host" ref={hostRef} />

      <header className="works-topbar">
        <div />
        <div className="works-actions">
          {isAdmin ? (
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
          ) : null}
          <button
            type="button"
            className="works-btn"
            onClick={() => {
              const next = !spinning;
              apiRef.current?.rotate(next);
              setSpinning(next);
            }}
          >
            {spinning ? '暂停旋转' : '继续旋转'}
          </button>
          <button
            type="button"
            className={`works-btn${night ? ' is-on' : ''}`}
            onClick={() => {
              const next = !night;
              apiRef.current?.light(next);
              setNight(next);
            }}
          >
            {night ? '白天' : '夜灯'}
          </button>
          <button type="button" className="works-btn" onClick={() => apiRef.current?.wind()}>
            来阵风
          </button>
          <button
            type="button"
            className="works-btn"
            onClick={resetView}
            disabled={focused === null}
          >
            回到全景
          </button>
          <button type="button" className="works-btn works-btn-close" onClick={onClose}>
            关闭 ✕
          </button>
        </div>
      </header>

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

      <nav className="works-thumbs" aria-label="策划案槽位">
        {projects.map((p, i) => (
          <button
            key={p.code}
            type="button"
            className={`works-thumb${i === focused ? ' is-active' : ''}`}
            onClick={() => {
              setFocused(i);
              setActive(i);
              // 先开面板，再用 setTimeout 错开相机飞近：否则 focus() 同步触发的
              // onPick → handlePick 会把刚打开的面板 setActive(null) 关掉
              window.setTimeout(() => apiRef.current?.focus(i), 0);
            }}
            aria-pressed={i === focused}
          >
            <span className="works-thumb-cover">
              {p.cover ? (
                <img src={p.cover} alt="" loading="lazy" />
              ) : (
                <span className="works-thumb-empty" aria-hidden="true" />
              )}
            </span>
            <span className="works-thumb-code">{p.code}</span>
            <span className="works-thumb-title">
              {p.filled ? p.title : '待提交'}
            </span>
          </button>
        ))}
      </nav>

      <WorkDetail
        project={active === null ? null : projects[active]}
        totalSlots={projects.length}
        forceEdit={submitMode}
        canEdit={isAdmin}
        onClose={() => {
          setActive(null);
          setSubmitMode(false);
          apiRef.current?.selectMode(false);
          apiRef.current?.reset();
          setFocused(null);
        }}
        onSwitch={(slot) => {
          setActive(slot);
          setFocused(slot);
          apiRef.current?.focus(slot);
        }}
        onSave={(draft) => (active === null ? Promise.resolve() : save(active, draft))}
        onClear={() => (active === null ? Promise.resolve() : clearSlot(active))}
      />
    </div>
  );
}

export default WorksCarousel;
