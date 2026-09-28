import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { resolveLinkMeta, normalizeUrl } from './link-meta';

/**
 * 「站内编辑 → 写回代码」的开发期写入通道。
 *
 * 为什么需要它：作者模式原来的保存只落在浏览器 IndexedDB 里，而 IndexedDB 是按
 * 「协议+域名+端口」隔离的 —— 换浏览器、换端口（localhost 与 127.0.0.1 就算两个）、
 * 清缓存、或者看构建后的版本，改动就都不见了。把改动写回源码文件之后，
 * 刷新、换端口、重新构建部署都会带着走，也能直接被 git 记录。
 *
 * 只在 `vite dev` 下生效（apply: 'serve'），构建产物里不含任何写入能力。
 *
 * 安全约束（因为 server.host 是开放的，局域网内别人也可能访问到）：
 *  1. 只接受来自回环地址的请求；
 *  2. 文件名一律由服务端生成，客户端只能传「槽位序号」和「白名单内的扩展名」，
 *     不接受任何路径片段 —— 避免路径穿越；
 *  3. 请求体大小有上限。
 */

const OVERRIDES_FILE = 'src/data/works.local.ts';
const UPLOAD_DIR = 'public/works/editor';
/** 上传文件的公开访问前缀（public/ 下的东西会挂在站点根）。 */
const UPLOAD_URL_BASE = '/works/editor';

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'pdf']);
const MAX_BODY = 32 * 1024 * 1024;

/* ---- 灵感收藏的落盘通道（与上面分开：存 JSON 数据文件 + 媒体目录） ---- */

/**
 * 为什么是 `public/` 而不是 `src/data/*.ts`：src 下的模块会被 Vite 纳进模块图，
 * 一改就触发 HMR 整页刷新 —— 作者每保存一条收藏页面就重载一次，没法连续录入。
 * public/ 是纯静态资源，写完即可被 fetch 到，不惊动模块图；而且 `npm run build`
 * 会原样拷进 dist/，构建产物同样带着这份数据。
 */
const INSP_DATA_FILE = 'public/insp/data.json';
const INSP_MEDIA_DIR = 'public/insp/media';
const INSP_MEDIA_URL = '/insp/media';

/** 灵感收藏允许上传的类型：图片（视觉 / 封面）+ 音频（本地歌曲） */
const INSP_ALLOWED_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'mp3',
  'm4a',
  'flac',
  'wav',
  'ogg',
  'aac',
]);

/** 生成文件的开头（保持不变，生成器每次整份重写）。 */
const HEADER = `/**
 * ⚠️ 本文件由「作者模式 → 提交项目 / 编辑项目」的**保存动作自动生成**。
 *
 * 请不要手改：每次在网站上保存，这里都会被整份覆盖。
 *
 * 分工：
 *  · \`works.ts\` 的 \`WORKS\` —— 手写种子（带注释、带完整样板），是兜底内容；
 *  · 本文件 \`WORK_OVERRIDES\` —— 只存"在网站上直接改过"的字段，按槽位覆盖种子。
 *
 * 为什么要单独一个文件：改动落进代码库之后，刷新、换浏览器、换端口、
 * 重新构建部署都会带着走，也能直接被 git 记录；同时手写种子里的注释不会被生成器抹掉。
 *
 * 键 = 木马槽位序号（0 起，对应第 1~6 个相框）；值 = 被改过的字段（没列的沿用种子）。
 */
import type { PlanCase } from './works';

/** 除了 PlanCase 的字段，还允许记住上传的 PDF 文件名。 */
export type WorkOverride = Partial<PlanCase> & { pdfName?: string };

`;

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('内容太大，已拒绝写入。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 把 JSON 字面量整体缩进 n 个空格（首行不缩，用于嵌进对象字面量）。 */
function indentBlock(text: string, n: number): string {
  const pad = ' '.repeat(n);
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n');
}

/** 把覆盖表序列化成可读、可 diff 的 TS 源码。 */
function serializeOverrides(slots: Record<string, unknown>): string {
  const keys = Object.keys(slots).sort((a, b) => Number(a) - Number(b));
  const body = keys
    .map((k) => `  ${k}: ${indentBlock(JSON.stringify(slots[k], null, 2), 2)},`)
    .join('\n');
  const literal = keys.length ? `{\n${body}\n}` : '{}';
  return `${HEADER}export const WORK_OVERRIDES: Record<string, WorkOverride> = ${literal};\n`;
}

/** 先写临时文件再改名，避免写到一半被 HMR 读到半截内容。 */
function writeAtomic(absPath: string, data: string | Buffer) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, absPath);
}

