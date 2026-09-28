import { useEffect, useRef, useState } from 'react';
import { useAdminMode } from '@/context/AdminContext';
import {
  GATE_ENABLED,
  HOTKEY_KEY,
  HOTKEY_TIMES,
  HOTKEY_WINDOW,
  gateError,
  isUnlocked,
} from '@/lib/authorAuth';
import { useMagnetic } from '@/hooks/useMagnetic';

/**
 * 作者 / 访客模式徽标 —— 访客看不到它（没解锁直接不渲染），作者才看得到。
 *
 * 固定顶部居中，压在所有浮层之上。
 *   作者模式 → 薄荷绿 + 可编辑（木马「＋提交项目」、案例「编辑项目」、灵感收藏上传/删除）
 *   访客模式 → 只有作者自己能看到的这一档（默认隐藏）
 *
 * 【隐藏入口】不显示任何按钮，1.5 秒内连按 5 次 M（键盘）弹出口令框。
 * 输对 → 进入作者模式，并在浏览器里记 14 天，期间徽标常驻可见，刷新、换页都在。
 * 开发环境这道门是关的（徽标一直可见、?admin=1 照旧），方便自己调试。
 */
export function ModeSwitch() {
  const { isAdmin, toggle, unlock } = useAdminMode();
  // 磁吸：鼠标靠近时徽标被轻轻吸向指针（触屏不启用）
  const magneticRef = useMagnetic<HTMLButtonElement>();
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false); // 服务端校验期间防重复提交
  const hotRef = useRef({ n: 0, t: 0 });

  useEffect(() => {
    if (!GATE_ENABLED) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== HOTKEY_KEY) return;
      const el = e.target as HTMLElement | null;
      // 正在打字就别数了，别把用户输入的内容当成口令
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      const now = Date.now();
      const st = hotRef.current;
      st.n = now - st.t < HOTKEY_WINDOW ? st.n + 1 : 1;
      st.t = now;
      if (st.n >= HOTKEY_TIMES) {
        st.n = 0;
        st.t = 0;
        setAsking(true);
        setWrong(false);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 访客：什么都不渲染。作者：只渲染徽标。
  if (GATE_ENABLED && !isUnlocked()) return null;

  const submitKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (checking) return;
    setChecking(true);
    try {
      if (await unlock(value)) {
        setAsking(false);
        setValue('');
        setWrong(false);
        return;
      }
      setWrong(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      {asking && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="作者口令"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(10,8,10,.72)',
            backdropFilter: 'blur(3px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setAsking(false);
          }}
        >
          <form
            onSubmit={submitKey}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              width: 'min(320px, calc(100vw - 40px))',
              padding: '20px 22px',
              borderRadius: 14,
              background: '#fffdf8',
              border: '1px solid #e0d8c6',
              boxShadow: '0 18px 50px rgba(0,0,0,.35)',
              textAlign: 'left',
            }}
          >
            <b style={{ fontSize: 14, color: '#2b2b2b' }}>作者口令</b>
            <input
              type="password"
              value={value}
              autoFocus
              placeholder="输入后回车"
              onChange={(e) => {
                setValue(e.target.value);
                if (wrong) setWrong(false);
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 13,
                borderRadius: 8,
                border: `1px solid ${wrong ? '#d4786e' : '#e0d8c6'}`,
                fontFamily: 'inherit',
                color: '#2b2b2b',
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="submit"
                disabled={checking}
                style={{
                  padding: '7px 14px',
                  fontSize: 12,
                  borderRadius: 8,
                  border: 'none',
                  background: '#2f7f66',
                  color: '#fff',
                  cursor: checking ? 'wait' : 'pointer',
                  opacity: checking ? 0.7 : 1,
                  fontFamily: 'inherit',
                }}
              >
                {checking ? '校验中…' : '进去'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAsking(false);
                  setWrong(false);
                }}
                style={{
                  padding: '7px 12px',
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid #e0d8c6',
                  background: '#fff',
                  color: '#6b6b6b',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                取消
              </button>
              <span style={{ flex: '1 1 auto' }} />
              <span style={{ fontSize: 11, color: wrong ? '#c2453b' : '#9a9a9a' }}>
                {wrong ? gateError() || '口令不对' : '仅作者可见'}
              </span>
            </div>
          </form>
        </div>
      )}

      <button
        ref={magneticRef}
        type="button"
        className={`mode-switch ${isAdmin ? 'is-author' : 'is-guest'}`}
        onClick={() => {
          if (isAdmin) toggle();
        }}
        aria-pressed={isAdmin}
        title="作者模式（可编辑）。点一下切回访客模式"
      >
        <span className="mode-switch-dot" aria-hidden="true" />
        <span className="mode-switch-label">作者模式</span>
        <span className="mode-switch-hint">{isAdmin ? '可编辑' : '只读'}</span>
        <span className="mode-switch-flip" aria-hidden="true">
          ⇄
        </span>
      </button>
    </>
  );
}
