/**
 * 简历下载 —— 菜单里点「Resume / 简历」走这里。
 *
 * 设计要点：
 *  · 文件还没上传时**不能让浏览器静默打开一个 404**（那是访客最困惑的体验），
 *    所以先 HEAD 探一下，404 就弹一条提示告诉作者该把文件放哪。
 *  · `download` 属性 + 同源路径 → 点击即下载，不新开标签页、不内嵌预览。
 *  · 探测用 HEAD：PDF 可能很大，GET 会真把它拉一遍。
 */
import { RESUME_FILENAME, RESUME_URL } from '@/data/contact';

/** 一次性提示条。复用 index.css 里 .dp-toast 的观感，但全局 fixed 定位（那个是局部 absolute）。 */
function notice(text: string) {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute(
    'style',
    [
      'position:fixed',
      'left:50%',
      'bottom:12%',
      'transform:translateX(-50%)',
      'z-index:9999',
      'padding:9px 18px',
      'border-radius:999px',
      'background:rgba(28,19,12,0.9)',
      'color:#fdfbf5',
      'font-size:13px',
      'box-shadow:0 10px 30px rgba(0,0,0,0.35)',
      'animation:dp-toast-in .22s var(--ease-world,cubic-bezier(.22,1,.36,1)) both',
      'pointer-events:none',
    ].join(';'),
  );
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 2800);
}

export async function downloadResume(): Promise<void> {
  try {
    const r = await fetch(RESUME_URL, { method: 'HEAD' });
    if (!r.ok) {
      notice('简历文件不见了：确认 public/孙晨茜简历-市场营销策划岗.pdf 还在项目里');
      return;
    }
  } catch {
    // 网络层失败就别拦了，让浏览器自己尝试——离线时弹提示反而多余
  }
  const a = document.createElement('a');
  a.href = RESUME_URL;
  a.download = RESUME_FILENAME; // 保留简历原文件名，不强制改名
  document.body.appendChild(a);
  a.click();
  a.remove();
}
