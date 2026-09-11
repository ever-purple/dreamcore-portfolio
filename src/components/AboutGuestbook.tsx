import { useCallback, useEffect, useRef, useState } from 'react';

type Entry = {
  id: string;
  name: string;
  /** 仅对留言簿持有者可见，不在前台展示 */
  email: string;
  html: string;
  ts: number;
};

const STORE_KEY = 'dreamcore.guestbook.v1';
const MAX_TEXT = 500;
const RECENT = 3;

/** 预置示例留言：真实留言会自然把它们挤出"最近 3 条" */
const SEED: Entry[] = [
  {
    id: 'seed-1',
    name: '小满',
    email: '',
    html: '页面好看！<b>绿色调</b>很舒服，收藏了 🌿',
    ts: Date.now() - 1000 * 60 * 96,
  },
  {
    id: 'seed-2',
    name: '路过的猫',
    email: '',
    html: '小人可以拖着走，玩了好久 (๑•̀ㅂ•́)و',
    ts: Date.now() - 1000 * 60 * 60 * 26,
  },
  {
    id: 'seed-3',
    name: '匿名',
    email: '',
    html: '排版细节很用心，等更新 ✨',
    ts: Date.now() - 1000 * 60 * 60 * 52,
  },
];

const EMOJIS = [
  '😊', '😄', '🥹', '😎', '🌿', '🍀', '🌱', '✨',
  '⭐', '💚', '🐱', '🎧', '📮', '☁️', '🌙', '🫧',
  'ヽ(・∀・)ﾉ', '(๑•̀ㅂ•́)و', '(´･ω･`)', '(*・ω・)ﾉ',
];

const COLORS = ['#2f7f66', '#7ee8c7', '#6a8fd8', '#8a6ad8', '#d98ba8', '#c9772f', '#b08a4f', '#3b3b3b'];

const SIZES: { label: string; value: string }[] = [
  { label: '小', value: '2' },
  { label: '中', value: '3' },
  { label: '大', value: '5' },
];

/* ---------- 富文本清洗：只留白名单标签/属性，避免留言里塞脚本 ---------- */
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'A', 'BR', 'DIV', 'P', 'FONT']);
/** 这些标签连同内容一起丢掉（否则 <script>alert(1)</script> 会把代码当文字显示出来） */
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH', 'FORM', 'INPUT', 'TEXTAREA', 'BUTTON']);
const ALLOWED_STYLE = new Set(['color', 'font-size', 'font-weight', 'font-style', 'text-decoration']);

function sanitize(raw: string): string {
  if (typeof DOMParser === 'undefined') return raw.replace(/[<>]/g, '');
  const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';

  const walk = (node: Element) => {
    [...node.children].forEach((child) => {
      if (DROPPED_TAGS.has(child.tagName)) {
        child.remove();
        return;
      }
      walk(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        const frag = doc.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        return;
      }
      [...child.attributes].forEach((attr) => {
        const key = attr.name.toLowerCase();
        if (key === 'href' && child.tagName === 'A') {
          const url = attr.value.trim();
          if (/^(https?:|mailto:|\/)/i.test(url)) {
            child.setAttribute('href', url);
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          } else {
            child.removeAttribute('href');
          }
          return;
        }
        if (key === 'style') {
          const keep = attr.value
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean)
            .filter((decl) => ALLOWED_STYLE.has((decl.split(':')[0] || '').trim().toLowerCase()))
            .join('; ');
          if (keep) child.setAttribute('style', keep);
          else child.removeAttribute('style');
          return;
        }
        if (key === 'size' && child.tagName === 'FONT') return;
        child.removeAttribute(attr.name);
      });
    });
  };
  walk(root);
  return root.innerHTML;
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

type Pop = 'color' | 'emoji' | 'link' | null;

/**
 * 「留言板」内容区：上方留言表单（姓名 / 电子邮件 / 富文本 + 表情），下方最近 3 条留言。
 * 无后端 → 存在 localStorage；姓名留空即匿名；电子邮件只收不展示。
 */
