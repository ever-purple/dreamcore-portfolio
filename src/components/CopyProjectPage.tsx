import { useEffect, useMemo, useState } from 'react';
import {
  COPY_FILTERS,
  COPY_PAGE_COPY,
  COPY_PROJECTS,
  type CopyProject,
} from '@/data/copyProjects';
import { CursorLabel } from '@/components/CursorLabel';
import { PageDecor } from '@/components/PageDecor';
import { StudioChrome } from '@/components/StudioChrome';
import { useEscape } from '@/lib/escape-stack';
import { coverAr } from '@/lib/cover-ar';

/**
 * 报刊亭「第二排」落地页 —— 文案 / AI 项目列表（**文字卡片列表**）。
 *
 * 用户明确：第二排不是视频，用卡片列表（标题 + 简介 + 标签），
 * 所以这里**没有**播放器，只有可筛选的卡片网格。
 *
 * 这是个**独立页面**（全屏铺满，有自己的滚动与返回）。
 * 2026-09-15：先搭框架，`COPY_PROJECTS` 还是空的 —— 空列表走 empty 占位。
 */

type Props = {
  onClose: () => void;
};

type FilterKey = 'all' | 'copy' | 'ai';

export function CopyProjectPage({ onClose }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // ESC = 退回上一层（书架）。走全站统一的 Esc 栈 —— 这页常盖在书架之上，
  // 只有"栈"能保证一次按键只关最上面那层，不会连书架一起收掉。
  useEscape(onClose);

  const list = useMemo(
    () => (filter === 'all' ? COPY_PROJECTS : COPY_PROJECTS.filter((p) => p.category === filter)),
    [filter],
  );

  return (
    <>
    <div
      className={`cp-page${entered ? ' is-in' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="文案与 AI 项目"
      data-cursor=""
      data-cursor-tone="light"
    >
      {/* ---- 背景装饰（2026-09-17 / 用户第 1 条"美化子页面"）----
          这页的卡片是半透明白纸（rgba(255,255,255,.4)）→ 底下的点阵花会**透一点点**，
          读起来像"印在带底纹的纸上"。层级见 index.css 的 .pdecor 段。 */}
      <PageDecor variant="cp" />

      {/* 品牌区。原来这一行是 [Back] [标题] [占位] 三栏 ——
          「Back」已经交给左上角统一外壳（第一档改造 ①），这里只留标题。
          grid 相应收成一栏（见 .cp-topbar），否则标题会被挤到第二行。 */}
      <header className="cp-topbar">
        <div className="cp-brand">
          <h1 className="cp-title">{COPY_PAGE_COPY.title}</h1>
          {COPY_PAGE_COPY.subtitle ? <p className="cp-subtitle">{COPY_PAGE_COPY.subtitle}</p> : null}
        </div>
      </header>

      {/* 分类筛选（列表为空时也保留，方便看到框架） */}
      <nav className="cp-filters" aria-label="分类筛选">
        {COPY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`cp-filter${filter === f.key ? ' is-on' : ''}`}
            onClick={() => setFilter(f.key)}
            data-cursor="Filter"
            data-cursor-tone="light"
          >
            {f.label}
          </button>
        ))}
      </nav>

      <div className="cp-scroll" data-cursor="" data-cursor-tone="light">
        {list.length === 0 ? (
          <p className="cp-empty">{COPY_PAGE_COPY.empty}</p>
        ) : (
          <div className="cp-grid">
            {list.map((p) => (
              <CopyCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </div>

      {/* 统一外壳（第一档改造 ①）：左上「返回书架」+ 右上「MENU」。
          文案是"返回书架"而不是"返回工作室" —— 这一页的上一层是书架，
          不是房间；外壳统一的是长相，不是层级语义。
          tone=dark：这页是浅色纸底，奶白字会看不见。
          absolute 定位 → 不参与上面那条 flex 纵列，不会挤掉列表高度。 */}
      <StudioChrome label="Return to Archive" onBack={onClose} tone="dark" className="cp-chrome" />
    </div>

    {/* 手绘圈注式跟随标签（Back / Filter / Open），系统光标保留。
        挂在本页根节点**外面** —— .cp-page 入场是整块 opacity 0→1 + scale，
        opacity<1 会给 fixed 子元素造出包含块，挂在里面会被那层缩放锁住。
        （与视频页同一个缺口：data-cursor 早就写了，CursorLabel 一直没挂上。） */}
    <CursorLabel />
    </>
  );
}

function CopyCard({ project }: { project: CopyProject }) {
  const body = (
    <>
      {project.cover ? (
        <div className="cp-card-media">
          <img
            src={project.cover}
            alt=""
            loading="lazy"
            onLoad={coverAr('.cp-card-media')}
          />
        </div>
      ) : (
        <div className="cp-card-media is-empty" aria-hidden="true">
          <span className="cp-card-mark">{project.category === 'ai' ? 'AI' : 'COPY'}</span>
        </div>
      )}
      <div className="cp-card-body">
        <div className="cp-card-head">
          <h2 className="cp-card-title">{project.title}</h2>
          {project.year ? <span className="cp-card-year">{project.year}</span> : null}
        </div>
        <p className="cp-card-blurb">{project.blurb}</p>
        {project.tags?.length ? (
          <ul className="cp-card-tags">
            {project.tags.map((t) => (
              <li key={t} className="cp-card-tag">
                {t}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );

  return project.link ? (
    <a
      className="cp-card"
      href={project.link}
      target="_blank"
      rel="noreferrer"
      data-cursor="Open"
      data-cursor-tone="light"
    >
      {body}
    </a>
  ) : (
    <article className="cp-card">{body}</article>
  );
}

export default CopyProjectPage;
