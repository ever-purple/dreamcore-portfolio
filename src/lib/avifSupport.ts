/**
 * AVIF 解码能力探测 —— 一次探测、全局缓存。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么不能用「同步 canvas 探测」
 * ---------------------------------------------------------------------------
 * 网上最常见的写法是：
 *
 *     document.createElement('canvas').toDataURL('image/avif').startsWith('data:image/avif')
 *
 * **在 Chromium 上它是错的。** 本机实测（Edge 154 / Chromium 154）它会返回
 * `data:image/png` —— 因为 canvas 的 `toDataURL` 只反映浏览器有没有 AVIF **编码器**，
 * 而 Chrome 至今不支持把 canvas 编成 AVIF。拿它当判据会把**绝大多数**
 * Chrome / Edge / 微信内置浏览器的用户错误地挡在 AVIF 外面，
 * 也就是「优化只对少数人生效」—— 比不做优化还糟。
 *
 * `ImageDecoder.isTypeSupported('image/avif')` 也不能用：本机实测
 * `typeof ImageDecoder === 'undefined'`（Chromium 里 WebCodecs 的 ImageDecoder 并未开放）。
 *
 * → 唯一可靠的判据是**真的解一张 AVIF**。这里内联一个 4×4 的 AVIF data URI：
 *   零额外网络请求（不进 HTTP 缓存也不需要文件），且测的是真正的解码能力。
 *   探测结果缓存在模块级 Promise 上，全站只跑一次。
 *
 * ⚠️ 失败/超时必须落到 `false`（走 WebP）而不是 `true`：
 *   序列帧解码失败**不报错**，只会让那一格永远没有画面（见 useWindowedFrames 的
 *   「坏图也算定案」）。宁可退回 10.7MB 的 WebP，也不能赌一个空白首页。
 */

/** 4×4 的 AVIF（aom 编码，315 字节 → base64 420 字符）。只是一个「能不能解」的探针。 */
const TINY_AVIF =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAKAAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAABAAAAAQAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAMG1kYXQSAAoIGAR9ogIaDQgyGheHh4YhhJJJJkEAAJA+tbGCzyjBP2NbR2eA';

/** 探测超时。解码一个 315 字节的图正常是「一个微任务」级别，1.5s 只可能是异常环境。 */
const PROBE_TIMEOUT = 1500;

let cached: Promise<boolean> | null = null;

function probe(): Promise<boolean> {
  // `?noavif=1` 强制走 WebP —— 回归探针靠它测兜底路径，不用真的找个老浏览器
  try {
    if (new URLSearchParams(window.location.search).has('noavif')) {
      return Promise.resolve(false);
    }
  } catch {
    /* URLSearchParams 不可用就别管，继续探测 */
  }

  return new Promise<boolean>((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT);
    img.onload = () => finish(img.naturalWidth > 0);
    img.onerror = () => finish(false);
    img.src = TINY_AVIF;
  });
}

/**
 * 返回浏览器**能否真的解码 AVIF**。全站只探测一次，之后命中缓存。
 * 永不 reject —— 任何异常都落到 `false`。
 */
export function supportsAvif(): Promise<boolean> {
  if (!cached) cached = probe().catch(() => false);
  return cached;
}
