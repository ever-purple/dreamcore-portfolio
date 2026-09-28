import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '@/lib/escape-stack';
import {
  NARROW_MAX,
  copyLink,
  downloadCard,
  isCoarsePointer,
  isInAppBrowser,
  loadCardFile,
  pickCard,
  shareCard,
  type CardSpec,
  type ShareOutcome,
} from '@/lib/shareCard';

type Props = {
  open: boolean;
  onClose: () => void;
};

/** 浮层自己的状态：'idle' 刚打开 / 用户取消；'link' 是"复制链接"那条路；其余来自 shareCard() */
type Phase = 'idle' | 'link' | ShareOutcome;

/**
 * 分享卡浮层（2026-09-28 / 用户需求）。
 *
 * ## 用户要的是什么
 * 原话（第一次）：
 *   「分享卡根本就看不见，我点了联系方式的分享网站后是这样的（截图：Windows 系统共享面板），
 *     只能复制链接，把链接发给好友只是链接不是图片，我希望是点击转发网站的时候就蹦出分享卡」
 * 原话（第二次，纠正我把它改成英文的那一版）：
 *   「错了，不改英文了。别人把卡片分享出去要点击卡片的**转发按钮**，
 *     人可以通过分享过来的卡片点击卡片的 **come in 进入网站**」
 *
 * 于是这一屏有**两个角色、不能合并**：
 *   · 图上的 `come in` 药丸是画给**收到卡片的人**的：他点卡上的 come in 进来。
 *     （链接形式的卡片在微信里会渲染成 og 预览，整张预览可点 → come in 真的能点进去，
 *       所以卡片图上的字**保持 come in，别改成动作词**。）
 *   · **转发**是这一屏另给的一枚按钮（`.share-card__send`），不在图上 ——
 *     图会被原样发出去，如果"转发按钮"是画在图里的，收件人那边就会出现一个按不动的假按钮。
 *
 * 所以：卡片 `<img>` 只是"给你看要发出去什么"，所有可操作的东西都在卡片外面。
 *
 * ## 三级降级
 * `navigator.share({ files })` → 写剪贴板 → 下载；微信 / 小红书的内置浏览器
 * 前两条都走不通，只剩"长按保存"。完整理由见 src/lib/shareCard.ts 的文件头。
 *
 * ## 三个必须这么写的点
 * 1. **portal 挂 body，z 9990**。理由同 InspLightbox：祖先若带 opacity 过渡 /
 *    层叠上下文，fixed 子元素会被锁住；9990 是刻意压在 9999 的胶片颗粒层下面，
 *    让颗粒继续盖在卡片上（和站内其它浮层的观感一致）。
 * 2. **卡片图不能包在 `<button>` 里**，而且要带 `data-allow-save`。
 *    内置浏览器里唯一的出路是"长按图片 → 保存到相册"，而长按靠 `contextmenu` 事件；
 *    图片被 button 包住、或 `src/lib/copyright.ts` 那个全局禁右键不放过它，
 *    这条路就断了（见 copyright.ts 里的 `[data-allow-save]`）。
 * 3. **打开时就把图片文件取好**（`loadCardFile`）。`navigator.share` 要求**瞬时用户激活**，
 *    点下去才 fetch 的话，网络一慢激活就过期 → `NotAllowedError`。
 *    预热之后点按钮只等一个微任务，激活稳稳还在。
 *
 * Esc 走全站统一的 Esc 栈。这个浮层比联系方式面板**晚挂**，天然在栈顶 ——
 * 一次 Esc 只关浮层，不会顺手把联系方式整页收回去。
 */
