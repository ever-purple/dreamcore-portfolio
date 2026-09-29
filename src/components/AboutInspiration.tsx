import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { InspLightbox, type LightboxItem } from '@/components/InspLightbox';
import { CoverField } from '@/components/InspCoverField';
import { useAdmin } from '@/context/AdminContext';
import { usePlayer } from '@/context/PlayerContext';
import {
  addItem,
  clearStore,
  ensureProjectWriter,
  exportStore,
  fetchLinkMeta,
  getCollection,
  hydrate,
  importStore,
  lastPersistError,
  parseTags,
  removeItem,
  resetStore,
  storageMode,
  updateItem,
  uploadFile,
  type CollectionKey,
} from '@/lib/contentApi';
import { resolveIdbRefs } from '@/lib/blobStore';
import { readAudioTags, type AudioTags } from '@/lib/audioTags';
import { platformLabel, toTrack } from '@/context/PlayerContext';
import type { LinkItem, MusicItem, ProjectItem, VisionItem } from '@/data/inspiration';

/* ------------------------------------------------------------------ */
/* 一级分类                                                            */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'cases', label: '案例收集癖', icon: '🎯' },
  { id: 'ai_lab', label: 'AI实验室', icon: '🤖' },
  { id: 'aesthetics', label: '审美狠狠积累', icon: '🎨' },
  { id: 'knowledge', label: '知识疯狂输入', icon: '📚' },
];

/* ------------------------------------------------------------------ */
/* 二级页签                                                            */
/* ------------------------------------------------------------------ */

type SubTab = { id: string; label: string };

const SUBTABS: Record<string, SubTab[]> = {
  aesthetics: [
    { id: 'vision', label: '视觉 Vision' },
    { id: 'music', label: '音乐 Music' },
  ],
  /* AI实验室不再分「项目 / 技能」两个页签 —— 一个列表混着放，作者录什么就是什么。 */
};

const DEFAULT_SUB: Record<string, string> = { aesthetics: 'vision' };

/* ------------------------------------------------------------------ */
/* 排序：所有收藏一律「从新到旧」                                       */
/* ------------------------------------------------------------------ */

/**
 * 从 id 尾部的毫秒时间戳反推「加入时间」。
 * 各处新增时 id 都是 `${前缀}-${Date.now()}`（`projects-1790…` / `link-1790…` /
 * `vision-1790…`），所以不额外加 createdAt 字段也能按时间排。
 * 认不出来（手改过 id 的老数据）返回 0，排在最末。
 */
function timeOf(id: string): number {
  const m = /(\d{10,})\s*$/.exec(id) ?? /(\d{10,})/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** 按加入时间从新到旧；同一毫秒内的保持原有相对顺序（稳定排序）。 */
function byNewest<T extends { id: string }>(list: T[]): T[] {
  return list
    .map((it, i) => ({ it, i, t: timeOf(it.id) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.it);
}

/* ------------------------------------------------------------------ */
/* 复用的小组件                                                        */
/* ------------------------------------------------------------------ */

/** 作者模式下，每张卡右上角的删除按钮 */
function DelButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="about-insp-del"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      ✕
    </button>
  );
}

/** 作者模式下，每张卡右上角（✕ 左边）的编辑按钮 */
function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="about-insp-edit"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      ✎
    </button>
  );
}

/** 编辑表单的字段声明。`kind:'cover'` 的那个会渲染成可粘贴的封面字段。 */
type EditField = {
  key: string;
  label: string;
  placeholder?: string;
  kind?: 'text' | 'cover';
};

/**
 * 通用行内编辑表单：字段声明式给出，初值来自卡片本身，保存走 updateItem。
 * 所有「✎ 编辑」共用这一个表单壳，避免每类卡各写一套。
 *
 * 每张卡都能改**全部**字段（封面也包含在内）—— 否则想换张图就得删掉重传，
 * 条目一多根本没法维护。
 */
function InlineEditForm({
  fields,
  initial,
  onSave,
  onCancel,
  onRedetect,
}: {
  fields: EditField[];
  initial: Record<string, string>;
  onSave: (values: Record<string, string>) => void;
  onCancel: () => void;
  /**
   * 「用链接重新识别」：拿表单里当前的链接再跑一次识别，把结果**回填到表单**（不直接保存）。
   * 返回 null = 没识别出内容。
   *
   * 为什么需要：历史脏数据要能就地修好 —— 比如分享短链当初只抓到短码，
   * 歌名存成了 "Bhr5rXOI"、封面空白、也没有外链播放器地址（点播放没声音）。
   * 有了它就点一下重新识别、再保存，不必删掉重加。
   *
   * 返回值除了表单字段，也可以带上表单里没有的键（如 `platform`），
   * 保存时由各卡自己决定写不写回条目。
   */
  onRedetect?: (values: Record<string, string>) => Promise<Record<string, string> | null>;
}) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState('');

  const redetect = () => {
    if (!onRedetect || busy) return;
    setBusy(true);
    setTip('');
    void (async () => {
      try {
        const patch = await onRedetect(values);
        if (!patch) {
          setTip('没识别出内容。确认链接是「单曲 / 条目详情页」而不是聚合页，也可以直接手填。');
          return;
        }
        setValues((v) => ({ ...v, ...patch }));
        setTip('已重新识别，确认无误后点保存。');
      } catch {
        setTip('识别失败，字段可以直接手填。');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="about-insp-form about-insp-cardform" onClick={(e) => e.stopPropagation()}>
      <p className="about-insp-form-title">✎ 编辑（改完点保存）</p>
      {fields.map((f) =>
        f.kind === 'cover' ? (
          <CoverField
            key={f.key}
            value={values[f.key] ?? ''}
            onChange={(url) => setValues((v) => ({ ...v, [f.key]: url }))}
            placeholder={f.placeholder ?? '封面：Ctrl/⌘+V 粘一张，或粘贴图片地址'}
          />
        ) : (
          <input
            key={f.key}
            className="about-insp-input"
            value={values[f.key] ?? ''}
            placeholder={f.placeholder ?? f.label}
            aria-label={f.label}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(values);
            }}
          />
        ),
      )}
      <div className="about-insp-form-actions">
        {onRedetect ? (
          <button type="button" className="about-insp-btn" disabled={busy} onClick={redetect}>
            {busy ? '识别中…' : '🔍 重新识别'}
          </button>
        ) : null}
        <button type="button" className="about-insp-btn is-primary" onClick={() => onSave(values)}>
          保存
        </button>
        <button type="button" className="about-insp-btn" onClick={onCancel}>
          取消
        </button>
      </div>
      {tip ? <p className="about-insp-form-note">{tip}</p> : null}
    </div>
  );
}

/**
 * 识别结果 → 表单字段（歌名 / 歌手 / 封面 / 外链播放器地址 / 平台）。
 * 音乐卡和链接卡的「🔍 重新识别」共用这一份映射，免得两处各写一遍解析。
 */
