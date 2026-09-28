/**
 * 简历下载 —— 菜单里点「Resume / 简历」走这里。
 *
 * ── 交互要求（用户原话） ────────────────────────────────────────────────
 *   「点击菜单中的『简历』项后，立即显示『正在下载简历中...』的提示，
 *     下载完成后自动消失，重复点击时不要叠加多个提示。
 *     提示的 bottom 要与网站风格颜色适配。」
 *
 * 对应实现：
 *   · **立即** —— `show()` 在 `fetch` 之前就调用，提示与网络无关、零等待。
 *   · **完成后消失** —— 这里不再用 `<a href>` 直链（那样浏览器不告诉我们"下完了"），
 *     而是 `fetch` 成 blob 再触发下载：字节全部到手 = 真的下载完成，
 *     此时才切到完成态、稍后自动淡出。
 *   · **不叠加** —— 提示由 `#dp-resume-toast` 这一个 DOM 节点承载，
 *     第二次点击复用同一个节点（改文案 + 重播出场动画），永远不会出现两条。
 *     另外 `busy` 闸门保证同一时刻只有一次请求在飞。
 *   · **配色适配** —— 巧克力底 `--pal-choc` + 薄荷字 `--pal-mint`，
 *     与全屏菜单（`--pal-veil` + `--pal-mint`）同源，见 index.css 的 .dp-resume-toast。
 *
 * ── 三条保底 ────────────────────────────────────────────────────────────
 *   1. 快网下 188KB 的 PDF 会在 100ms 内下完，提示会"一闪而过"像是没反应
 *      → 设 `MIN_VISIBLE`，提示从出现起至少停留这么久才允许淡出。
 *   2. 404 时不能让浏览器静默打开一个空白页 → 探到 !ok 就明确告知该把文件放哪。
 *   3. 网络层失败（离线 / 被拦）→ 退回直链 `<a download>`，让浏览器自己再试一次。
 *
 * 文件名保持**中文原名**（`孙晨茜简历-市场营销策划岗.pdf`），不做改名。
 */
import { RESUME_FILENAME, RESUME_URL } from '@/data/contact';
import { markEvent } from '@/lib/visitLog';

const TOAST_ID = 'dp-resume-toast';
/** 提示从出现起至少停留这么久，避免快网下"一闪而过" */
const MIN_VISIBLE = 700;
/** 下载完成后停留多久再淡出 */
const DONE_HOLD = 900;
/** 出错时停留更久，让人看清 */
const ERROR_HOLD = 2800;
/** 淡出动画时长，须与 CSS 的 dp-resume-toast-out 一致 */
const FADE = 260;

type ToastState = 'loading' | 'done' | 'error';

let busy = false;
let el: HTMLElement | null = null;
let textEl: HTMLElement | null = null;
let startedAt = 0;
let hideTimer = 0;
let removeTimer = 0;

function mountToast(): void {
  const node = document.createElement('div');
  node.id = TOAST_ID;
  node.className = 'dp-resume-toast';
  node.dataset.state = 'loading';
  // 无障碍：读屏软件会把文案变化读出来，而不是只弹一个没有语义的方块
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');

  const dot = document.createElement('span');
  dot.className = 'dp-resume-toast__dot';
  const text = document.createElement('span');
  text.className = 'dp-resume-toast__text';
  node.append(dot, text);

  document.body.appendChild(node);
  el = node;
  textEl = text;
  startedAt = Date.now();
}

/** 展示（或更新）那唯一一条提示。重复调用只会改文案，不会新增节点。 */
function show(message: string, state: ToastState): void {
  if (!el || !document.body.contains(el)) mountToast();
  const node = el as HTMLElement;
  node.dataset.state = state;
  textEl!.textContent = message;

  // 若正处在淡出中（is-out 已加），撤销它，让提示"活"回来
  node.classList.remove('is-out');
  window.clearTimeout(hideTimer);
  window.clearTimeout(removeTimer);
  // 重播一次出场动画：清 animation → 强制 reflow → 复原，否则改了字却没有任何动效反馈
  node.style.animation = 'none';
  void node.offsetWidth;
  node.style.animation = '';
}

/** 到点淡出并移除；`hold` 之上再补足 MIN_VISIBLE */
function dismiss(hold: number): void {
  const elapsed = Date.now() - startedAt;
  const wait = Math.max(hold, MIN_VISIBLE - elapsed);
  window.clearTimeout(hideTimer);
  window.clearTimeout(removeTimer);
  hideTimer = window.setTimeout(() => {
    const node = el;
    if (!node) return;
    node.classList.add('is-out');
    removeTimer = window.setTimeout(() => {
      node.remove();
      if (el === node) el = null;
      textEl = null;
    }, FADE);
  }, wait);
}

/** blob → 触发一次同源下载，文件名用简历原名 */
function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = RESUME_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 给下载留出读取时间再释放，立刻 revoke 会让部分浏览器拿到空文件
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 兜底直链：不经过 blob，由浏览器直接处理 */
function downloadDirect(): void {
  const a = document.createElement('a');
  a.href = RESUME_URL;
  a.download = RESUME_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadResume(): Promise<void> {
  if (busy) return; // 同一时刻只跑一次，重复点击既不叠加提示也不重复请求
  busy = true;
  show('正在下载简历中…', 'loading'); // 立即显示，不等网络

  try {
    const res = await fetch(RESUME_URL, { cache: 'no-store' });
    if (!res.ok) {
      show(`简历文件不见了：确认 public/${RESUME_FILENAME} 还在项目里`, 'error');
      dismiss(ERROR_HOLD);
      return;
    }
    downloadBlob(await res.blob());
    // 简历下载 = 最明确的「他在认真看」信号，单独记进访问日志
    markEvent('简历下载');
    show('简历已开始下载', 'done');
    dismiss(DONE_HOLD);
  } catch {
    // 网络层失败就不拦了，退回直链让浏览器自己再试一次
    downloadDirect();
    markEvent('简历下载');
    show('简历已开始下载', 'done');
    dismiss(DONE_HOLD);
  } finally {
    busy = false;
  }
}
