import { useEffect, useState } from 'react';
import { Sparkles } from '@/components/Sparkles';

/**
 * 页脚访客计数器。
 *
 * 现在是**服务端计数**：数字由 Vercel 云函数 /api/visit 从 Redis 里读，
 * 所有访客共用同一个数，于是「你到底是第几位」是真实答案。
 *
 * 具体行为：
 *  1. 组件一挂载就发请求，不等别的动作 —— 打开 About 页即可见，不用刷新。
 *  2. 同一次会话（按 F5）只 +1 一次，靠 sessionStorage 记住。
 *  3. 云函数不可用（没配存储 / 网络炸了）时退回本地计数，页脚不会空着。
 */

const FALLBACK_KEY = 'dreamcore.visitor.no';
const COUNTED_KEY = 'dreamcore.visitor.counted';
/** 起始编号：第一个访客就是 SEED + 1 */
const SEED = 1024;
/** 建站月份，页脚展示用 */
const SINCE = '2026.09';

function alreadyCounted(): boolean {
  try {
    return window.sessionStorage.getItem(COUNTED_KEY) === '1';
  } catch {
    return false;
  }
}

function markCounted(): void {
  try {
    window.sessionStorage.setItem(COUNTED_KEY, '1');
  } catch {
    /* 隐私模式下忽略：最坏结果是同一会话多算一次 */
  }
}

/** 降级用的本地编号：让页脚永远有个数字，而不是空白 */
function localNo(): number {
  try {
    const prev = Number(window.localStorage.getItem(FALLBACK_KEY));
    const n = Number.isFinite(prev) && prev > 0 ? prev : SEED + 1;
    window.localStorage.setItem(FALLBACK_KEY, String(n));
    return n;
  } catch {
    return SEED + 1;
  }
}

/** 回到 About 页顶部（滚动容器是外层浮层） */
function scrollAboutToTop() {
  const overlay = document.querySelector('.about-overlay');
  if (overlay) overlay.scrollTo({ top: 0, behavior: 'smooth' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function AboutVisitor() {
  const [no, setNo] = useState(0);
  const [pv, setPv] = useState(0);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let alive = true;

    const unique = !alreadyCounted();
    markCounted();

    (async () => {
      try {
        const res = await fetch('/api/visit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unique }),
          cache: 'no-store',
        });
        const j = (await res.json()) as { ok?: boolean; count?: number; pv?: number };
        if (alive && j.ok && typeof j.count === 'number') {
          try {
            window.localStorage.setItem(FALLBACK_KEY, String(j.count));
          } catch {
            /* 忽略 */
          }
          setNo(j.count);
          if (typeof j.pv === 'number') setPv(j.pv);
          return;
        }
        throw new Error('bad response');
      } catch {
        // 云函数没配好 / 网络失败：退回本地编号，界面照常
        if (alive) setNo(localNo());
      } finally {
        if (alive) setPending(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const text = no ? String(no) : '···';

  return (
    <footer className="about-foot" aria-label="访客统计">
      <Sparkles count={6} seed={31} />

      <p className="about-foot-line">
        <span className="about-foot-star" aria-hidden="true">
          ☆
        </span>
        欢迎第
        <strong
          className="about-foot-no"
          aria-live="polite"
          style={{ opacity: pending ? 0.45 : 1, transition: 'opacity .3s ease' }}
        >
          {text}
        </strong>
        位参观者
        <span className="about-foot-star" aria-hidden="true">
          ☆
        </span>
      </p>

      <p className="about-foot-note">
        你的编号 <b>#{text}</b>
        {pv > 0 ? <> · 累计浏览 {pv} 次</> : null} · 本站自 {SINCE} 起记录
      </p>

      <button type="button" className="about-foot-top" onClick={scrollAboutToTop}>
        ↑ 回到顶部
      </button>
    </footer>
  );
}
