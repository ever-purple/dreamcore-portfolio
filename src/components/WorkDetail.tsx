import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectState, ProjectSection } from '@/data/works';
import { coverAr } from '@/lib/cover-ar';

export type ProjectSectionDraft = ProjectSection;

export type ProjectDraft = {
  title: string;
  role: string;
  year: string;
  summary: string;
  /** 空格分隔的标签，如 "#TVC #品牌" */
  tags: string;
  /** 结构化展示文案 */
  sections: ProjectSectionDraft[];
  /** 高光图（上传的图片）；null = 不改动 */
  image: File | null;
  /** 显式删掉已存的高光图 */
  removeImage: boolean;
  /** 可选完整 PDF（仅下载） */
  pdf: File | null;
  removePdf: boolean;
};

/**
 * 保存去向。必须让作者一眼分清这两种结果 ——
 *  · `code`    = 已写回 `src/data/works.local.ts`，刷新 / 换端口 / 重新构建都还在；
 *  · `browser` = 没有写入通道（看的是构建产物 / 线上），只存在本浏览器，换环境就没了。
 */
export type SaveOutcome = 'code' | 'browser';

type Props = {
  project: ProjectState | null;
  /** 打开时直接进编辑态（"提交项目"按钮走这条路） */
  forceEdit?: boolean;
  /** 槽位总数：用于左右切换 */
  totalSlots?: number;
  /** 是否允许编辑（作者模式才开，访客只能看） */
  canEdit?: boolean;
  onClose: () => void;
  /** 切换到相邻槽位（mod = -1 / +1） */
  onSwitch?: (slot: number) => void;
  onSave: (draft: ProjectDraft) => Promise<SaveOutcome>;
  onClear: () => Promise<SaveOutcome>;
};

/**
 * 策划案面板：左字右图。
 *
 * 淘汰笨重完整 PDF 查看器，改用「精简高光图 + 结构化文案」：
 *  · 左 = 标题 / 角色 / 年份 / 标签 + 自由结构的 sections（背景·洞察·执行·物料·角色·亮点…）
 *  · 右 = 一张高光图（PDF 首页或上传的图）
 *
 * 用 portal 挂到 body（同 InspLightbox）：木马浮层入场时 opacity 从 0 → 1，
 * opacity < 1 的元素会给 fixed 子元素造出包含块，挂在里面会被锁住。
 * Esc 用**捕获阶段** + stopPropagation —— 否则按一下 Esc 会连整个木马一起关掉。
 */
