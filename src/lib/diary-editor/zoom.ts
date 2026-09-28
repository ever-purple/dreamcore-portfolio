/**
 * 手账页图片的「点击放大」灯箱（2026-09-24 用户：「图片点击可放大，不要压缩图片」）。
 *
 * 刻意做成**原生 DOM** 而不是 React 组件：
 *   · 翻页层把一页纸渲染 12 遍（12 条竖带各一份 DiaryPage），React 状态会让
 *     12 个副本各自持有一份灯箱状态；原生单例没这个问题，谁点谁开。
 *   · 编辑态（DiaryCanvas）与阅读态（DiaryPage）两边都要用，放 lib 里避免循环引用。
 *
 * 「不要压缩」的两层含义在这里兑现：
 *   · 灯箱里放的是**原图文件**（public/journal/photos 下未经任何重编码的原始字节）；
 *   · 显示用 `object-fit: contain` + max 约束，只等比缩放、绝不裁切/拉伸变形。
 */
export function openImageZoom(src: string, alt = ''): void {
  /* 已开着就先关掉（快速双击两下图时不会叠两层） */
  closeImageZoom();

  const mask = document.createElement('div');
  mask.className = 'dx-zoom';
  mask.setAttribute('role', 'dialog');
  mask.setAttribute('aria-label', '图片放大查看（点击任意处关闭）');

  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.className = 'dx-zoom-img';
  img.draggable = false;

  mask.appendChild(img);
  document.body.appendChild(mask);

  /* 点蒙版任何地方（含图片本身）都关闭；Esc 也关。挂在捕获阶段，
     免得翻页层/编辑器的其它 click 处理器抢先把事件吃掉。 */
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeImageZoom();
  };
  mask.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeImageZoom();
  });
  window.addEventListener('keydown', onKey, true);
  mask.dataset.cleanupKey = String(zoomCleanup.length);
  zoomCleanup.push(() => window.removeEventListener('keydown', onKey, true));

  /* 下一帧再加 is-on，让 CSS 的淡入过渡能生效 */
  requestAnimationFrame(() => mask.classList.add('is-on'));
}

const zoomCleanup: Array<() => void> = [];

export function closeImageZoom(): void {
  document.querySelectorAll('.dx-zoom').forEach((n) => n.remove());
  while (zoomCleanup.length) zoomCleanup.pop()?.();
}
