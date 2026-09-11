/**
 * 从音频文件里读元数据（作者模式上传歌曲时用）。
 *
 * 为什么要自己写：上传的是**歌曲**而不是封面图，封面得从音频文件内嵌的 tag 里挖出来。
 * 走 npm 库（jsmediatags / music-metadata）要多吃 100~200KB，而这里只需要
 * 「标题 + 歌手 + 封面」三样，手写一个只读解析器更划算。
 *
 * 支持：
 *   - ID3v2.2 / v2.3 / v2.4（mp3 主流）→ TIT2/TPE1/TALB/TCON + APIC 内嵌图
 *   - MP4 / M4A 的 ilst 原子 → `©nam` 标题 + `covr` 封面
 *   - ID3v1（老 mp3，文件末尾 128 字节）→ 只有纯文本标题/歌手，没有封面
 *
 * 解析不出来不是错误：返回 source: 'none'，界面让用户手填标题 + 手动传封面。
 */

export type AudioTags = {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string[];
  /** 内嵌封面。已是可直接塞进 <img src> 的 blob URL；没有则为 undefined */
  cover?: string;
  /** 标签来源，用来给用户解释「到底识别到了什么」 */
  source: 'id3v2' | 'mp4' | 'id3v1' | 'none';
};

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

/** 清掉控制字符与首尾空白（tag 里经常混着 \u0000 填充） */
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim();

/** ID3v2 的"同步安全整数"：每字节只用低 7 位 */
const syncsafe = (b: Uint8Array, o: number) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

const uint32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** 把字节按 ID3 规定的 encoding 字节解成字符串 */
function decodeText(frame: Uint8Array): string {
  if (frame.length < 2) return '';
  const enc = frame[0];
  const body = frame.subarray(1);
  try {
    if (enc === 0) return clean(new TextDecoder('latin1').decode(body));
    if (enc === 1) {
      if (body[0] === 0xff && body[1] === 0xfe) return clean(new TextDecoder('utf-16le').decode(body.subarray(2)));
      if (body[0] === 0xfe && body[1] === 0xff) return clean(new TextDecoder('utf-16be').decode(body.subarray(2)));
      return clean(new TextDecoder('utf-16le').decode(body));
    }
    if (enc === 2) return clean(new TextDecoder('utf-16be').decode(body));
    return clean(new TextDecoder('utf-8').decode(body));
  } catch {
    return '';
  }
}

/** Uint8Array → blob URL（用拷贝出来的 ArrayBuffer，避免引用整个大文件） */
function blobUrl(data: Uint8Array, mime: string): string {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return URL.createObjectURL(new Blob([copy], { type: mime }));
}

/* ------------------------------------------------------------------ */
/* ID3v2                                                               */
/* ------------------------------------------------------------------ */

