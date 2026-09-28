/**
 * 版权保护：禁用右键菜单、图片拖拽、Ctrl/⌘+S 另存整页。
 *
 * 在 main.tsx 顶部安装一次即可覆盖全站（含旋转木马浮层与详情面板）。
 * 只拦截这三类"另存/搬运"动作，不影响 Esc / ← → 等既有交互，也不挡文字输入。
 *
 * ## `[data-allow-save]` 例外（2026-09-28）
 * 分享卡浮层里那张卡是**给人存下来转发的**，它在微信 / 小红书的内置浏览器里
 * 唯一可行的动作就是「长按图片 → 保存到相册」—— 而手机上的长按正是靠
 * `contextmenu` 事件触发的，被上面这条 `preventDefault()` 一掐就再也弹不出来。
 * 所以凡是带 `data-allow-save` 的元素（及其子树）一律放过。
 * ⚠️ 别把整站放开：这个属性只应该出现在 `ShareCardOverlay` 的那张 `<img>` 上。
 */

let installed = false;

export function installCopyrightGuard(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const savesAllowed = (target: EventTarget | null): boolean => {
    const el = target as (Element & { closest?: Element['closest'] }) | null;
    return Boolean(el?.closest?.('[data-allow-save]'));
  };

  // 1. 禁用右键菜单（图片"图片另存为"、手机"长按保存图片"都走这里）
  document.addEventListener('contextmenu', (e) => {
    if (savesAllowed(e.target)) return;
    e.preventDefault();
  });

  // 2. 禁用图片拖拽（拖到桌面 / 新标签页 = 变相搬运）
  document.addEventListener('dragstart', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === 'IMG' && !savesAllowed(t)) e.preventDefault();
  });

  // 3. 禁用 Ctrl/⌘+S 保存整页
  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
      }
    },
    // 冒泡阶段即可，不抢 Esc / ← → 的捕获处理
    false,
  );
}
