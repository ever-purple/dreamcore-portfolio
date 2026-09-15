import { useEffect, useRef, useState } from 'react';
import { prefersReduced } from '@/lib/motion-pref';

/** 生成噪点用的字符集（与 ascii-art.txt 本身使用的字符一致） */
const GLYPHS = '#%*+-.:=';
/** 整幅图从上到下的首次渲染（扫描）总时长 */
const REVEAL_MS = 1800;
/** 常态"代码流动"：发光带自上而下循环一周的时长（与 CSS about-beam 保持一致） */
const FLOW_PERIOD = 5200;
/** 发光带半宽（行） */
const BAND = 7;
/** 额外随机闪烁：每隔多久挑一批行 */
const IDLE_MIN_MS = 420;
const IDLE_MAX_MS = 900;
/** 单次闪烁的持续时长 */
const FLICKER_MIN_MS = 220;
const FLICKER_MAX_MS = 460;
/** 渲染节流（毫秒） */
const FRAME_MS = 42;
/** 常态每隔多久跑一次"瀑布"级联（整幅图自上而下重新解码一遍，让图案自己流动） */
const CASCADE_EVERY_MIN = 4200;
const CASCADE_EVERY_MAX = 7200;
/** 单次瀑布级联的时长 */
const CASCADE_MS = 1500;

type Props = {
  /** ascii-art.txt 地址 */
  src?: string;
  className?: string;
};

function scramble(line: string, p: number) {
  if (p <= 0) return line;
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') {
      out += ' ';
    } else if (Math.random() < p) {
      out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
    } else {
      out += ch;
    }
  }
  return out.replace(/\s+$/, '');
}

/**
 * ASCII 自画像（ascii me）—— 把 ascii-art.txt 当成一段一直在跑的代码。
 * 1. 入场：薄荷绿扫描线自上而下推进，未定稿的行用随机字符噪点遮住，越过即定稿；
 * 2. 常态：一条发光带自上而下循环流动，带内的字符被短暂重排（"代码流动"），
 *    另外随机挑 1~3 行闪烁（"代码闪动"）；
 * 3. 尊重 prefers-reduced-motion：直接呈现定稿画面。
 */
export function AsciiPortrait({ src = '/about/ascii-art.txt', className }: Props) {
  const [rows, setRows] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<'reveal' | 'flow'>('reveal');
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cacheRef = useRef<string[]>([]);

  // 读取文本
  useEffect(() => {
    let alive = true;
    fetch(src)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (!alive) return;
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        setRows(lines);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [src]);

  // 渲染动画
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const nodes = rowRefs.current;
    const cache = cacheRef.current;
    const plain = rows.map((line) => line.replace(/\s+$/, ''));

    const paint = (i: number, text: string) => {
      if (cache[i] === text) return;
      cache[i] = text;
      const el = nodes[i];
      if (el) el.textContent = text;
    };

    if (prefersReduced()) {
      plain.forEach((line, i) => paint(i, line));
      setPhase('flow');
      return;
    }

    const start = performance.now();
    const step = REVEAL_MS / rows.length;
    const flickers = new Map<number, number>();
    let nextFlickerAt = start + REVEAL_MS + 900;
    let nextCascadeAt = start + REVEAL_MS + 1600 + Math.random() * 2000;
    let cascadeStart = 0;
    let last = 0;
    let raf = 0;
    let flowOn = false;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;

      const elapsed = now - start;
      if (!flowOn && elapsed > REVEAL_MS + 140) {
        flowOn = true;
        setPhase('flow');
      }

      // 随机闪烁的行
      if (now >= nextFlickerAt) {
        const count = 1 + ((Math.random() * 3) | 0);
        for (let i = 0; i < count; i++) {
          flickers.set(
            (Math.random() * rows.length) | 0,
            now + FLICKER_MIN_MS + Math.random() * (FLICKER_MAX_MS - FLICKER_MIN_MS),
          );
        }
        nextFlickerAt = now + IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
      }

      // 瀑布级联：整幅图自上而下重新"解码"一遍，让图案像代码瀑布一样流动
      const inCascade = cascadeStart > 0 && now - cascadeStart < CASCADE_MS;
      if (!inCascade && cascadeStart > 0 && now - cascadeStart >= CASCADE_MS) {
        cascadeStart = 0; // 级联结束
      }
      if (cascadeStart === 0 && now >= nextCascadeAt) {
        cascadeStart = now;
        nextCascadeAt =
          now + CASCADE_MS + CASCADE_EVERY_MIN + Math.random() * (CASCADE_EVERY_MAX - CASCADE_EVERY_MIN);
      }

      // 流动带位置：从画面上方缓慢移到下方，循环
      const travel = rows.length + BAND * 4;
      const bandPos =
        ((now - start - REVEAL_MS) % FLOW_PERIOD) / FLOW_PERIOD * travel - BAND * 2;

      for (let i = 0; i < rows.length; i++) {
        const line = rows[i];
        const settle = i * step;
        let out: string;

        if (elapsed < settle) {
          out = '';
        } else {
          const endsAt = flickers.get(i);
          if (endsAt !== undefined) {
            if (now > endsAt) {
              flickers.delete(i);
              out = plain[i];
            } else {
              out = scramble(line, 0.34);
            }
          } else if (inCascade) {
            // 级联进度：本行在级联时间窗内从上到下依次"扫描"
            const cp = (now - cascadeStart) / CASCADE_MS;
            const rowP = i / rows.length;
            // 扫描头之后、扫过一点宽度的行保持解码噪点，其余定稿
            const wave = 0.16;
            if (cp > rowP) {
              const since = cp - rowP;
              out = since < wave ? scramble(line, 0.5 * (1 - since / wave)) : plain[i];
            } else {
              out = scramble(line, 0.5);
            }
          } else {
            // 首次渲染：本行自己的解码进度
            const revealP = Math.min(1, (elapsed - settle) / (step * 2.6));
            // 流动带：越靠近带中心重排越强
            const dist = Math.abs(i - bandPos);
            const flowP = dist < BAND ? Math.pow(1 - dist / BAND, 1.5) * 0.8 : 0;
            const p = Math.max(revealP < 1 ? 1 - revealP : 0, flowP);
            out = p > 0.02 ? scramble(line, p) : plain[i];
          }
        }
        paint(i, out);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rows]);

  return (
    <div className={`about-ascii ${className ?? ''}`}>
      <div className="about-ascii-bar">
        <span className="about-ascii-path">~/about $</span>
        <span className="about-ascii-cmd">render me.txt</span>
        <span className="about-ascii-caret" aria-hidden="true" />
      </div>
      <div className="about-ascii-stage">
        {failed ? (
          <p className="about-ascii-fail">ascii-art.txt 读取失败</p>
        ) : (
          <>
            <div className="about-ascii-lines" aria-hidden="true">
              {(rows ?? []).map((_, i) => (
                <div
                  key={i}
                  className="about-ascii-row"
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                />
              ))}
            </div>
            {phase === 'reveal' ? (
              <span className="about-ascii-scan" aria-hidden="true" />
            ) : (
              <span className="about-ascii-beam" aria-hidden="true" />
            )}
          </>
        )}
      </div>
      {rows && <span className="sr-only">ASCII 自画像，共 {rows.length} 行字符。</span>}
    </div>
  );
}