/** 校验客户端传进来的槽位序号：必须是非负整数。 */
function parseSlot(raw: string | null): number | null {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < 64 ? n : null;
}

/**
 * 上传文件名里塞了用户给的文件名（便于在 public/ 里一眼认出），
 * 所以必须做一次清洗：只留 ASCII 的字母数字和 `. _ -`，其余一律换成 `_`。
 * 否则 `../../evil.ts` 这类名字会写出项目目录之外。
 * 中文也换成 `_` —— 部署到部分对象存储 / CDN 上时，非 ASCII 文件名容易被二次编码成死链。
 */
function safeStem(raw: string): string {
  const base = raw
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 40);
  return base || 'file';
}

export function studioWriter(): Plugin {
  return {
    name: 'dreamcore-studio-writer',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/__studio/')) return next();

        if (!isLoopback(req)) {
          sendJson(res, 403, { ok: false, error: '写入通道只允许本机访问。' });
          return;
        }

        // ---- 探活：前端用它判断"能不能写回代码" ----
        if (url.pathname === '/__studio/ping' && req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            file: OVERRIDES_FILE,
            uploadUrlBase: UPLOAD_URL_BASE,
            insp: { ok: true, file: INSP_DATA_FILE, uploadUrlBase: INSP_MEDIA_URL },
          });
          return;
        }

        /* ================= 灵感收藏 ================= */

        // ---- 链接识别：服务端抓目标页抠 og；网易云 / QQ / GitHub 走平台 API ----
        if (url.pathname === '/__studio/link-meta' && req.method === 'GET') {
          const raw = (url.searchParams.get('url') ?? '').trim();
          if (!raw) {
            sendJson(res, 400, { ok: false, error: '缺少 url 参数。' });
            return;
          }
          const target = normalizeUrl(raw);
          let host = '';
          try {
            host = new URL(target).hostname;
          } catch {
            sendJson(res, 400, { ok: false, error: '链接格式不正确。' });
            return;
          }
          // 别让这个接口变成任意内网探测器：只允许公网 http(s)
          if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/i.test(host)) {
            sendJson(res, 400, { ok: false, error: '只支持公网链接。' });
            return;
          }
          void resolveLinkMeta(target)
            .then((meta) => sendJson(res, 200, { ok: true, meta }))
            .catch((err: unknown) =>
              sendJson(res, 502, {
                ok: false,
                error: err instanceof Error ? err.message : '抓取失败。',
              }),
            );
          return;
        }

        // ---- 整份灵感收藏落盘（public/insp/data.json） ----
        if (url.pathname === '/__studio/save-insp' && req.method === 'POST') {
          void readBody(req)
            .then((buf) => {
              const parsed: unknown = JSON.parse(buf.toString('utf8') || '{}');
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('请求体必须是一个对象。');
              }
              const env = parsed as { savedAt?: unknown; store?: unknown };
              if (!env.store || typeof env.store !== 'object' || Array.isArray(env.store)) {
                throw new Error('请求体缺少 store 对象。');
              }
              // 只允许六个白名单集合键，避免往 JSON 里塞进奇怪的东西
              const KEYS = ['vision', 'music', 'projects', 'skills', 'cases', 'knowledge'];
              const store = env.store as Record<string, unknown>;
              const clean: Record<string, unknown> = {};
              for (const k of KEYS) {
                if (Array.isArray(store[k])) clean[k] = store[k];
              }
              const payload = {
                savedAt: typeof env.savedAt === 'number' ? env.savedAt : Date.now(),
                store: clean,
              };
              const source = `${JSON.stringify(payload, null, 2)}\n`;
              const abs = path.join(root, INSP_DATA_FILE);
              writeAtomic(abs, source);
              sendJson(res, 200, { ok: true, file: INSP_DATA_FILE, bytes: source.length });
            })
            .catch((err: unknown) => {
              sendJson(res, 400, {
                ok: false,
                error: err instanceof Error ? err.message : '写入失败。',
              });
            });
          return;
        }

        // ---- 灵感收藏的媒体上传（图片 / 音频） ----
        if (url.pathname === '/__studio/insp-upload' && req.method === 'POST') {
          const ext = (url.searchParams.get('ext') ?? '').toLowerCase().replace(/^\./, '');
          const kind = url.searchParams.get('kind') === 'audio' ? 'audio' : 'image';
          const name = url.searchParams.get('name') ?? '';
          if (!INSP_ALLOWED_EXT.has(ext)) {
            sendJson(res, 400, { ok: false, error: `不支持的扩展名：${ext || '(空)'}` });
            return;
          }
          void readBody(req)
            .then((buf) => {
              if (!buf.length) throw new Error('文件内容为空。');
              const file = `${kind}-${safeStem(name)}-${Date.now().toString(36)}.${ext}`;
              const abs = path.join(root, INSP_MEDIA_DIR, file);
              writeAtomic(abs, buf);
              sendJson(res, 200, {
                ok: true,
                url: `${INSP_MEDIA_URL}/${file}`,
                bytes: buf.length,
              });
            })
            .catch((err: unknown) => {
              sendJson(res, 400, {
                ok: false,
                error: err instanceof Error ? err.message : '上传失败。',
              });
            });
          return;
        }

        // ---- 保存覆盖表：前端每次都发完整的一份，服务端整份重写 ----
        if (url.pathname === '/__studio/save-work' && req.method === 'POST') {
          void readBody(req)
            .then((buf) => {
              const parsed: unknown = JSON.parse(buf.toString('utf8') || '{}');
              const slots =
                parsed && typeof parsed === 'object' && 'slots' in parsed
                  ? (parsed as { slots?: unknown }).slots
                  : null;
              if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
                throw new Error('请求体缺少 slots 对象。');
              }
              const clean = slots as Record<string, unknown>;
              for (const key of Object.keys(clean)) {
                if (parseSlot(key) === null) throw new Error(`槽位序号不合法：${key}`);
              }
              const source = serializeOverrides(clean);
              const abs = path.join(root, OVERRIDES_FILE);
              writeAtomic(abs, source);
              sendJson(res, 200, { ok: true, file: OVERRIDES_FILE, bytes: source.length });
            })
            .catch((err: unknown) => {
              sendJson(res, 400, {
                ok: false,
                error: err instanceof Error ? err.message : '写入失败。',
              });
            });
          return;
        }

        // ---- 上传封面 / PDF：原始二进制，文件名由服务端生成 ----
        if (url.pathname === '/__studio/upload' && req.method === 'POST') {
          const slot = parseSlot(url.searchParams.get('slot'));
          const ext = (url.searchParams.get('ext') ?? '').toLowerCase().replace(/^\./, '');
          const kind = url.searchParams.get('kind') === 'pdf' ? 'pdf' : 'cover';
          if (slot === null) {
            sendJson(res, 400, { ok: false, error: '槽位序号不合法。' });
            return;
          }
          if (!ALLOWED_EXT.has(ext)) {
            sendJson(res, 400, { ok: false, error: `不支持的扩展名：${ext || '(空)'}` });
            return;
          }
          void readBody(req)
            .then((buf) => {
              if (!buf.length) throw new Error('文件内容为空。');
              const name = `slot${slot}-${kind}-${Date.now()}.${ext}`;
              const abs = path.join(root, UPLOAD_DIR, name);
              writeAtomic(abs, buf);
              sendJson(res, 200, {
                ok: true,
                url: `${UPLOAD_URL_BASE}/${name}`,
                bytes: buf.length,
              });
            })
            .catch((err: unknown) => {
              sendJson(res, 400, {
                ok: false,
                error: err instanceof Error ? err.message : '上传失败。',
              });
            });
          return;
        }

        sendJson(res, 404, { ok: false, error: '未知的写入接口。' });
      });
    },
  };
}