export function WorkDetail({ project, forceEdit, canEdit = false, totalSlots = 0, onClose, onSwitch, onSave, onClear }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [year, setYear] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const [sections, setSections] = useState<ProjectSectionDraft[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [pdf, setPdf] = useState<File | null>(null);
  const [removePdf, setRemovePdf] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 保存 / 清空失败的原因（以前失败是静默的，用户以为"存上了"其实什么都没发生）。 */
  const [error, setError] = useState<string | null>(null);
  /** 保存 / 清空成功后的去向说明。`warn` = 没写进代码，换环境就丢，得用另一种颜色说清楚。 */
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  /* 换槽位就重置表单：先按当前内容填好，用户改哪算哪 */
  useEffect(() => {
    if (!project) return;
    setTitle(project.title);
    setRole(project.role ?? '');
    setYear(project.year ?? '');
    setSummary(project.summary);
    setTags(project.tags);
    setSections(project.sections.map((s) => ({ ...s })));
    setImage(null);
    setRemoveImage(false);
    setPdf(null);
    setRemovePdf(false);
    setError(null);
    const openEditor = canEdit && (Boolean(forceEdit) || !project.filled);
    setEditing(openEditor);
    closeRef.current?.focus();
  }, [project, forceEdit, canEdit]);

  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      // ← / → 切换策划案；编辑态下避免和文字光标抢键，仅在未聚焦输入元素时生效
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!onSwitch || !totalSlots) return;
        const target = e.target as HTMLElement | null;
        if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
        if (target?.isContentEditable) return;
        e.stopPropagation();
        const next =
          e.key === 'ArrowRight'
            ? (project.slot + 1) % totalSlots
            : (project.slot - 1 + totalSlots) % totalSlots;
        onSwitch(next);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [project, onClose, onSwitch, totalSlots]);

  // 高光图预览地址（编辑态选了新图时）：必须在 early return 之前声明，否则
  // project 为 null 的首帧会少调用一个 hook，触发 React #310。
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  useEffect(() => {
    if (image) {
      const u = URL.createObjectURL(image);
      setImgPreview(u);
      return () => URL.revokeObjectURL(u);
    }
    setImgPreview(null);
  }, [image]);

  /**
   * 换槽位就清掉上一次的提示。
   * 只认 `slot`：保存 / 清空发生在同一个槽位内，会顺带更新 project
   * （对象换了、slot 没换），用 project 当依赖会把刚设好的成功提示一起清掉。
   *
   * 提示**不设自动消失**：保存去向（写进代码 / 只在本浏览器）是要紧信息，
   * 而且是贴在按钮上方的表单内联状态，不是浮出来的吐司，留在那儿直到
   * 用户换槽位、再次保存或关掉面板为止，比"闪几秒就没"清楚得多。
   */
  const slotKey = project?.slot ?? -1;
  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [slotKey]);

  if (!project) return null;

  /** 保存去向 → 人话（`warn` 的语气要明确：没写进代码 = 换环境就没了）。 */
  const noticeFor = (outcome: SaveOutcome, ok: string, warn: string) => ({
    text: outcome === 'code' ? ok : warn,
    tone: (outcome === 'code' ? 'ok' : 'warn') as 'ok' | 'warn',
  });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await onSave({
        title,
        role,
        year,
        summary,
        tags,
        sections: sections.filter((s) => s.heading.trim() || s.body.trim()),
        image,
        removeImage,
        pdf,
        removePdf,
      });
      setImage(null);
      setRemoveImage(false);
      setPdf(null);
      setRemovePdf(false);
      setEditing(false);
      setNotice(
        noticeFor(
          outcome,
          '改动已写入 src/data/works.local.ts —— 刷新 / 换端口 / 重新构建都还在',
          '改动只保存在本浏览器 —— 当前没有写入代码的通道（不是 vite dev），换端口或清缓存就没了',
        ),
      );
    } catch (err) {
      /* 保存失败一定要说出来：写代码文件的通道可能没开、上传可能被拒。
         失败就留在编辑态，用户改过的内容不能丢。 */
      setNotice(null);
      setError(err instanceof Error ? err.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const clearSlot = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await onClear();
      setNotice(
        noticeFor(
          outcome,
          '已清空槽位，并同步删掉代码里的覆盖 —— 刷新后也不会回来',
          '已清空本站的副本（当前没有写入通道，代码文件未改动）',
        ),
      );
      /* 不主动收编辑态：清空后 project 变了，上面那个 effect 会把表单重填成种子内容 */
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : '清空失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const updateSection = (i: number, patch: Partial<ProjectSectionDraft>) =>
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addSection = () =>
    setSections((prev) => [
      ...prev,
      { key: `s${Date.now()}`, heading: '', body: '' },
    ]);
  const removeSection = (i: number) =>
    setSections((prev) => prev.filter((_, idx) => idx !== i));

  const tagList = project.tags.split(/\s+/).filter(Boolean);
  const hasPdf = Boolean(project.pdf) && !removePdf;
  // 编辑时若选了新图，用临时地址预览；否则沿用已存的 cover
  const highlightSrc = imgPreview ?? project.cover;

  return createPortal(
    <div
      className="works-detail"
      role="dialog"
      aria-modal="true"
      aria-label={`策划案：${project.code}`}
      data-lenis-prevent
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="works-panel" key={project.slot}>
        {/* 左右悬浮切换：永远渲染（>=2 槽位）；模态两侧各放一个半透明复古箭头按钮 */}
        {onSwitch && totalSlots > 1 ? (
          <>
            <button
              type="button"
              className="works-side works-side-prev"
              onClick={() => onSwitch((project.slot - 1 + totalSlots) % totalSlots)}
              aria-label={`上一个策划案（${(project.slot - 1 + totalSlots) % totalSlots + 1}/${totalSlots}）`}
            >
              <span className="works-side-arrow">‹</span>
              <span className="works-side-meta">PREV</span>
            </button>
            <button
              type="button"
              className="works-side works-side-next"
              onClick={() => onSwitch((project.slot + 1) % totalSlots)}
              aria-label={`下一个策划案（${(project.slot + 1) % totalSlots + 1}/${totalSlots}）`}
            >
              <span className="works-side-meta">NEXT</span>
              <span className="works-side-arrow">›</span>
            </button>
          </>
        ) : null}

        <header className="works-panel-head">
          <div>
            <span className="works-panel-code">[{project.code}]</span>
            <h3 className="works-panel-title">
              {project.filled ? project.title : '空槽位 · 等待提交'}
            </h3>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="works-panel-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        {editing ? (
          /* ---------------- 编辑态：表单 ---------------- */
          <div className="works-case-form">
            <h4 className="works-sec">{project.filled ? '编辑项目' : '提交项目'}</h4>

            <div className="works-field">
              <label className="works-label" htmlFor="wk-title">项目标题</label>
              <input id="wk-title" className="works-input" value={title}
                placeholder="例：新国潮香氛「观夏」· 夏季营销「隙月」"
                onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="works-row">
              <div className="works-field">
                <label className="works-label" htmlFor="wk-role">项目角色</label>
                <input id="wk-role" className="works-input" value={role}
                  placeholder="例：策略 / 内容 / 视觉叙事" onChange={(e) => setRole(e.target.value)} />
              </div>
              <div className="works-field">
                <label className="works-label" htmlFor="wk-year">年份 / 客户</label>
                <input id="wk-year" className="works-input" value={year}
                  placeholder="例：2026 · 观夏" onChange={(e) => setYear(e.target.value)} />
              </div>
            </div>

            <div className="works-field">
              <label className="works-label" htmlFor="wk-tags">标签</label>
              <input id="wk-tags" className="works-input" value={tags}
                placeholder="#整合营销 #香氛 #情绪价值" onChange={(e) => setTags(e.target.value)} />
            </div>

            <div className="works-field">
              <label className="works-label" htmlFor="wk-summary">一句话摘要</label>
              <textarea id="wk-summary" className="works-textarea works-textarea-sm" value={summary}
                placeholder="一句话说清这个项目要解决什么 / 交付了什么" onChange={(e) => setSummary(e.target.value)} />
            </div>

            <div className="works-field">
              <span className="works-label">高光图（右栏大图）</span>
              <div className="works-file">
                <input type="file" accept="image/*"
                  onChange={(e) => { setImage(e.target.files?.[0] ?? null); setRemoveImage(false); }} />
                {highlightSrc ? (
                  <div className="works-form-thumb">
                  <img
                    src={highlightSrc}
                    alt="高光图预览"
                    onLoad={coverAr('.works-form-thumb')}
                  />
                </div>
                ) : null}
                {project.cover && image ? (
                  <button type="button" className="works-btn-danger" style={{ marginLeft: 0 }}
                    onClick={() => { setImage(null); setRemoveImage(true); }}>移除高光图</button>
                ) : null}
              </div>
            </div>

            <div className="works-field">
              <span className="works-label">结构化文案（自由结构，可增删）</span>
              <div className="works-sections-edit">
                {sections.map((s, i) => (
                  <div className="works-section-edit" key={s.key || i}>
                    <div className="works-section-edit-head">
                      <input className="works-input" value={s.heading}
                        placeholder="小节标题，如 项目背景 / 核心洞察 / 项目执行"
                        onChange={(e) => updateSection(i, { heading: e.target.value })} />
                      <button type="button" className="works-btn-danger" onClick={() => removeSection(i)}>删除</button>
                    </div>
                    <textarea className="works-textarea" value={s.body}
                      placeholder="这一节的文案，用空行分段"
                      onChange={(e) => updateSection(i, { body: e.target.value })} />
                  </div>
                ))}
                <button type="button" className="works-btn-ghost" onClick={addSection}>＋ 添加一节</button>
              </div>
            </div>

            <div className="works-field">
              <span className="works-label">完整 PDF（仅下载用，可选）</span>
              <div className="works-file">
                <input type="file" accept="application/pdf,.pdf"
                  onChange={(e) => { setPdf(e.target.files?.[0] ?? null); setRemovePdf(false); }} />
                {hasPdf ? (
                  <button type="button" className="works-btn-danger" style={{ marginLeft: 0 }}
                    onClick={() => { setPdf(null); setRemovePdf(true); }}>移除 PDF</button>
                ) : null}
              </div>
            </div>

            {notice ? (
              <p
                className={`works-form-notice${notice.tone === 'warn' ? ' is-warn' : ''}`}
                role="status"
              >
                {notice.tone === 'warn' ? '⚠ ' : '✓ '}
                {notice.text}
              </p>
            ) : null}

            {error ? (
              <p className="works-form-error" role="alert">
                ⚠ {error}
              </p>
            ) : null}

            <div className="works-form-actions">
              <button type="button" className="works-btn-primary" disabled={busy} onClick={submit}>
                {busy ? '保存中…' : '保存'}
              </button>
              {project.filled ? (
                <button type="button" className="works-btn-ghost" disabled={busy} onClick={() => setEditing(false)}>
                  取消
                </button>
              ) : null}
              {project.filled ? (
                <button type="button" className="works-btn-danger" disabled={busy} onClick={clearSlot}>
                  清空槽位
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          /* ---------------- 阅读态：左字右图 ---------------- */
          <div className="works-panel-body works-case">
            <section className="works-case-text" aria-label="项目阐述">
              {(role || year || project.client) ? (
                <p className="works-case-meta">
                  {[role, year || project.client].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              {summary ? <p className="works-case-lead">{summary}</p> : null}
              {tagList.length ? (
                <div className="works-tags">
                  {tagList.map((t) => <span key={t} className="works-tag">{t}</span>)}
                </div>
              ) : null}

              {sections.length ? (
                <div className="works-sections">
                  {sections.map((s) => (
                    <article className="works-section" key={s.key}>
                      <h4 className="works-sec">{s.heading}</h4>
                      {s.body.split(/\n\n+/).map((para, i) => (
                        <p className="works-text" key={i}>{para}</p>
                      ))}
                    </article>
                  ))}
                </div>
              ) : summary ? null : (
                <p className="works-empty">＞ 待补充：用「结构化文案」讲清这个策划案</p>
              )}

              {hasPdf ? (
                <a className="works-download" href={project.pdf!} target="_blank" rel="noreferrer noopener">
                  ⤓ 下载完整 PDF
                </a>
              ) : null}
            </section>

            <aside className="works-case-media" aria-label="高光图">
              {highlightSrc ? (
                <img className="works-highlight" src={highlightSrc} alt={`${project.title} 高光图`} />
              ) : (
                <div className="works-highlight-empty">
                  <span>＞ 高光图待上传</span>
                </div>
              )}
            </aside>
          </div>
        )}

        <footer className="works-panel-foot">
          {/* 「去线上」入口其三（作品详情面板页脚）2026-09-14 按用户要求删除：
              原来这里是 查看线上版本 ↗ / 「仅本机可见」二选一，两个分支一并去掉。 */}
          {canEdit ? (
            <button type="button" className="works-btn-primary works-btn-sm" onClick={() => setEditing(true)}>
              编辑项目
            </button>
          ) : null}
          <span className="works-hint-sm">Esc 返回木马</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
