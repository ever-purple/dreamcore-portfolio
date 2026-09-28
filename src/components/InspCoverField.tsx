import { useRef, useState } from 'react';
import { uploadFile } from '@/lib/contentApi';

/**
 * 封面字段：粘贴（Ctrl/⌘+V）/ 拖拽 / 点选，三种方式都能拿到封面。
 *
 * 「从别的网站上复制粘贴过去」这件事比想象中复杂 —— 不同来源塞进剪贴板的东西不一样：
 *   · 浏览器里右键「复制图片」            → clipboard 里是 image/png 的**文件**；
 *   · 在地址栏 / 图床复制图片链接          → 纯文本 URL；
 *   · 从网页正文或编辑器里复制             → text/html 带着 `<img src="...">`；
 *   · 从截图工具（微信 / QQ / 系统截图）出来 → image/png 文件。
 * 所以按「文件 → 纯文本 URL → HTML 里的 img src」三级去够，够到哪个用哪个。
 * 拿到文件就走 uploadFile（dev 下进 public/insp/media/，可长期引用）。
 */

/** 文本看起来像图片地址吗（data:image 或 http(s) 且不是网页） */
function looksLikeImageUrl(text: string): boolean {
  const v = text.trim();
  if (!v) return false;
  if (/^data:image\//i.test(v)) return true;
  if (!/^https?:\/\//i.test(v)) return false;
  // 明显是网页的就不当封面
  return !/\.(html?|php|aspx?)(\?|#|$)/i.test(v);
}

function hasImageFile(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (Array.from(dt.files ?? []).some((f) => f.type.startsWith('image/'))) return true;
  return Array.from(dt.items ?? []).some((it) => it.kind === 'file' && it.type.startsWith('image/'));
}

/**
 * 从粘贴 / 拖拽的数据里取出封面地址。
 * 返回 null = 这里头没有能当封面的东西（调用方应保持原样）。
 */
export async function coverFromDataTransfer(dt: DataTransfer | null): Promise<string | null> {
  if (!dt) return null;

  // 1) 图片文件（复制图片 / 截图 / 拖文件进来）
  const files = Array.from(dt.files ?? []);
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const { url } = await uploadFile(f);
      if (url) return url;
    } catch {
      /* 这张失败就试下一张 */
    }
  }
  // 少数浏览器只在 items 里给文件，files 是空的
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind !== 'file' || !it.type.startsWith('image/')) continue;
    const f = it.getAsFile();
    if (!f) continue;
    try {
      const { url } = await uploadFile(f);
      if (url) return url;
    } catch {
      /* ignore */
    }
  }

  // 2) 纯文本：图片地址
  const text = (dt.getData('text/plain') ?? '').trim();
  if (looksLikeImageUrl(text)) return text;

  // 3) text/html：抠第一个 <img src>
  const html = dt.getData('text/html') ?? '';
  if (html) {
    const m = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
    if (m && looksLikeImageUrl(m[1])) return m[1];
  }
  return null;
}

/**
 * 封面字段本体：地址输入框 + 实时预览 + 选文件按钮，整块都能粘贴 / 拖拽。
 * 只在作者模式的表单里出现。
 */
export function CoverField({
  value,
  onChange,
  placeholder = '封面：粘贴图片地址，或直接 Ctrl/⌘+V 粘图片',
}: {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState('');
  const [broken, setBroken] = useState(false);

  const ingest = async (dt: DataTransfer | null) => {
    setBusy(true);
    setErr('');
    try {
      const url = await coverFromDataTransfer(dt);
      if (url) {
        setBroken(false);
        onChange(url);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '这张图没能存下来');
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const dt = e.clipboardData;
    // 只有「确实是图片 / 图片地址」才接管；否则放行，让用户正常编辑输入框里的文字
    if (!hasImageFile(dt) && !looksLikeImageUrl(dt.getData('text/plain') ?? '')) return;
    e.preventDefault();
    void ingest(dt);
  };

  const pickFile = (f: File | null) => {
    if (!f) return;
    setBusy(true);
    setErr('');
    void (async () => {
      try {
        const { url } = await uploadFile(f);
        setBroken(false);
        onChange(url);
      } catch (e) {
        setErr(e instanceof Error ? e.message : '上传失败');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div
      className={`about-insp-cover${drag ? ' is-drag' : ''}${busy ? ' is-busy' : ''}`}
      onPaste={handlePaste}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void ingest(e.dataTransfer);
      }}
    >
      <div className="about-insp-cover-row">
        <input
          className="about-insp-input"
          value={value}
          placeholder={busy ? '存图中…' : placeholder}
          aria-label="封面图片地址"
          onChange={(e) => {
            setBroken(false);
            onChange(e.target.value);
          }}
        />
        <button type="button" className="about-insp-btn" onClick={() => fileRef.current?.click()}>
          {busy ? '存图中…' : '选文件'}
        </button>
        {value ? (
          <button
            type="button"
            className="about-insp-btn"
            onClick={() => {
              setBroken(false);
              onChange('');
            }}
            aria-label="清空封面"
          >
            清空
          </button>
        ) : null}
      </div>

      <div className="about-insp-cover-previewbox">
        {value ? (
          broken ? (
            <span className="about-insp-cover-broken">这张地址打不开，换个链接或重新粘一次</span>
          ) : (
            <img
              className="about-insp-cover-thumb"
              src={value}
              alt="封面预览"
              onError={() => setBroken(true)}
              onLoad={() => setBroken(false)}
            />
          )
        ) : (
          <span className="about-insp-cover-hint">
            在别的网站上右键「复制图片」→ 点一下上面的输入框 → <b>Ctrl/⌘+V</b>；也可以直接把图片拖进来
          </span>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
      />
      {err ? <p className="about-insp-form-err">{err}</p> : null}
    </div>
  );
}