async function redetectFields(link: string): Promise<Record<string, string> | null> {
  const u = link.trim();
  if (!u) return null;
  const meta = await fetchLinkMeta(u);
  if (!meta.title && !meta.cover && !meta.embed) return null;
  const artist =
    (meta.extra?.artist as string | undefined) ??
    (meta.desc?.startsWith('歌手：') ? meta.desc.slice(3) : '');
  const out: Record<string, string> = {};
  if (meta.title) out.title = meta.title;
  if (artist) out.artist = artist;
  if (meta.cover) out.cover = meta.cover;
  if (meta.embed) out.embed = meta.embed;
  if (meta.platform) out.platform = meta.platform;
  // 平台侧歌曲 id 一并存下（以后想换封面 / 换播放器就不用再抓一次页面）
  if (meta.extra?.songId) out.songId = String(meta.extra.songId);
  // 识别成功后顺手把链接换成规范地址 —— 分享短链过一阵可能失效，
  // 而 `music.163.com/#/song?id=…` 这种地址长期有效
  if (meta.url) out.link = meta.url;
  return out;
}

/**
 * 图片拖拽 / 点选上传框（作者模式才出现）。
 * 也认 Ctrl/⌘+V：剪贴板里是图片文件就上传，是图片地址就当外链图存一条。
 */
