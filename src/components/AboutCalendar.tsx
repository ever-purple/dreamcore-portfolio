import { useMemo, useState } from 'react';
import { Sparkles } from '@/components/Sparkles';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

type Cell = { day: number; inMonth: boolean };

/**
 * 复古小日历（真实日期）：❮ ❯ 翻月，今天用薄荷绿实心圈标出。
 * 参考 neocities 个人主页侧栏日历的样式。
 */
export function AboutCalendar() {
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const cells = useMemo<Cell[]>(() => {
    const firstWeekday = new Date(view.y, view.m, 1).getDay();
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const daysInPrev = new Date(view.y, view.m, 0).getDate();
    const list: Cell[] = [];
    for (let i = firstWeekday - 1; i >= 0; i--) list.push({ day: daysInPrev - i, inMonth: false });
    for (let d = 1; d <= daysInMonth; d++) list.push({ day: d, inMonth: true });
    while (list.length % 7 !== 0) list.push({ day: list.length - firstWeekday - daysInMonth + 1, inMonth: false });
    return list;
  }, [view]);

  const isToday = (d: number) =>
    view.y === now.getFullYear() && view.m === now.getMonth() && d === now.getDate();

  const shift = (delta: number) =>
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });

  return (
    <section className="about-card about-calendar" aria-label="日历">
      <div className="about-cal-head">
        <button type="button" className="about-cal-nav" onClick={() => shift(-1)} aria-label="上个月">
          ❮
        </button>
        <h3 className="about-widget-title">
          ✿ {view.y}年{view.m + 1}月 ✿
        </h3>
        <button type="button" className="about-cal-nav" onClick={() => shift(1)} aria-label="下个月">
          ❯
        </button>
      </div>

      <div className="about-cal-grid" role="grid" aria-readonly="true">
        {WEEK.map((w) => (
          <span key={w} className="about-cal-week" role="columnheader">
            {w}
          </span>
        ))}
        {cells.map((c, i) => (
          <span
            key={i}
            role="gridcell"
            className={`about-cal-day${c.inMonth ? '' : ' is-out'}${c.inMonth && isToday(c.day) ? ' is-today' : ''}`}
          >
            {c.day}
          </span>
        ))}
      </div>

      <p className="about-cal-foot" aria-hidden="true">
        <span>* * *</span>
      </p>
      <Sparkles count={4} seed={34} />
    </section>
  );
}