export function ShareCardOverlay({ open, onClose }: Props) {
  const spec = usePickCard();
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const sendRef = useRef<HTMLButtonElement>(null);

  useEscape(onClose, open);

  /** 每次打开都回到初始态；并**预热文件缓存**（见文件头第 3 条） */
  useEffect(() => {
    if (!open) return;
    setPhase('idle');
    setBusy(false);
    void loadCardFile(spec);
  }, [open, spec]);

  /* 打开后把焦点挪到"转发卡片"上：键盘可达 + 回车就能发 */
  useEffect(() => {
    if (open) sendRef.current?.focus({ preventScroll: true });
  }, [open]);

  /* 分享成功后自动收掉浮层 —— 系统分享面板已经在上面了，这层留着只会挡视线 */
  useEffect(() => {
    if (phase !== 'shared') return;
    const t = window.setTimeout(onClose, 1400);
    return () => window.clearTimeout(t);
  }, [phase, onClose]);

  const onSend = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      setPhase(await shareCard(spec));
    } finally {
      setBusy(false);
    }
  }, [busy, spec]);

  const onSave = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      setPhase((await downloadCard(spec)) ? 'downloaded' : 'failed');
    } finally {
      setBusy(false);
    }
  }, [busy, spec]);

  const onCopy = useCallback(async () => {
    setPhase((await copyLink()) ? 'link' : 'idle');
  }, []);

  if (!open) return null;

  const tall = spec.w < spec.h;

  return createPortal(
    <div
      className="share-card"
      role="dialog"
      aria-modal="true"
      aria-label="分享这个网站"
      data-lenis-prevent
      onClick={(e) => {
        /* 只有点背幕本身才关；点卡片、点按钮、点提示行都不关 */
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`share-card__panel${tall ? ' share-card__panel--tall' : ''}`}>
        <button
          type="button"
          className="share-card__close"
          onClick={onClose}
          aria-label="关闭分享卡"
        >
          ✕
        </button>

        <p className="share-card__kicker">share this</p>

        <div className="share-card__stage" style={{ aspectRatio: `${spec.w} / ${spec.h}` }}>
          {/* ⚠️ 不包 button、并且带 data-allow-save —— 见文件头第 2 条 */}
          <img
            className="share-card__img"
            src={spec.src}
            width={spec.w}
            height={spec.h}
            alt="孙晨茜作品集分享卡：转发给朋友，他们点卡上的 come in 就能进来"
            draggable={false}
            data-allow-save
          />
        </div>

        <p className="share-card__lead">
          转发给朋友，他们点卡上的 <span className="share-card__lead-mark">come in</span> 就能进来
        </p>

        <button
          ref={sendRef}
          type="button"
          className="share-card__send"
          onClick={onSend}
          disabled={busy}
        >
          转发卡片
        </button>

        <div className="share-card__acts">
          <button type="button" className="share-card__act" onClick={onSave} disabled={busy}>
            保存图片
          </button>
          <button type="button" className="share-card__act" onClick={onCopy} disabled={busy}>
            复制链接
          </button>
        </div>

        <p className="share-card__hint" role="status" aria-live="polite">
          {hintFor(phase, busy)}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 屏宽 < NARROW_MAX 用竖版卡、否则横版（见 shareCard.ts 里两张卡的取舍）。
 * 无头环境里 `matchMedia` 会在，但保险起见给个兜底。
 */
function usePickCard(): CardSpec {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(`(max-width: ${NARROW_MAX}px)`).matches;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(max-width: ${NARROW_MAX}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return pickCard(narrow);
}

/**
 * 反馈行文案。默认态会随设备变：
 *   · 内置浏览器（微信 / 小红书）→ 直接讲"长按保存"，因为那边走不了系统分享；
 *   · 其它粗指针设备 → 两者都提一句；
 *   · 桌面 → 只讲那枚按钮。
 *
 * ⚠️ 这里**不写 `✓` 这类符号**。这一行用的是 `NanoOldSongA`（632 字形子集），
 *    子集缺字**不报错**，浏览器直接换成 `Noto Serif SC` —— 同一行里两种字形
 *    （2026-09-28 就因为「分享网站」缺三个字被用户抓过一次）。
 *    这里出现的每一个中文字都要登记到 `scripts/subset-nanooldsong.py` 的
 *    HARDCODED_DISPLAY 再重跑；符号一律不进正文，关闭按钮那枚 ✕ 交给系统字体。
 */
function hintFor(phase: Phase, busy: boolean): string {
  if (busy) return '正在准备图片…';
  if (phase === 'shared') return '已唤起分享，选微信 / 小红书就发出去了';
  if (phase === 'copied') return '图片已复制，去微信 / 小红书粘贴即可';
  if (phase === 'downloaded') return '图片已保存，去微信 / 小红书发出去吧';
  if (phase === 'link') return '链接已复制，发出去朋友点卡上的 come in 就能进来';
  if (phase === 'failed') return '图片没取到 —— 长按卡片保存，或点下面的「保存图片」';
  /* idle / aborted（用户在系统面板里取消了）→ 都回到初始提示 */
  if (isInAppBrowser()) return '长按卡片保存到相册，再去微信 / 小红书发出去';
  if (isCoarsePointer()) return '点「转发卡片」发出去，也可以长按卡片保存';
  return '点「转发卡片」把这张图发出去';
}