function ImageDropzone({
  label,
  onFile,
  onUrl,
}: {
  label: string;
  onFile: (file: File) => void;
  /** 剪贴板里只有图片地址（没有文件本体）时走这里 */
  onUrl?: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  const pick = (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    void (async () => {
      for (const f of Array.from(files)) onFile(f);
      await new Promise((r) => setTimeout(r, 300));
      setBusy(false);
    })();
  };

  /** 粘贴：先找图片文件，没有再看是不是图片地址 */
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const dt = e.clipboardData;
    const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      setBusy(true);
      void (async () => {
        for (const f of files) onFile(f);
        await new Promise((r) => setTimeout(r, 300));
        setBusy(false);
      })();
      return;
    }
    const text = (dt.getData('text/plain') ?? '').trim();
    if (onUrl && /^(https?:|data:image\/)/i.test(text)) {
      e.preventDefault();
      setBusy(true);
      onUrl(text);
      window.setTimeout(() => setBusy(false), 300);
    }
  };

  return (
    <div
      className={`about-insp-drop${drag ? ' is-drag' : ''}${busy ? ' is-busy' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onPaste={handlePaste}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        pick(e.dataTransfer.files);
      }}
    >
      <span className="about-insp-drop-plus" aria-hidden="true">
        +
      </span>
      <span className="about-insp-drop-label">{busy ? '上传中…' : label}</span>
      <span className="about-insp-drop-sub">也可以直接 Ctrl/⌘+V 粘贴图片</span>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 作者模式：新增表单                                                   */
/* ------------------------------------------------------------------ */

/** 粘贴链接 → 自动识别标题 / 封面 → 都可以手改（封面直接粘贴图片地址即可） */
function LinkAddBox({ onAdd }: { onAdd: (item: LinkItem) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState<{
    title: string;
    cover: string;
    link: string;
    tags: string;
    site: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const detect = () => {
    const u = url.trim();
    if (!u) {
      setErr('先粘贴一个链接');
      return;
    }
    setBusy(true);
    setErr('');
    setNote('');
    void (async () => {
      const link = /^https?:\/\//i.test(u) ? u : `https://${u}`;
      try {
        const meta = await fetchLinkMeta(u);
        setDraft({
          title: meta.title,
          cover: meta.cover,
          link: meta.url || link,
          tags: '',
          site: meta.site ?? '',
        });
        setNote(
          meta.cover
            ? `已自动识别封面与标题${meta.site ? `（${meta.site}）` : ''}`
            : '没拿到封面，可以自己上传一张或粘贴图片地址',
        );
      } catch {
        // 识别服务全挂了也照样能加：字段留空手填
        setErr('自动识别失败，标题和封面可以直接手填');
        setDraft({ title: '', cover: '', link, tags: '', site: '' });
      } finally {
        setBusy(false);
      }
    })();
  };

  const add = () => {
    if (!draft) return;
    const link = draft.link.trim();
    if (!link) {
      setErr('链接不能为空');
      return;
    }
    const tags = parseTags(draft.tags);
    onAdd({
      id: `link-${Date.now()}`,
      title: draft.title.trim() || '未命名收藏',
      cover: draft.cover.trim() || '/about/banner-visual.jpeg',
      link,
      tags: tags.length ? tags : undefined,
    });
    setUrl('');
    setDraft(null);
    setErr('');
    setNote('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="about-insp-drop about-insp-drop-btn" onClick={() => setOpen(true)}>
        <span className="about-insp-drop-plus" aria-hidden="true">
          +
        </span>
        <span className="about-insp-drop-label">粘贴链接添加</span>
      </button>
    );
  }

  return (
    <div className="about-insp-form about-insp-form-link">
      {!draft ? (
        <>
          <p className="about-insp-form-title">🔗 粘贴链接，自动识别封面与标题</p>
          <input
            className="about-insp-input"
            value={url}
            autoFocus
            placeholder="https://…"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') detect();
            }}
          />
          {err ? <p className="about-insp-form-err">{err}</p> : null}
          <div className="about-insp-form-actions">
            <button type="button" className="about-insp-btn is-primary" onClick={detect} disabled={busy}>
              {busy ? '识别中…' : '识别'}
            </button>
            <button type="button" className="about-insp-btn" onClick={() => setOpen(false)}>
              取消
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="about-insp-form-title">🔗 确认一下（都可以直接改 / 粘贴覆盖）</p>
          <input
            className="about-insp-input"
            value={draft.link}
            placeholder="链接 https://…"
            onChange={(e) => setDraft({ ...draft, link: e.target.value })}
          />
          <input
            className="about-insp-input"
            value={draft.title}
            autoFocus
            placeholder="标题（识别不准就手改）"
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <CoverField
            value={draft.cover}
            onChange={(url) => setDraft({ ...draft, cover: url })}
            placeholder="封面：粘贴图片地址，或 Ctrl/⌘+V 直接粘图片"
          />
          <input
            className="about-insp-input"
            value={draft.tags}
            placeholder="标签，如 #TVC #策划（可选）"
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          />
          {note ? <p className="about-insp-form-note">{note}</p> : null}
          {err ? <p className="about-insp-form-err">{err}</p> : null}
          <div className="about-insp-form-actions">
            <button type="button" className="about-insp-btn is-primary" onClick={add}>
              添加
            </button>
            <button
              type="button"
              className="about-insp-btn"
              onClick={detect}
              disabled={busy || !url.trim()}
              title="重新从链接识别标题与封面，会覆盖手改的内容"
            >
              {busy ? '识别中…' : '重新识别'}
            </button>
            <button
              type="button"
              className="about-insp-btn"
              onClick={() => {
                setDraft(null);
                setErr('');
              }}
            >
              上一步
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 新增 AI 项目：粘贴 GitHub 仓库链接自动识别（名字 / 简介 / topics / 封面），
 * 也可以纯手填 —— 两个入口共用同一张表单，识别出来的字段都能改。
 *
 * 为什么 GitHub 要单独走 API：AI 项目大多是开源仓库，仓库页的 og 标签只有一张
 * 模糊的社交卡；`api.github.com/repos` 能拿到简介、topics、star 数，
 * 配上官方 social preview 图，卡片信息量完全不一样。
 */
function ProjectAddForm({ onAdd }: { onAdd: (item: ProjectItem) => void }) {
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [tags, setTags] = useState('');
  const [link, setLink] = useState('');
  const [cover, setCover] = useState('');
  const [stars, setStars] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const reset = () => {
    setRepoUrl('');
    setName('');
    setDesc('');
    setTags('');
    setLink('');
    setCover('');
    setStars(undefined);
    setNote('');
    setErr('');
    setBusy(false);
    setOpen(false);
  };

  /** 粘 GitHub 链接 → 一次把名字 / 简介 / topics / 封面 / star 全填上 */
  const detectRepo = () => {
    const u = repoUrl.trim();
    if (!u) {
      setErr('先粘贴一个仓库链接');
      return;
    }
    setBusy(true);
    setErr('');
    setNote('');
    void (async () => {
      try {
        const meta = await fetchLinkMeta(u);
        const ex = (meta.extra ?? {}) as {
          topics?: string[];
          stars?: number;
          language?: string;
          fullName?: string;
        };
        const topicTags = ex.topics?.length
          ? ex.topics.join(' ')
          : ex.language
            ? `#${ex.language}`
            : '';
        setName(meta.title || '');
        setDesc(meta.desc || '');
        setTags(topicTags);
        setLink(meta.url || u);
        setCover(meta.cover || '');
        setStars(typeof ex.stars === 'number' ? ex.stars : undefined);
        setNote(
          meta.platform === 'github'
            ? `已识别 GitHub 仓库${ex.fullName ? ` ${ex.fullName}` : ''}${
                typeof ex.stars === 'number' ? ` · ★${ex.stars}` : ''
              }`
            : `识别完成（${meta.site || '未知站点'}），字段可以直接改。`,
        );
      } catch {
        setErr('识别失败，字段可以直接手填');
      } finally {
        setBusy(false);
      }
    })();
  };

  const submit = () => {
    if (!name.trim()) return;
    const tagList = parseTags(tags);
    onAdd({
      id: `projects-${Date.now()}`,
      name: name.trim(),
      cover: cover || '/about/banner-visual.jpeg',
      tags: tagList,
      desc: desc.trim() || undefined,
      link: link.trim() || undefined,
      source: /github\.com/i.test(link) ? 'github' : 'manual',
      stars: stars,
    });
    reset();
  };

  if (!open) {
    return (
      <button type="button" className="about-insp-drop about-insp-drop-btn" onClick={() => setOpen(true)}>
        <span className="about-insp-drop-plus" aria-hidden="true">
          +
        </span>
        <span className="about-insp-drop-label">新增条目</span>
      </button>
    );
  }

  return (
    <div className="about-insp-form about-insp-form-project">
      <p className="about-insp-form-title">💾 新增项目</p>

      <div className="about-insp-form-row">
        <input
          className="about-insp-input"
          value={repoUrl}
          autoFocus
          placeholder="粘贴 GitHub 仓库链接自动识别 https://…"
          onChange={(e) => setRepoUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') detectRepo();
          }}
        />
        <button type="button" className="about-insp-btn is-primary" onClick={detectRepo} disabled={busy}>
          {busy ? '识别中…' : '识别'}
        </button>
      </div>
      {note ? <p className="about-insp-form-note">{note}</p> : null}
      {err ? <p className="about-insp-form-err">{err}</p> : null}

      <input className="about-insp-input" value={name} placeholder="项目名称" onChange={(e) => setName(e.target.value)} />
      <input className="about-insp-input" value={desc} placeholder="一句话简介（可选）" onChange={(e) => setDesc(e.target.value)} />
      <input className="about-insp-input" value={tags} placeholder="标签，如 #LLM #Canvas" onChange={(e) => setTags(e.target.value)} />
      <input className="about-insp-input" value={link} placeholder="项目链接 https://…" onChange={(e) => setLink(e.target.value)} />

      <CoverField
        value={cover}
        onChange={setCover}
        placeholder="封面：GitHub 会自动带一张；想换就 Ctrl/⌘+V 粘一张"
      />

      <div className="about-insp-form-actions">
        <button type="button" className="about-insp-btn is-primary" onClick={submit} disabled={busy}>
          添加
        </button>
        <button type="button" className="about-insp-btn" onClick={reset}>
          取消
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 各类卡片流                                                          */
/* ------------------------------------------------------------------ */

/** 视觉：完整图片卡（不裁切、无底部文字），点击仍可看大图 */
function VisionGrid({
  items,
  isAdmin,
  onOpen,
  onAdd,
  onAddUrl,
  onDelete,
  onEdit,
}: {
  items: VisionItem[];
  isAdmin: boolean;
  onOpen: (item: LightboxItem) => void;
  onAdd: (file: File) => void;
  /** 粘贴进来的是图片地址（不是文件）时走这里 */
  onAddUrl: (url: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="about-insp-masonry">
      {items.map((v) => (
        <div
          className="about-insp-vcard"
          key={v.id}
          role="button"
          tabIndex={0}
          aria-label={`查看大图：${v.title}`}
          style={{ '--v-ratio': v.ratio } as CSSProperties}
          onClick={(e) => {
            if ((e.target as Element).closest('.about-insp-del, .about-insp-edit, .about-insp-cardform')) return;
            onOpen({ src: v.src, title: v.title, code: v.code, link: v.link });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen({ src: v.src, title: v.title, code: v.code, link: v.link });
            }
          }}
        >
          {editingId === v.id ? (
            <InlineEditForm
              fields={[
                { key: 'title', label: '图片标题' },
                { key: 'code', label: '角标编号（如 NEW）' },
                { key: 'src', label: '图片', kind: 'cover' },
                { key: 'link', label: '原链接（可选）', placeholder: '原链接 https://…（可选）' },
              ]}
              initial={{
                title: v.title,
                code: v.code,
                // idb: 是浏览器本地落盘的引用，显示出来也没法改，留空=保持原图
                src: v.src.startsWith('idb:') ? '' : v.src,
                link: v.link ?? '',
              }}
              onSave={(val) => {
                onEdit(v.id, {
                  title: val.title.trim() || v.title,
                  code: val.code.trim() || v.code,
                  link: val.link.trim() || undefined,
                  // 留空表示「不换图」，避免手滑把图清空
                  ...(val.src.trim() ? { src: val.src.trim() } : {}),
                });
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <span className="about-insp-vmedia">
                <img className="about-insp-vimg" src={v.src} alt={v.title} loading="lazy" decoding="async" />
                <span className="about-insp-vcode">{v.code}</span>
                <span className="about-insp-vhint">🔍 点击看大图</span>
              </span>
              {isAdmin ? (
                <>
                  <EditButton onClick={() => setEditingId(v.id)} label={`编辑图片 ${v.title}`} />
                  <DelButton onClick={() => onDelete(v.id)} label={`删除图片 ${v.title}`} />
                </>
              ) : null}
            </>
          )}
        </div>
      ))}
      {isAdmin ? (
        <ImageDropzone label="拖拽 / 点选图片上传" onFile={onAdd} onUrl={onAddUrl} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 音乐上传：传的是「歌曲」，封面自动从标签里挖                              */
/* ------------------------------------------------------------------ */

type SongDraft = {
  /** 上传后拿到的音频地址（mock 是 blob URL） */
  src: string;
  /** 标题：优先标签里的 TIT2，其次文件名 */
  title: string;
  artist: string;
  genre: string;
  /** 当前生效的封面 */
  cover: string;
  /** 标签里识别到的封面，用于「还原自动识别」 */
  tagCover: string;
};

/** 识别结果 → 一句给用户看的人话 */
function describeTags(tags: AudioTags, hasTitle: boolean, hasCover: boolean) {
  if (tags.source === 'none') return '没读到内嵌标签：标题请手填，封面上传一张就行。';
  const from = tags.source === 'mp4' ? 'm4a 标签' : tags.source === 'id3v1' ? 'ID3v1 标签' : 'ID3 标签';
  const got = [hasTitle ? '标题' : '', hasCover ? '封面' : '', tags.artist ? '歌手' : ''].filter(Boolean);
  const miss = [!hasCover ? '封面' : '', !hasTitle ? '标题' : ''].filter(Boolean);
  return `从${from}识别到${got.length ? got.join(' / ') : '有限信息'}${miss.length ? `；${miss.join('、')}没找到，可手动补。` : '。'}`;
}

/** 上传歌曲 → 自动识别标题/歌手/封面 → 识别不准可手动覆盖 */
function SongAddForm({ onAdd }: { onAdd: (item: MusicItem) => void }) {
  const songRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<SongDraft | null>(null);

  const reset = () => {
    setDraft(null);
    setNote('');
    setBusy(false);
    setOpen(false);
  };

  const pickSong = (f: File | null) => {
    if (!f) return;
    setBusy(true);
    setNote('正在读取标签…');
    void (async () => {
      const tags: AudioTags = await readAudioTags(f);
      const { url } = await uploadFile(f);
      const fallbackTitle = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
      const title = tags.title || fallbackTitle;
      setDraft({
        src: url,
        title,
        artist: tags.artist ?? '',
        genre: (tags.genre ?? []).join(' '),
        cover: tags.cover ?? '',
        tagCover: tags.cover ?? '',
      });
      setNote(describeTags(tags, !!tags.title, !!tags.cover));
      setBusy(false);
    })();
  };

  const save = () => {
    if (!draft) return;
    const genres = parseTags(draft.genre, 4);
    onAdd({
      id: `music-${Date.now()}`,
      title: draft.title.trim() || '未命名音乐',
      artist: draft.artist.trim() || undefined,
      cover: draft.cover,
      genre: genres,
      src: draft.src,
    });
    reset();
  };

  const patch = (p: Partial<SongDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  if (!open) {
    return (
      <button type="button" className="about-insp-drop about-insp-drop-btn" onClick={() => setOpen(true)}>
        <span className="about-insp-drop-plus" aria-hidden="true">
          +
        </span>
        <span className="about-insp-drop-label">上传歌曲（自动认封面）</span>
      </button>
    );
  }

  return (
    <div className="about-insp-form about-insp-form-song">
      <p className="about-insp-form-title">💿 上传歌曲</p>

      <button type="button" className="about-insp-btn about-insp-song-pick" onClick={() => songRef.current?.click()}>
        {busy ? '处理中…' : draft ? '✓ 已选歌曲（点击更换）' : '选择音频文件（mp3 / m4a / flac）'}
      </button>
      <input
        ref={songRef}
        className="about-insp-song-file"
        type="file"
        accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg"
        hidden
        onChange={(e) => pickSong(e.target.files?.[0] ?? null)}
      />

      {note ? <p className="about-insp-form-note">{note}</p> : null}

      {draft ? (
        <>
          <div className="about-insp-song-preview">
            <span className={`about-insp-song-thumb${draft.cover ? '' : ' is-empty'}`}>
              {draft.cover ? (
                <img src={draft.cover} alt="" />
              ) : (
                <span className="about-insp-song-thumb-note" aria-hidden="true">
                  ♪
                </span>
              )}
            </span>
            <div className="about-insp-song-fields">
              <input
                className="about-insp-input"
                value={draft.title}
                placeholder="歌曲标题"
                onChange={(e) => patch({ title: e.target.value })}
              />
              <input
                className="about-insp-input"
                value={draft.artist}
                placeholder="歌手（可选）"
                onChange={(e) => patch({ artist: e.target.value })}
              />
            </div>
          </div>

          <input
            className="about-insp-input"
            value={draft.genre}
            placeholder="曲风标签，如 #Ambient #Dreamcore（可选）"
            onChange={(e) => patch({ genre: e.target.value })}
          />

          <CoverField
            value={draft.cover}
            onChange={(url) => patch({ cover: url })}
            placeholder="封面：没自动认出来就 Ctrl/⌘+V 粘一张"
          />

          <div className="about-insp-form-actions">
            {draft.tagCover && draft.cover !== draft.tagCover ? (
              <button type="button" className="about-insp-btn" onClick={() => patch({ cover: draft.tagCover })}>
                用回识别到的
              </button>
            ) : null}
          </div>

          <div className="about-insp-form-actions">
            <button type="button" className="about-insp-btn is-primary" onClick={save} disabled={busy}>
              添加这首歌
            </button>
            <button type="button" className="about-insp-btn" onClick={reset}>
              取消
            </button>
          </div>
        </>
      ) : (
        <div className="about-insp-form-actions">
          <button type="button" className="about-insp-btn" onClick={reset}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}

/** 会被当成「音乐链接」的平台；其它链接也能加，只是拿不到播放器 */
const MUSIC_PLATFORMS = new Set(['netease', 'qqmusic', 'spotify', 'apple']);

/**
 * 粘贴音乐链接 → 自动认歌名 / 歌手 / 封面 → 都能手改。
 *
 * 为什么是「分享链接」而不是「上传 mp3」：
 *   · 版权 —— 本站不落任何音频文件，音频始终由平台自己放；
 *   · 体积 —— 一首歌 5–10MB，全塞进仓库会把部署包撑爆；
 *   · VIP —— 外链播放器由平台决定能放多少，付费歌曲自然只放可试听的那一段，
 *            行为跟在平台站外听完全一致，不用我们自己做裁剪。
 */
function MusicLinkAddForm({ onAdd }: { onAdd: (item: MusicItem) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<{
    title: string;
    artist: string;
    cover: string;
    link: string;
    embed: string;
    platform: string;
    genre: string;
  } | null>(null);

  const reset = () => {
    setDraft(null);
    setUrl('');
    setErr('');
    setNote('');
    setBusy(false);
    setOpen(false);
  };

  const detect = (raw?: string) => {
    const u = (raw ?? url).trim();
    if (!u) {
      setErr('先粘贴一个音乐链接');
      return;
    }
    setBusy(true);
    setErr('');
    setNote('');
    void (async () => {
      try {
        const meta = await fetchLinkMeta(u);
        const isMusic = !!meta.embed || (meta.platform ? MUSIC_PLATFORMS.has(meta.platform) : false);
        const artist =
          (meta.extra?.artist as string | undefined) ??
          (meta.desc?.startsWith('歌手：') ? meta.desc.slice(3) : '');
        setDraft({
          title: meta.title || '',
          artist: artist || '',
          cover: meta.cover || '',
          link: meta.url || u,
          embed: meta.embed || '',
          platform: meta.platform || '',
          genre: '',
        });
        setNote(
          isMusic
            ? `识别成功：${platformLabel(meta.platform) || meta.site || '音乐平台'}${
                meta.embed ? ' · 用平台外链播放器播放' : ''
              }`
            : `没识别出音乐信息（${meta.site || '未知站点'}）。歌名 / 封面可以直接手填，也能换一个链接再试。`,
        );
      } catch {
        setErr('识别失败，歌名和封面可以直接手填');
        setDraft({
          title: '',
          artist: '',
          cover: '',
          link: u.startsWith('http') ? u : `https://${u}`,
          embed: '',
          platform: '',
          genre: '',
        });
      } finally {
        setBusy(false);
      }
    })();
  };

  const save = () => {
    if (!draft) return;
    const link = draft.link.trim();
    if (!link) {
      setErr('链接不能为空');
      return;
    }
    const genres = parseTags(draft.genre, 4);
    onAdd({
      id: `music-${Date.now()}`,
      title: draft.title.trim() || '未命名音乐',
      artist: draft.artist.trim() || undefined,
      cover: draft.cover.trim(),
      genre: genres.length ? genres : ['#外链'],
      // 只存链接与外链播放器地址，不存音频文件
      source: 'link',
      platform: draft.platform || undefined,
      embed: draft.embed.trim() || undefined,
      link,
    });
    reset();
  };

  const patch = (p: Partial<NonNullable<typeof draft>>) => setDraft((d) => (d ? { ...d, ...p } : d));

  if (!open) {
    return (
      <button type="button" className="about-insp-drop about-insp-drop-btn" onClick={() => setOpen(true)}>
        <span className="about-insp-drop-plus" aria-hidden="true">
          +
        </span>
        <span className="about-insp-drop-label">粘贴音乐链接</span>
      </button>
    );
  }

  return (
    <div className="about-insp-form about-insp-form-song">
      <p className="about-insp-form-title">🔗 分享音乐链接（不上传音频文件）</p>

      <input
        className="about-insp-input"
        value={url}
        autoFocus
        placeholder="网易云 / QQ音乐 / Spotify 歌曲链接 https://…"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') detect();
        }}
      />
      <div className="about-insp-form-actions">
        <button type="button" className="about-insp-btn is-primary" onClick={() => detect()} disabled={busy}>
          {busy ? '识别中…' : '识别'}
        </button>
        <button type="button" className="about-insp-btn" onClick={reset}>
          取消
        </button>
      </div>

      {note ? <p className="about-insp-form-note">{note}</p> : null}
      {err ? <p className="about-insp-form-err">{err}</p> : null}

      {draft ? (
        <>
          <div className="about-insp-song-preview">
            <span className={`about-insp-song-thumb${draft.cover ? '' : ' is-empty'}`}>
              {draft.cover ? (
                <img src={draft.cover} alt="" />
              ) : (
                <span className="about-insp-song-thumb-note" aria-hidden="true">
                  ♪
                </span>
              )}
            </span>
            <div className="about-insp-song-fields">
              <input
                className="about-insp-input"
                value={draft.title}
                placeholder="歌名"
                onChange={(e) => patch({ title: e.target.value })}
              />
              <input
                className="about-insp-input"
                value={draft.artist}
                placeholder="歌手（可选）"
                onChange={(e) => patch({ artist: e.target.value })}
              />
            </div>
          </div>

          <input
            className="about-insp-input"
            value={draft.link}
            placeholder="原链接（点卡片会跳过去）"
            onChange={(e) => patch({ link: e.target.value })}
          />
          <CoverField
            value={draft.cover}
            onChange={(url) => patch({ cover: url })}
            placeholder="封面：平台一般会给一张；不满意就 Ctrl/⌘+V 粘一张"
          />
          <input
            className="about-insp-input"
            value={draft.genre}
            placeholder="曲风标签，如 #Ambient #CityPop（可选）"
            onChange={(e) => patch({ genre: e.target.value })}
          />

          <div className="about-insp-form-actions">
            {draft.embed ? (
              <span className="about-insp-form-ok" title={draft.embed}>
                ✓ 已拿到{draft.platform ? platformLabel(draft.platform) : ''}外链播放器
              </span>
            ) : (
              <span className="about-insp-form-note is-inline">
                没拿到播放器地址，卡片仍可跳转原链接
              </span>
            )}
          </div>

          <p className="about-insp-form-note">
            VIP / 付费歌曲由平台决定能放多少 —— 站外本就只能听到可试听的那一段，与官方一致。
          </p>

          <div className="about-insp-form-actions">
            <button type="button" className="about-insp-btn is-primary" onClick={save} disabled={busy}>
              添加这首歌
            </button>
            <button
              type="button"
              className="about-insp-btn"
              onClick={() => detect()}
              disabled={busy || !url.trim()}
            >
              重新识别
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** 音乐：只放专辑封面（整块可点 = 播放/暂停），下面接标题 / 歌手 / 曲风 */
function MusicGrid({
  items,
  isAdmin,
  onAdd,
  onDelete,
  onEdit,
}: {
  items: MusicItem[];
  isAdmin: boolean;
  onAdd: (item: MusicItem) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, patch: Record<string, unknown>) => void;
}) {
  const { track, playing, play } = usePlayer();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="about-insp-masonry about-insp-masonry-music">
      {items.map((m) => {
        const on = track?.id === m.id && playing;
        return (
          <article className={`about-insp-mcard${on ? ' is-playing' : ''}`} key={m.id}>
            {editingId === m.id ? (
              <InlineEditForm
                fields={[
                  { key: 'title', label: '歌曲标题' },
                  { key: 'artist', label: '歌手' },
                  {
                    key: 'embed',
                    label: '外链播放器地址',
                    placeholder: '外链播放器地址（embed）—— 有它才播得出声；点「重新识别」可自动填',
                  },
                  { key: 'genre', label: '曲风标签，如 #Ambient #Dreamcore' },
                  { key: 'cover', label: '封面', kind: 'cover' },
                  { key: 'link', label: '原链接（可选）', placeholder: '原链接 https://…（可选）' },
                ]}
                initial={{
                  title: m.title,
                  artist: m.artist ?? '',
                  embed: m.embed ?? '',
                  genre: m.genre.join(' '),
                  cover: m.cover.startsWith('idb:') ? '' : m.cover,
                  link: m.link ?? '',
                }}
                onRedetect={(v) => redetectFields(v.link ?? '')}
                onSave={(val) => {
                  const tags = parseTags(val.genre, 4);
                  // 已经拿到平台播放器了，「#外链」这个兜底标签就该退场（可能一个标签都不剩）
                  const pruned = tags.filter((g) => g !== '#外链');
                  onEdit(m.id, {
                    title: val.title.trim() || m.title,
                    artist: val.artist.trim() || undefined,
                    // 播放器地址直接覆盖（可以清空），不像封面那样「留空 = 不改」
                    embed: val.embed.trim() || undefined,
                    ...(val.platform ? { platform: val.platform } : {}),
                    ...(val.songId ? { songId: val.songId } : {}),
                    genre: val.platform ? pruned : tags,
                    link: val.link.trim() || undefined,
                    // 留空 = 不换封面
                    ...(val.cover.trim() ? { cover: val.cover.trim() } : {}),
                  });
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                {/* 专辑封面：整块就是播放键；识别不到封面时给个可点的占位 */}
                <button
                  type="button"
                  className={`about-insp-mcover${m.cover ? '' : ' is-empty'}${on ? ' is-on' : ''}`}
                  onClick={() => play(toTrack(m))}
                  aria-pressed={on}
                  aria-label={`${on ? '暂停' : '播放'} ${m.title}`}
                >
                  {m.cover ? (
                    <img src={m.cover} alt={`${m.title} 专辑封面`} loading="lazy" decoding="async" />
                  ) : (
                    <span className="about-insp-mcover-fallback">
                      <span className="about-insp-mcover-note" aria-hidden="true">
                        ♪
                      </span>
                      暂无封面
                    </span>
                  )}
                  {on ? (
                    <span className="about-insp-mnow" aria-hidden="true">
                      <span className="about-insp-meq">
                        <b />
                        <b />
                        <b />
                      </span>
                      播放中
                    </span>
                  ) : null}
                  <span className="about-insp-mcover-play" aria-hidden="true">
                    <span className={`about-insp-mplay-icon${on ? ' is-pause' : ''}`} />
                  </span>
                </button>

                <div className="about-insp-mmeta">
                  <div className="about-insp-mtext">
                    <p className="about-insp-mtitle">{m.title}</p>
                    {m.artist ? <p className="about-insp-martist">{m.artist}</p> : null}
                    <p className="about-insp-mgenres">
                      {m.genre.map((g) => (
                        <span className="about-insp-mgenre" key={g}>
                          {g}
                        </span>
                      ))}
                      {platformLabel(m.platform) ? (
                        <span className="about-insp-mgenre is-platform" title="由平台外链播放器播放">
                          {platformLabel(m.platform)}
                        </span>
                      ) : null}
                    </p>
                    {m.link ? (
                      <a
                        className="about-insp-msrc"
                        href={m.link}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                      >
                        ↗ 去原站听
                      </a>
                    ) : null}
                  </div>
                </div>
                {isAdmin ? (
                  <>
                    <EditButton onClick={() => setEditingId(m.id)} label={`编辑音乐 ${m.title}`} />
                    <DelButton onClick={() => onDelete(m.id)} label={`删除音乐 ${m.title}`} />
                  </>
                ) : null}
              </>
            )}
          </article>
        );
      })}
      {isAdmin ? (
        <div className="about-insp-addrow">
          <SongAddForm onAdd={onAdd} />
          <MusicLinkAddForm onAdd={onAdd} />
        </div>
      ) : null}
    </div>
  );
}

/** AI 项目：复古软盘卡（完整封面 + 查看链接） */
function ProjectGrid({
  items,
  isAdmin,
  onAdd,
  onDelete,
  onEdit,
}: {
  items: ProjectItem[];
  isAdmin: boolean;
  onAdd: (item: ProjectItem) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="about-insp-pgrid">
      {items.map((p) => (
        <article className="about-insp-pcard" key={p.id}>
          {editingId === p.id ? (
            <InlineEditForm
              fields={[
                { key: 'name', label: '项目名称' },
                { key: 'desc', label: '一句话简介（可选）' },
                { key: 'tags', label: '标签，如 #LLM #Canvas' },
                { key: 'link', label: '项目链接 https://…' },
                { key: 'cover', label: '封面', kind: 'cover' },
              ]}
              initial={{
                name: p.name,
                desc: p.desc ?? '',
                tags: p.tags.join(' '),
                link: p.link ?? '',
                cover: p.cover.startsWith('idb:') ? '' : p.cover,
              }}
              onSave={(val) => {
                onEdit(p.id, {
                  name: val.name.trim() || p.name,
                  desc: val.desc.trim() || undefined,
                  tags: parseTags(val.tags),
                  link: val.link.trim() || undefined,
                  source: /github\.com/i.test(val.link) ? 'github' : 'manual',
                  ...(val.cover.trim() ? { cover: val.cover.trim() } : {}),
                });
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <span className="about-insp-pflap" aria-hidden="true" />
              {p.link ? (
                <a className="about-insp-pcover" href={p.link} target="_blank" rel="noreferrer noopener" aria-label={`打开 ${p.name}`}>
                  <img src={p.cover} alt="" loading="lazy" decoding="async" />
                </a>
              ) : (
                <div className="about-insp-pcover">
                  <img src={p.cover} alt="" loading="lazy" decoding="async" />
                </div>
              )}
              <div className="about-insp-pbody">
            <p className="about-insp-pname">
              {p.name}
              {typeof p.stars === 'number' && p.stars > 0 ? (
                <span className="about-insp-pstars" aria-label={`${p.stars} star`}>
                  ★{p.stars > 999 ? `${(p.stars / 1000).toFixed(1)}k` : p.stars}
                </span>
              ) : null}
            </p>
            {p.desc ? <p className="about-insp-pdesc">{p.desc}</p> : null}
            <p className="about-insp-ptags">
              {p.tags.map((t) => (
                <span className="about-insp-ptag" key={t}>
                  {t}
                </span>
              ))}
            </p>
            {p.link ? (
              <a className="about-insp-pdemo" href={p.link} target="_blank" rel="noreferrer noopener">
                [ 查看 ]
              </a>
            ) : (
              <span className="about-insp-pdemo is-disabled" aria-disabled="true" title="链接待补充">
                [ 查看 ]
              </span>
            )}
              </div>
            </>
          )}
          {isAdmin ? (
            <>
              {/* 编辑态下不再显示 ✎（点了没变化会让人以为坏了）；✕ 保留，改到一半想删也行 */}
              {editingId === p.id ? null : (
                <EditButton onClick={() => setEditingId(p.id)} label={`编辑项目 ${p.name}`} />
              )}
              <DelButton onClick={() => onDelete(p.id)} label={`删除项目 ${p.name}`} />
            </>
          ) : null}
        </article>
      ))}
      {isAdmin ? <ProjectAddForm onAdd={onAdd} /> : null}
    </div>
  );
}

/** 链接卡：案例 / 知识共用（封面 + 标题 + 点击跳转） */
function LinkGrid({
  items,
  isAdmin,
  onAdd,
  onDelete,
  onEdit,
}: {
  items: LinkItem[];
  isAdmin: boolean;
  onAdd: (item: LinkItem) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="about-insp-lgrid">
      {items.map((it) => (
        <article className="about-insp-lcard" key={it.id}>
          {editingId === it.id ? (
            <InlineEditForm
              fields={[
                { key: 'title', label: '标题' },
                { key: 'link', label: '跳转链接' },
                { key: 'tags', label: '标签，如 #TVC #策划' },
                { key: 'cover', label: '封面', kind: 'cover' },
              ]}
              initial={{
                title: it.title,
                link: it.link,
                tags: (it.tags ?? []).join(' '),
                // 留空 = 不换封面；想换就粘一张新图
                cover: it.cover.startsWith('idb:') ? '' : it.cover,
              }}
              onRedetect={(v) => redetectFields(v.link ?? '')}
              onSave={(val) => {
                onEdit(it.id, {
                  title: val.title.trim() || it.title,
                  link: val.link.trim() || it.link,
                  tags: parseTags(val.tags),
                  ...(val.cover.trim() ? { cover: val.cover.trim() } : {}),
                });
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <a className="about-insp-lcover" href={it.link} target="_blank" rel="noreferrer noopener" aria-label={`打开 ${it.title}`}>
                <img src={it.cover} alt="" loading="lazy" decoding="async" />
                <span className="about-insp-lgo" aria-hidden="true">
                  ↗
                </span>
              </a>
              <div className="about-insp-lbody">
                <p className="about-insp-ltitle">{it.title}</p>
                {it.tags?.length ? (
                  <p className="about-insp-ltags">
                    {it.tags.map((t) => (
                      <span className="about-insp-ltag" key={t}>
                        {t}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            </>
          )}
          {isAdmin ? (
            <>
              {editingId === it.id ? null : (
                <EditButton onClick={() => setEditingId(it.id)} label={`编辑 ${it.title}`} />
              )}
              <DelButton onClick={() => onDelete(it.id)} label={`删除 ${it.title}`} />
            </>
          ) : null}
        </article>
      ))}
      {isAdmin ? <LinkAddBox onAdd={onAdd} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 作者模式：数据管理条                                                 */
/* ------------------------------------------------------------------ */

const MODE_TEXT: Record<string, { label: string; hint: string }> = {
  remote: {
    label: '云端',
    hint: '改动直接发往服务器云端（图片存 Vercel Blob，数据存云数据库）—— 换设备、清缓存、刷新都还在，除非你在作者模式删除。',
  },
  project: {
    label: '项目文件',
    hint: '改动写进 public/insp/data.json —— 刷新、换浏览器、重新构建部署都带着走。',
  },
  browser: {
    label: '仅本浏览器',
    hint: '改动只存在这台机器的 localStorage / IndexedDB。用 npm run dev 打开就能写进项目文件。',
  },
};

/**
 * 作者工具条：告诉你「改动落在哪」，并给导出 / 导入 / 恢复默认三个动作。
 * 隐藏在灵感收藏标题右侧，只有作者模式出现 —— 访客看不到任何入口。
 */
function AuthorBar({ onChanged }: { onChanged: () => void }) {
  const [mode, setMode] = useState<string>('browser');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 存储后端在模块加载时就确定了（USE_REMOTE 是常量），直接读即可；
    // 只有 dev 下的 project 模式需要探一下 /__studio 通道是否可用。
    void ensureProjectWriter().then(() => setMode(storageMode()));
  }, []);

  const download = () => {
    const blob = new Blob([exportStore()], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inspiration-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const pickImport = (f: File | null) => {
    if (!f) return;
    setErr('');
    setOk('');
    void (async () => {
      try {
        const done = await importStore(await f.text());
        if (!done) throw new Error('文件里没有可识别的收藏数据');
        setOk('已导入');
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : '导入失败');
      }
    })();
  };

  const doReset = () => {
    if (!window.confirm('恢复成代码里的初始内容？你现在收藏的所有条目会被覆盖。')) return;
    void (async () => {
      await resetStore();
      setOk('已恢复默认');
      onChanged();
    })();
  };

  /** 换真实内容时的第一步：先把种子里那些占位条目一次清干净 */
  const doClear = () => {
    if (!window.confirm('清空六个分类里的全部条目？清完就能从零录入真实内容。')) return;
    void (async () => {
      await clearStore();
      setOk('已清空');
      onChanged();
    })();
  };

  const info = MODE_TEXT[mode] ?? MODE_TEXT.browser;
  const persistErr = lastPersistError();

  return (
    <div className="about-insp-authorbar">
      <span className={`about-insp-store is-${mode}`} title={info.hint}>
        <span className="about-insp-store-dot" aria-hidden="true" />
        存于：{info.label}
      </span>
      <span className="about-insp-store-hint">{info.hint}</span>
      <div className="about-insp-authorbar-actions">
        <button type="button" className="about-insp-btn" onClick={download}>
          导出 JSON
        </button>
        <button type="button" className="about-insp-btn" onClick={() => fileRef.current?.click()}>
          导入 JSON
        </button>
        <button type="button" className="about-insp-btn" onClick={doClear}>
          清空全部
        </button>
        <button type="button" className="about-insp-btn is-danger" onClick={doReset}>
          恢复默认
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => pickImport(e.target.files?.[0] ?? null)}
        />
      </div>
      {persistErr ? (
        <p className="about-insp-form-err">上次保存没写进磁盘：{persistErr}</p>
      ) : null}
      {err ? <p className="about-insp-form-err">{err}</p> : null}
      {ok ? <p className="about-insp-form-note">{ok}</p> : null}
    </div>
  );
}

/** 二级页签台子 */
function SubTabs({
  tabs,
  active,
  onPick,
}: {
  tabs: SubTab[];
  active: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="about-insp-subtabs" role="tablist" aria-label="二级分类">
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button
            type="button"
            key={t.id}
            role="tab"
            aria-selected={on}
            className={`about-insp-subtab${on ? ' is-active' : ''}`}
            onClick={() => onPick(t.id)}
          >
            <span aria-hidden="true">[&nbsp;</span>
            {t.label}
            <span aria-hidden="true">&nbsp;]</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 主组件                                                              */
/* ------------------------------------------------------------------ */

/**
 * 「灵感收藏」内容区 —— Y2K 复古像素 / Webmaster Style。
 *
 * 数据：六类卡片全部来自 contentApi.getCollection（内存里的 MOCK 副本，
 *   挂云端后换成 fetch/PATCH 即可，组件零改动）。
 * 权限：useAdmin() 决定显不显示上传框 / 删除按钮 / 新增表单；访客模式自动只读。
 * 播放：usePlayer() 与右栏 jukebox 共用播放状态。
 */
export function AboutInspiration() {
  const isAdmin = useAdmin();

  const [vision, setVision] = useState<VisionItem[]>(() => getCollection('vision'));
  const [music, setMusic] = useState<MusicItem[]>(() => getCollection('music'));
  const [projects, setProjects] = useState<ProjectItem[]>(() => getCollection('projects'));
  const [cases, setCases] = useState<LinkItem[]>(() => getCollection('cases'));
  const [knowledge, setKnowledge] = useState<LinkItem[]>(() => getCollection('knowledge'));
  const [zoom, setZoom] = useState<LightboxItem | null>(null);

  const [active, setActive] = useState('cases');
  const [sub, setSub] = useState<Record<string, string>>(DEFAULT_SUB);

  /** 刷新视图数据；上传文件在数据里是 `idb:` 落盘引用，这里换成可显示的 object URL */
  const refresh = async () => {
    const [v, m, p, c, k] = await Promise.all([
      resolveIdbRefs(getCollection('vision'), ['src']),
      resolveIdbRefs(getCollection('music'), ['src', 'cover']),
      resolveIdbRefs(getCollection('projects'), ['cover']),
      resolveIdbRefs(getCollection('cases'), []),
      resolveIdbRefs(getCollection('knowledge'), []),
    ]);
    setVision(v);
    setMusic(m);
    setProjects(p);
    setCases(c);
    setKnowledge(k);
  };

  /* 挂载时：① 先把更持久的那层（远端 / public/insp/data.json）读进来，
     ② 再把 `idb:` 落盘引用解析成可显示/可播放的地址（上传内容刷新后依然在）。 */
  useEffect(() => {
    void (async () => {
      await hydrate();
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 作者模式编辑：按 id 合并保存（写回 localStorage，刷新不丢） */
  const onEditItem = async (key: CollectionKey, id: string, patch: Record<string, unknown>) => {
    await updateItem(key, id, patch as never);
    await refresh();
  };

  /** 作者上传视觉图片 → 生成占位条目 */
  const onUploadVision = async (file: File) => {
    const { url } = await uploadFile(file);
    await addItem('vision', { id: `vision-${Date.now()}`, src: url, title: '未命名图片', code: 'NEW', ratio: '4/5' });
    refresh();
  };

  /** 粘贴进来的是图片地址（不是文件本体）→ 直接存这条外链图 */
  const onPasteVisionUrl = async (url: string) => {
    await addItem('vision', { id: `vision-${Date.now()}`, src: url, title: '未命名图片', code: 'NEW', ratio: '4/5' });
    refresh();
  };

  /** 作者上传歌曲 → 表单里已经识别过标签，这里只落库 */
  const onAddMusic = async (item: MusicItem) => {
    await addItem('music', item);
    refresh();
  };

  const onAddProject = async (item: ProjectItem) => {
    await addItem('projects', item);
    refresh();
  };

  const onAddLink = async (key: 'cases' | 'knowledge', item: LinkItem) => {
    await addItem(key, item);
    refresh();
  };

  const onDelete = async (key: CollectionKey, id: string) => {
    await removeItem(key, id);
    refresh();
  };

  const subOf = (catId: string) => sub[catId] ?? DEFAULT_SUB[catId];
  const pickSub = (catId: string, id: string) => setSub((s) => ({ ...s, [catId]: id }));

  const renderRich = (catId: string) => {
    const cur = subOf(catId);
    if (catId === 'aesthetics') {
      return (
        <>
          <SubTabs tabs={SUBTABS.aesthetics} active={cur} onPick={(id) => pickSub('aesthetics', id)} />
          {cur === 'vision' ? (
            <VisionGrid
              items={byNewest(vision)}
              isAdmin={isAdmin}
              onOpen={setZoom}
              onAdd={onUploadVision}
              onAddUrl={onPasteVisionUrl}
              onDelete={(id) => onDelete('vision', id)}
              onEdit={(id, patch) => onEditItem('vision', id, patch)}
            />
          ) : (
            <MusicGrid
              items={byNewest(music)}
              isAdmin={isAdmin}
              onAdd={onAddMusic}
              onDelete={(id) => onDelete('music', id)}
              onEdit={(id, patch) => onEditItem('music', id, patch)}
            />
          )}
        </>
      );
    }
    /* AI实验室：不再分「项目 / 技能」两个页签 —— 一个列表混着放，按时间从新到旧。 */
    return (
      <ProjectGrid
        items={byNewest(projects)}
        isAdmin={isAdmin}
        onAdd={onAddProject}
        onDelete={(id) => onDelete('projects', id)}
        onEdit={(id, patch) => onEditItem('projects', id, patch)}
      />
    );
  };

  return (
    <div className="about-insp">
      <header className="about-insp-head">
        <h3 className="about-insp-title">
          <span className="about-insp-title-star" aria-hidden="true">
            ☆
          </span>
          灵感收藏
        </h3>
        <span className="about-insp-title-en">inspiration</span>
        {isAdmin ? (
          <span className="about-insp-edit-badge" title="作者模式：可上传 / 删除">
            ✎ 作者模式
          </span>
        ) : null}
      </header>

      {/* 作者工具条：改动落在哪 + 导出 / 导入 / 恢复默认（仅作者模式） */}
      {isAdmin ? <AuthorBar onChanged={() => void refresh()} /> : null}

      {/* 一级分类台子 */}
      <div className="about-insp-tabs" role="tablist" aria-label="灵感收藏分类">
        {TABS.map((t) => {
          const on = active === t.id;
          return (
            <button
              type="button"
              key={t.id}
              role="tab"
              aria-selected={on}
              className={`about-insp-tab${on ? ' is-active' : ''}`}
              onClick={(e) => {
                setActive(t.id);
                e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' });
              }}
            >
              <span className="about-insp-tab-icon" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      {active === 'cases' ? (
        <LinkGrid
          items={byNewest(cases)}
          isAdmin={isAdmin}
          onAdd={(it) => onAddLink('cases', it)}
          onDelete={(id) => onDelete('cases', id)}
          onEdit={(id, patch) => onEditItem('cases', id, patch)}
        />
      ) : active === 'knowledge' ? (
        <LinkGrid
          items={byNewest(knowledge)}
          isAdmin={isAdmin}
          onAdd={(it) => onAddLink('knowledge', it)}
          onDelete={(id) => onDelete('knowledge', id)}
          onEdit={(id, patch) => onEditItem('knowledge', id, patch)}
        />
      ) : (
        renderRich(active)
      )}

      <InspLightbox item={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}