/** 解析 APIC（v2.3/2.4）或 PIC（v2.2）帧，取出图片字节 */
function readAttachedPicture(body: Uint8Array, v22: boolean): string | undefined {
  if (body.length < 8) return undefined;
  const enc = body[0];
  let i: number;
  let mime = 'image/jpeg';

  if (v22) {
    // v2.2 用 3 字节图片格式代替 mime 字符串（"JPG" / "PNG"）
    const fmt = String.fromCharCode(body[1], body[2], body[3]).toUpperCase();
    mime = fmt.includes('PNG') ? 'image/png' : 'image/jpeg';
    i = 4;
  } else {
    let j = 1;
    while (j < body.length && body[j] !== 0) j++;
    const raw = clean(new TextDecoder('latin1').decode(body.subarray(1, j)));
    if (raw.startsWith('image/')) mime = raw;
    i = j + 1;
  }

  i += 1; // 图片类型字节（0x03 = front cover）

  // 描述字段：UTF-16 用 00 00 结尾，其余用单个 00
  if (enc === 1 || enc === 2) {
    while (i + 1 < body.length && !(body[i] === 0 && body[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < body.length && body[i] !== 0) i++;
    i += 1;
  }

  if (i >= body.length || body.length - i < 128) return undefined;
  return blobUrl(body.subarray(i), mime);
}

function readId3v2(buf: ArrayBuffer): AudioTags | null {
  const b = new Uint8Array(buf);
  if (b.length < 10) return null;
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null; // "ID3"

  const major = b[3];
  const flags = b[5];
  const end = Math.min(10 + syncsafe(b, 6), b.length);

  let p = 10;
  // 扩展头：v2.4 的 ext size 也是同步安全整数，且含自身 4 字节；v2.3 是普通 uint32（不含自身）
  if (flags & 0x40) {
    if (major >= 4) p += syncsafe(b, p);
    else p += 4 + uint32(b, p);
  }

  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;

  const out: AudioTags = { source: 'id3v2' };

  while (p + headLen <= end) {
    const id = String.fromCharCode(...b.subarray(p, p + idLen));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;

    const fsize =
      major === 2
        ? ((b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]) >>> 0
        : major >= 4
          ? syncsafe(b, p + 4)
          : uint32(b, p + 4);
    if (fsize <= 0) break;

    const start = p + headLen;
    const stop = Math.min(start + fsize, end);
    if (start >= stop) break;
    const body = b.subarray(start, stop);

    if (id === 'TIT2' || id === 'TT2') out.title ||= decodeText(body) || undefined;
    else if (id === 'TPE1' || id === 'TP1') out.artist ||= decodeText(body) || undefined;
    else if (id === 'TALB' || id === 'TAL') out.album ||= decodeText(body) || undefined;
    else if (id === 'TCON' || id === 'TCO') {
      const g = decodeText(body);
      if (g && !out.genre?.length) {
        out.genre = g
          .split(/[/;,、]|feat\.?/i)
          .map((s) => s.trim().replace(/^\((\d+)\)$/, '$1'))
          .filter((s) => s && !/^\d+$/.test(s))
          .slice(0, 4);
      }
    } else if (id === 'APIC' || id === 'PIC') {
      out.cover ||= readAttachedPicture(body, id === 'PIC');
    }

    p = stop;
  }

  return out.title || out.artist || out.cover ? out : null;
}

/* ------------------------------------------------------------------ */
/* MP4 / M4A                                                           */
/* ------------------------------------------------------------------ */

/** 在 ilst 里扫 `©nam` / `covr` 原子。只做顺序粗扫，够用且不怕嵌套层级变化。 */
function readMp4(buf: ArrayBuffer): AudioTags | null {
  const b = new Uint8Array(buf);
  const out: AudioTags = { source: 'mp4' };
  let found = false;

  for (let i = 0; i + 16 < b.length; i++) {
    const isCovr = b[i] === 0x63 && b[i + 1] === 0x6f && b[i + 2] === 0x76 && b[i + 3] === 0x72;
    const isNam = b[i] === 0xa9 && b[i + 1] === 0x6e && b[i + 2] === 0x61 && b[i + 3] === 0x6d;
    const isArt = b[i] === 0xa9 && b[i + 1] === 0x41 && b[i + 2] === 0x52 && b[i + 3] === 0x54;
    if (!isCovr && !isNam && !isArt) continue;

    const atomStart = i + 4;
    if (atomStart + 8 > b.length) break;
    const size = uint32(b, atomStart);
    if (size < 16 || atomStart + size > b.length) continue;
    const kind = String.fromCharCode(...b.subarray(atomStart + 4, atomStart + 8));
    if (kind !== 'data') continue;

    const type = uint32(b, atomStart + 8);
    // type 0 = 隐式二进制（后面多 4 字节 locale），13 = JPEG，14 = PNG
    const payload = type === 13 || type === 14 ? atomStart + 12 : atomStart + 16;
    const stop = atomStart + size;
    if (payload >= stop) continue;
    const data = b.subarray(payload, stop);

    if (isCovr && !out.cover) {
      out.cover = blobUrl(data, type === 14 ? 'image/png' : 'image/jpeg');
      found = true;
    } else if (isNam && !out.title) {
      out.title = clean(new TextDecoder('utf-8').decode(data)) || undefined;
      found = true;
    } else if (isArt && !out.artist) {
      out.artist = clean(new TextDecoder('utf-8').decode(data)) || undefined;
      found = true;
    }

    i = atomStart + size - 1;
  }

  return found ? out : null;
}

/* ------------------------------------------------------------------ */
/* ID3v1                                                               */
/* ------------------------------------------------------------------ */

/** 文件末尾 128 字节的 "TAG" 块。只有文本，没有封面。 */
function readId3v1(buf: ArrayBuffer): AudioTags | null {
  const b = new Uint8Array(buf);
  if (b.length < 128) return null;
  const o = b.length - 128;
  if (!(b[o] === 0x54 && b[o + 1] === 0x41 && b[o + 2] === 0x47)) return null; // "TAG"

  const at = (s: number, len: number) => clean(new TextDecoder('latin1').decode(b.subarray(s, s + len)));
  const title = at(o + 3, 30);
  const artist = at(o + 33, 30);
  const album = at(o + 63, 30);
  if (!title && !artist) return null;
  return { title: title || undefined, artist: artist || undefined, album: album || undefined, source: 'id3v1' };
}

/* ------------------------------------------------------------------ */
/* 对外入口                                                            */
/* ------------------------------------------------------------------ */

/** 读取音频文件的内嵌标签；认不出来时返回 source: 'none'（不是异常） */
export async function readAudioTags(file: File): Promise<AudioTags> {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    return { source: 'none' };
  }
  return readId3v2(buf) ?? readMp4(buf) ?? readId3v1(buf) ?? { source: 'none' };
}
