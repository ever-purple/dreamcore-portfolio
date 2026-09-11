import { useRef, useState, type CSSProperties } from 'react';
import { InspLightbox, type LightboxItem } from '@/components/InspLightbox';
import { useAdmin } from '@/context/AdminContext';
import { usePlayer } from '@/context/PlayerContext';
import {
  addItem,
  fetchLinkMeta,
  getCollection,
  removeItem,
  uploadFile,
  type CollectionKey,
} from '@/lib/contentApi';
import { readAudioTags, type AudioTags } from '@/lib/audioTags';
import type { LinkItem, MusicItem, ProjectItem, SkillItem, VisionItem } from '@/data/inspiration';

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
  ai_lab: [
    { id: 'projects', label: 'Projects' },
    { id: 'skills', label: 'Skills' },
  ],
};

const DEFAULT_SUB: Record<string, string> = { aesthetics: 'vision', ai_lab: 'projects' };

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

/** 图片拖拽 / 点选上传框（作者模式才出现） */
function ImageDropzone({
  label,
  onFile,
}: {
  label: string;
  onFile: (file: File) => void;
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

  return (
    <div
      className={`about-insp-drop${drag ? ' is-drag' : ''}${busy ? ' is-busy' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
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
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 作者模式：新增表单                                                   */
/* ------------------------------------------------------------------ */

/** 粘贴链接 → 自动识别标题 / 封面（案例 & 知识共用） */
function LinkAddBox({ onAdd }: { onAdd: (item: LinkItem) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = () => {
    const u = url.trim();
    if (!u) {
      setErr('先粘贴一个链接');
      return;
    }
    setBusy(true);
    setErr('');
    void (async () => {
      try {
        const meta = await fetchLinkMeta(u);
        onAdd({ id: `link-${Date.now()}`, title: meta.title, cover: meta.cover, link: meta.url });
        setUrl('');
        setOpen(false);
      } catch {
        setErr('识别失败，请重试');
      } finally {
        setBusy(false);
      }
    })();
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
      <p className="about-insp-form-title">🔗 粘贴链接，自动识别封面与标题</p>
      <input
        className="about-insp-input"
        value={url}
        autoFocus
        placeholder="https://…"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      {err ? <p className="about-insp-form-err">{err}</p> : null}
      <div className="about-insp-form-actions">
        <button type="button" className="about-insp-btn is-primary" onClick={submit} disabled={busy}>
          {busy ? '识别中…' : '识别并添加'}
        </button>
        <button type="button" className="about-insp-btn" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 新增 AI 项目：名称 + 标签 + 链接 + 封面（可上传 / 可留空） */
function ProjectAddForm({ onAdd }: { onAdd: (item: ProjectItem) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [link, setLink] = useState('');
  const [cover, setCover] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName('');
    setTags('');
    setLink('');
    setCover('');
    setOpen(false);
  };

  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      id: `projects-${Date.now()}`,
      name: name.trim(),
      cover: cover || '/about/banner-visual.jpeg',
      tags: tags
        .split(/[\s,，]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t : `#${t}`)),
      link: link.trim() || undefined,
    });
    reset();
  };

  const pickCover = (f: File | null) => {
    if (!f) return;
    setBusy(true);
    void (async () => {
      const { url } = await uploadFile(f);
      setCover(url);
      setBusy(false);
    })();
  };

  if (!open) {
    return (
      <button type="button" className="about-insp-drop about-insp-drop-btn" onClick={() => setOpen(true)}>
        <span className="about-insp-drop-plus" aria-hidden="true">
          +
        </span>
        <span className="about-insp-drop-label">新增项目</span>
      </button>
    );
  }

  return (
    <div className="about-insp-form">
      <p className="about-insp-form-title">💾 新增项目</p>
      <input className="about-insp-input" value={name} autoFocus placeholder="项目名称" onChange={(e) => setName(e.target.value)} />
      <input className="about-insp-input" value={tags} placeholder="标签，如 #LLM #Canvas" onChange={(e) => setTags(e.target.value)} />
      <input className="about-insp-input" value={link} placeholder="项目链接 https://…" onChange={(e) => setLink(e.target.value)} />
      <button type="button" className="about-insp-btn about-insp-cover-pick" onClick={() => fileRef.current?.click()}>
        {busy ? '上传中…' : cover ? '✓ 封面已选（点击更换）' : '选择封面图（可选）'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickCover(e.target.files?.[0] ?? null)} />
      <div className="about-insp-form-actions">
        <button type="button" className="about-insp-btn is-primary" onClick={submit}>
          添加
        </button>
        <button type="button" className="about-insp-btn" onClick={reset}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 新增 AI 技能：图标 + 名称 + 功能描述 + 链接 */
function SkillAddForm({ onAdd }: { onAdd: (item: SkillItem) => void }) {
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState('✨');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [link, setLink] = useState('');

  const reset = () => {
    setIcon('✨');
    setName('');
    setDesc('');
    setLink('');
    setOpen(false);
  };

  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      id: `skills-${Date.now()}`,
      icon: icon.trim() || '✨',
      name: name.trim(),
      desc: desc.trim() || undefined,
      link: link.trim() || undefined,
    });
    reset();
  };

  if (!open) {
    return (
      <button type="button" className="about-insp-skill-add" onClick={() => setOpen(true)} aria-label="添加技能">
        <span className="about-insp-skill-add-plus" aria-hidden="true">
          +
        </span>
        <span>添加技能</span>
      </button>
    );
  }

  return (
    <div className="about-insp-form about-insp-form-skill">
      <p className="about-insp-form-title">🧩 新增技能</p>
      <div className="about-insp-form-row">
        <input className="about-insp-input about-insp-input-icon" value={icon} placeholder="✨" onChange={(e) => setIcon(e.target.value)} />
        <input className="about-insp-input" value={name} autoFocus placeholder="技能名称" onChange={(e) => setName(e.target.value)} />
      </div>
      <input className="about-insp-input" value={desc} placeholder="功能描述：这个 skill 能干什么" onChange={(e) => setDesc(e.target.value)} />
      <input className="about-insp-input" value={link} placeholder="链接 https://…" onChange={(e) => setLink(e.target.value)} />
      <div className="about-insp-form-actions">
        <button type="button" className="about-insp-btn is-primary" onClick={submit}>
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
  onDelete,
}: {
  items: VisionItem[];
  isAdmin: boolean;
  onOpen: (item: LightboxItem) => void;
  onAdd: (file: File) => void;
  onDelete: (id: string) => void;
}) {
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
            if ((e.target as Element).closest('.about-insp-del')) return;
            onOpen({ src: v.src, title: v.title, code: v.code, link: v.link });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen({ src: v.src, title: v.title, code: v.code, link: v.link });
            }
          }}
        >
          <span className="about-insp-vmedia">
            <img className="about-insp-vimg" src={v.src} alt={v.title} loading="lazy" decoding="async" />
            <span className="about-insp-vcode">{v.code}</span>
            <span className="about-insp-vhint">🔍 点击看大图</span>
          </span>
          {isAdmin ? <DelButton onClick={() => onDelete(v.id)} label={`删除图片 ${v.title}`} /> : null}
        </div>
      ))}
      {isAdmin ? <ImageDropzone label="拖拽 / 点选图片上传" onFile={onAdd} /> : null}
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
  const coverRef = useRef<HTMLInputElement>(null);
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

  const pickCover = (f: File | null) => {
    if (!f || !draft) return;
    setBusy(true);
    void (async () => {
      const { url } = await uploadFile(f);
      setDraft((d) => (d ? { ...d, cover: url } : d));
      setBusy(false);
    })();
  };

  const save = () => {
    if (!draft) return;
    const genres = draft.genre
      .split(/[\s,，/]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .slice(0, 4);
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

          <div className="about-insp-form-actions">
            <button type="button" className="about-insp-btn" onClick={() => coverRef.current?.click()}>
              {draft.cover ? '换一张封面' : '手动选封面'}
            </button>
            {draft.tagCover && draft.cover !== draft.tagCover ? (
              <button type="button" className="about-insp-btn" onClick={() => patch({ cover: draft.tagCover })}>
                用回识别到的
              </button>
            ) : null}
            {draft.cover ? (
              <button type="button" className="about-insp-btn" onClick={() => patch({ cover: '' })}>
                清空封面
              </button>
            ) : null}
          </div>
          <input
            ref={coverRef}
            className="about-insp-song-cover-file"
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pickCover(e.target.files?.[0] ?? null)}
          />

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

/** 音乐：只放专辑封面（整块可点 = 播放/暂停），下面接标题 / 歌手 / 曲风 */
function MusicGrid({
  items,
  isAdmin,
  onAdd,
  onDelete,
}: {
  items: MusicItem[];
  isAdmin: boolean;
  onAdd: (item: MusicItem) => void;
  onDelete: (id: string) => void;
}) {
  const { track, playing, play } = usePlayer();

  return (
    <div className="about-insp-masonry about-insp-masonry-music">
      {items.map((m) => {
        const on = track?.id === m.id && playing;
        return (
          <article className={`about-insp-mcard${on ? ' is-playing' : ''}`} key={m.id}>
            {/* 专辑封面：整块就是播放键；识别不到封面时给个可点的占位 */}
            <button
              type="button"
              className={`about-insp-mcover${m.cover ? '' : ' is-empty'}${on ? ' is-on' : ''}`}
              onClick={() => play({ id: m.id, title: m.title, cover: m.cover, src: m.src })}
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
                </p>
              </div>
            </div>
            {isAdmin ? <DelButton onClick={() => onDelete(m.id)} label={`删除音乐 ${m.title}`} /> : null}
          </article>
        );
      })}
      {isAdmin ? <SongAddForm onAdd={onAdd} /> : null}
    </div>
  );
}

/** AI 项目：复古软盘卡（完整封面 + 查看链接） */
function ProjectGrid({
  items,
  isAdmin,
  onAdd,
  onDelete,
}: {
  items: ProjectItem[];
  isAdmin: boolean;
  onAdd: (item: ProjectItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="about-insp-pgrid">
      {items.map((p) => (
        <article className="about-insp-pcard" key={p.id}>
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
            <p className="about-insp-pname">{p.name}</p>
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
          {isAdmin ? <DelButton onClick={() => onDelete(p.id)} label={`删除项目 ${p.name}`} /> : null}
        </article>
      ))}
      {isAdmin ? <ProjectAddForm onAdd={onAdd} /> : null}
    </div>
  );
}

/** AI 技能：技能卡（图标 + 名称 + 功能描述 + 链接） */
function SkillWall({
  items,
  isAdmin,
  onAdd,
  onDelete,
}: {
  items: SkillItem[];
  isAdmin: boolean;
  onAdd: (item: SkillItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="about-insp-sgrid">
      {items.map((s) => {
        const inner = (
          <>
            <span className="about-insp-skill-icon" aria-hidden="true">
              {s.icon}
            </span>
            <span className="about-insp-skill-body">
              <span className="about-insp-skill-name">{s.name}</span>
              {s.desc ? <span className="about-insp-skill-desc">{s.desc}</span> : null}
            </span>
          </>
        );
        return (
          <div className="about-insp-skill" key={s.id}>
            {s.link ? (
              <a
                className="about-insp-skill-hit"
                href={s.link}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`打开 ${s.name}`}
              >
                {inner}
              </a>
            ) : (
              <span className="about-insp-skill-hit">{inner}</span>
            )}
            {isAdmin ? <DelButton onClick={() => onDelete(s.id)} label={`删除技能 ${s.name}`} /> : null}
          </div>
        );
      })}
      {isAdmin ? <SkillAddForm onAdd={onAdd} /> : null}
    </div>
  );
}

/** 链接卡：案例 / 知识共用（封面 + 标题 + 点击跳转） */
function LinkGrid({
  items,
  isAdmin,
  onAdd,
  onDelete,
}: {
  items: LinkItem[];
  isAdmin: boolean;
  onAdd: (item: LinkItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="about-insp-lgrid">
      {items.map((it) => (
        <article className="about-insp-lcard" key={it.id}>
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
          {isAdmin ? <DelButton onClick={() => onDelete(it.id)} label={`删除 ${it.title}`} /> : null}
        </article>
      ))}
      {isAdmin ? <LinkAddBox onAdd={onAdd} /> : null}
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
  const [skills, setSkills] = useState<SkillItem[]>(() => getCollection('skills'));
  const [cases, setCases] = useState<LinkItem[]>(() => getCollection('cases'));
  const [knowledge, setKnowledge] = useState<LinkItem[]>(() => getCollection('knowledge'));
  const [zoom, setZoom] = useState<LightboxItem | null>(null);

  const [active, setActive] = useState('cases');
  const [sub, setSub] = useState<Record<string, string>>(DEFAULT_SUB);

  const refresh = () => {
    setVision(getCollection('vision'));
    setMusic(getCollection('music'));
    setProjects(getCollection('projects'));
    setSkills(getCollection('skills'));
    setCases(getCollection('cases'));
    setKnowledge(getCollection('knowledge'));
  };

  /** 作者上传视觉图片 → 生成占位条目 */
  const onUploadVision = async (file: File) => {
    const { url } = await uploadFile(file);
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

  const onAddSkill = async (item: SkillItem) => {
    await addItem('skills', item);
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
              items={vision}
              isAdmin={isAdmin}
              onOpen={setZoom}
              onAdd={onUploadVision}
              onDelete={(id) => onDelete('vision', id)}
            />
          ) : (
            <MusicGrid items={music} isAdmin={isAdmin} onAdd={onAddMusic} onDelete={(id) => onDelete('music', id)} />
          )}
        </>
      );
    }
    return (
      <>
        <SubTabs tabs={SUBTABS.ai_lab} active={cur} onPick={(id) => pickSub('ai_lab', id)} />
        {cur === 'projects' ? (
          <ProjectGrid items={projects} isAdmin={isAdmin} onAdd={onAddProject} onDelete={(id) => onDelete('projects', id)} />
        ) : (
          <SkillWall items={skills} isAdmin={isAdmin} onAdd={onAddSkill} onDelete={(id) => onDelete('skills', id)} />
        )}
      </>
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
          items={cases}
          isAdmin={isAdmin}
          onAdd={(it) => onAddLink('cases', it)}
          onDelete={(id) => onDelete('cases', id)}
        />
      ) : active === 'knowledge' ? (
        <LinkGrid
          items={knowledge}
          isAdmin={isAdmin}
          onAdd={(it) => onAddLink('knowledge', it)}
          onDelete={(id) => onDelete('knowledge', id)}
        />
      ) : (
        renderRich(active)
      )}

      <InspLightbox item={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}