export function AboutGuestbook() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entry[]>(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as Entry[];
      }
    } catch {
      /* 读取失败就用示例数据 */
    }
    return SEED;
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mark, setMark] = useState({ bold: false, italic: false, underline: false });
  const [pop, setPop] = useState<Pop>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const save = useCallback((next: Entry[]) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* 隐私模式下写不进去就只在内存里留着 */
    }
  }, []);

  useEffect(() => {
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* 老浏览器忽略 */
    }
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(''), 2600);
    return () => window.clearTimeout(t);
  }, [flash]);

  const syncMark = useCallback(() => {
    try {
      setMark({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
    } catch {
      /* ignore */
    }
  }, []);

  /** 执行编辑命令；先把焦点还给编辑区，否则 selection 已丢 */
  const cmd = useCallback(
    (command: string, value?: string) => {
      editorRef.current?.focus();
      try {
        document.execCommand(command, false, value);
      } catch {
        /* ignore */
      }
      syncMark();
    },
    [syncMark],
  );

  const insert = useCallback(
    (text: string) => {
      editorRef.current?.focus();
      try {
        document.execCommand('insertText', false, text);
      } catch {
        editorRef.current?.appendChild(document.createTextNode(text));
      }
      setPop(null);
      syncMark();
    },
    [syncMark],
  );

  const applyLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) return;
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    cmd('createLink', href);
    setLinkUrl('');
    setPop(null);
  }, [cmd, linkUrl]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const html = sanitize(editorRef.current?.innerHTML ?? '');
    const plain = textOf(html);
    if (!plain) {
      setError('先写点什么再发送吧');
      return;
    }
    if (plain.length > MAX_TEXT) {
      setError(`最多 ${MAX_TEXT} 字，当前 ${plain.length} 字`);
      return;
    }
    const entry: Entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || '匿名',
      email: email.trim(),
      html,
      ts: Date.now(),
    };
    const next = [entry, ...entries];
    setEntries(next);
    save(next);
    if (editorRef.current) editorRef.current.innerHTML = '';
    setName('');
    setEmail('');
    setError('');
    setFlash('留言已发送 · 谢谢来访');
    syncMark();
  };

  const recent = entries.slice(0, RECENT);

  return (
    <section className="about-gb" aria-label="留言板">
      <header className="about-gb-head">
        <h3 className="about-gb-title">
          留言板 <em>GUESTBOOK</em>
        </h3>
        <p className="about-gb-sub">虽然我看不见你，但你可以用加粗，放大，颜色，表情来表达！！！</p>
      </header>

      <form className="about-gb-form" onSubmit={submit}>
        <label className="about-gb-field">
          <span className="about-gb-label">
            姓名 <i>留空即匿名</i>
          </span>
          <input
            className="about-gb-text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="匿名"
            maxLength={24}
            autoComplete="off"
          />
        </label>

        <label className="about-gb-field">
          <span className="about-gb-label">
            电子邮件 <i>可选，仅对留言簿持有者可见</i>
          </span>
          <input
            className="about-gb-text"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="可选，仅对留言簿持有者可见"
            autoComplete="off"
          />
        </label>

        <div className="about-gb-field">
          <span className="about-gb-label">
            信息 <i>*</i>
          </span>

          <div className="about-gb-editor">
            <div className="about-gb-toolbar" role="toolbar" aria-label="文字格式">
              <button
                type="button"
                className={`about-gb-tool${mark.bold ? ' is-on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => cmd('bold')}
                title="加粗"
              >
                <b>B</b>
              </button>
              <button
                type="button"
                className={`about-gb-tool${mark.italic ? ' is-on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => cmd('italic')}
                title="斜体"
              >
                <i>I</i>
              </button>
              <button
                type="button"
                className={`about-gb-tool${mark.underline ? ' is-on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => cmd('underline')}
                title="下划线"
              >
                <u>U</u>
              </button>

              <span className="about-gb-tool-sep" aria-hidden="true" />

              <span className="about-gb-sizebox">
                <select
                  className="about-gb-select"
                  aria-label="字号"
                  defaultValue="3"
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => cmd('fontSize', e.target.value)}
                >
                  {SIZES.map((s) => (
                    <option key={s.value} value={s.value}>
                      字号 {s.label}
                    </option>
                  ))}
                </select>
              </span>

              <div className="about-gb-popwrap">
                <button
                  type="button"
                  className={`about-gb-tool about-gb-tool-color${pop === 'color' ? ' is-open' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPop(pop === 'color' ? null : 'color')}
                  title="文字颜色"
                >
                  <span className="about-gb-a">A</span>
                </button>
                {pop === 'color' && (
                  <div className="about-gb-pop about-gb-pop-color">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="about-gb-swatch"
                        style={{ background: c }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          cmd('foreColor', c);
                          setPop(null);
                        }}
                        aria-label={`颜色 ${c}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="about-gb-popwrap">
                <button
                  type="button"
                  className={`about-gb-tool${pop === 'link' ? ' is-open' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPop(pop === 'link' ? null : 'link')}
                  title="插入链接"
                >
                  <span aria-hidden="true">🔗</span>
                </button>
                {pop === 'link' && (
                  <div className="about-gb-pop about-gb-pop-link">
                    <input
                      className="about-gb-text about-gb-linkinput"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyLink();
                        }
                      }}
                      placeholder="https://"
                    />
                    <button type="button" className="about-gb-mini" onMouseDown={(e) => e.preventDefault()} onClick={applyLink}>
                      插入
                    </button>
                  </div>
                )}
              </div>

              <div className="about-gb-popwrap">
                <button
                  type="button"
                  className={`about-gb-tool${pop === 'emoji' ? ' is-open' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPop(pop === 'emoji' ? null : 'emoji')}
                  title="表情"
                >
                  <span aria-hidden="true">😊</span>
                </button>
                {pop === 'emoji' && (
                  <div className="about-gb-pop about-gb-pop-emoji">
                    {EMOJIS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        className="about-gb-emoji"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insert(em)}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div
              ref={editorRef}
              className="about-gb-input"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="留言内容"
              data-placeholder="说点好好的"
              onPaste={(e) => {
                // 粘贴走清洗：外站富文本里的 <img onerror> 之类不能进到编辑区
                e.preventDefault();
                const html = e.clipboardData.getData('text/html');
                const text = e.clipboardData.getData('text/plain');
                if (html) {
                  try {
                    document.execCommand('insertHTML', false, sanitize(html));
                    return;
                  } catch {
                    /* 回退到纯文本 */
                  }
                }
                document.execCommand('insertText', false, text);
              }}
              onKeyUp={syncMark}
              onMouseUp={syncMark}
              onInput={() => {
                if (error) setError('');
              }}
            />
          </div>
        </div>

        <div className="about-gb-actions">
          <button type="submit" className="about-gb-send">
            发送
          </button>
          <span className="about-gb-meta">
            {error ? <em className="about-gb-error">{error}</em> : flash ? <em className="about-gb-flash">{flash}</em> : `最多 ${MAX_TEXT} 字 · 支持 HTML 式排版`}
          </span>
        </div>
      </form>

      <section className="about-gb-sec">
        <h4 className="about-gb-sec-title">
          <span aria-hidden="true">📮</span> 最近留言 <em>RECENT</em>
          <i>近 {RECENT} 条 · 共 {entries.length} 条</i>
        </h4>

        {recent.length === 0 ? (
          <p className="about-gb-empty">还没有留言，来做第一个吧 ✦</p>
        ) : (
          <ol className="about-gb-list">
            {recent.map((entry) => (
              <li key={entry.id}>
                <p className="about-gb-item-head">
                  <b>{textOf(entry.name) || '匿名'}</b>
                  <span className="about-gb-time">{fmtTime(entry.ts)}</span>
                </p>
                <div className="about-gb-item-body" dangerouslySetInnerHTML={{ __html: sanitize(entry.html) }} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
