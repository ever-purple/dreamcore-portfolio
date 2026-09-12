/**
 * 版权保护：禁用右键菜单、图片拖拽、Ctrl/⌘+S 另存整页。
 *
 * 在 main.tsx 顶部安装一次即可覆盖全站（含旋转木马浮层与详情面板）。
 * 只拦截这三类"另存/搬运"动作，不影响 Esc / ← → 等既有交互，也不挡文字输入。
 */

let installed = false;

export function installCopyrightGuard(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  // 1. 禁用右键菜单（图片"图片另存为"也走这里）
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // 2. 禁用图片拖拽（拖到桌面 / 新标签页 = 变相搬运）
  document.addEventListener('dragstart', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === 'IMG') e.preventDefault();
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
