import { useEffect, useState } from 'react';
import { Sparkles } from '@/components/Sparkles';

/**
 * 页脚访客计数器。
 *
 * ⚠️ 现在是「本地计数」：编号存在 localStorage，每次新会话 +1。
 * 想做**全局真实人数**必须有个能自增的服务端（云函数 / KV / 边缘函数都行），
 * 只改下面 readVisitorNo 一处即可，界面不用动：
 *
 *   const r = await fetch('/api/visit', { method: 'POST' });
 *   return (await r.json()).count as number;
 *
 * 之所以不直接怼一个公共计数器 API：那些服务大多要 key、会挂、还有 CORS，
 * 访客一多就白字一排，不如先本地跑通。
 */

const COUNT_KEY = 'dreamcore.visitor.no';
const SESSION_KEY = 'dreamcore.visitor.counted';
/** 起始编号：第一个访客就是 SEED + 1 */
const SEED = 1024;
/** 建站月份，页脚展示用 */
const SINCE = '2026.09';

function readVisitorNo(): number {
  try {
    const prev = Number(window.localStorage.getItem(COUNT_KEY));
    const base = Number.isFinite(prev) && prev > 0 ? prev : SEED;

    // 同一次会话里刷新页面不重复计数（否则按 F5 就能把自己的编号刷上去）
    if (window.sessionStorage.getItem(SESSION_KEY)) return base;

    const next = base + 1;
    window.localStorage.setItem(COUNT_KEY, String(next));
    window.sessionStorage.setItem(SESSION_KEY, '1');
    return next;
  } catch {
    // 隐私模式 / 禁用 storage：给个稳定值，别让页脚崩掉
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

  useEffect(() => {
    setNo(readVisitorNo());
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
        <strong className="about-foot-no" aria-live="polite">
          {text}
        </strong>
        位参观者
        <span className="about-foot-star" aria-hidden="true">
          ☆
        </span>
      </p>

      <p className="about-foot-note">
        你的编号 <b>#{text}</b> · 本站自 {SINCE} 起记录
      </p>

      <button type="button" className="about-foot-top" onClick={scrollAboutToTop}>
        ↑ 回到顶部
      </button>
    </footer>
  );
}
