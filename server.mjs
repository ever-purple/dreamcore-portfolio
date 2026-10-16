/**
 * 站点服务（阿里云自托管）—— 同时托管 dist/ 静态产物与 api/ 下的 8 个接口。
 *
 * 为什么需要这个文件：
 *   本站不是纯静态站。api/ 下有 8 个接口（留言板、访客统计、访问日志、灵感收藏、
 *   歌词代理、链接识别、作者校验、后台数据），它们在 Vercel 上是 Serverless，
 *   搬到自己的服务器后必须有一个常驻进程来跑它们。就是这个文件。
 *
 *   ⚠️ scripts/server/deploy-on-server.sh 靠「根目录有没有 server.mjs」来判断
 *   该不该用 pm2 起服务。**这个文件存在，脚本才会启动接口**；删掉它，
 *   部署脚本会退回「纯静态」分支，8 个接口静默失效。
 *
 * 启动方式（pm2 守护）：
 *   pm2 start server.mjs --name dreamcore --node-args="--env-file=.env.production"
 *   pm2 save
 *
 * 设计要点：
 *   · 零 npm 依赖 —— 只用 Node 内置模块 + 系统里的 tsc（项目本来就装了 typescript）
 *   · api/*.ts 在启动时用 tsc 编译一次到 _api/，之后按需 import
 *   · 适配层把原生 Node 的 req/res 包装成 Vercel 的形状，
 *     让 api/*.ts 里的代码**一行都不用改**
 *
 * ── 接口契约（从 api/*.ts 实测归纳，改适配层时勿破坏）──────────────
 *   · 全部 8 个文件统一 `export default async function handler(req, res)`
 *   · req.method   —— 大写的 HTTP 方法
 *   · req.query    —— **已解析好的对象**（不是 URLSearchParams），值可能是数组
 *   · req.headers  —— 全小写键的普通对象
 *   · req.body     —— 三态：普通对象 / 字符串 / Buffer
 *                     （insp 上传图片时拿的是 Buffer，其它接口是对象或字符串）
 *   · res.status(code) → 返回自身，可链式 .json()
 *   · res.setHeader(k, v) / res.json(body) / res.send(body)
 */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(HERE, 'dist');
const API_SRC = join(HERE, 'api');
const API_OUT = join(HERE, '_api');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const log = (...a) => console.log('[server]', ...a);
const warn = (...a) => console.warn('[server][warn]', ...a);

/* ══════════════════════════════════════════════════════════════
   1. 启动时编译 api/*.ts → _api/*.js
   ══════════════════════════════════════════════════════════════
   接口源码用了 TS 类型注解，Node 不能直接跑。这里调项目自带的 tsc 转一次。
   只在启动时做一遍，运行期不再编译。 */
async function buildApi() {
  const files = [];
  if (existsSync(API_SRC)) {
    for (const f of readdirSync(API_SRC)) {
      if (f.endsWith('.ts')) files.push(join('api', f));
    }
  }
  if (!files.length) {
    warn('api/ 目录下没有 .ts 文件，接口功能将不可用');
    return false;
  }

  // TS 的 emit 不会自己建 outDir
  await mkdir(API_OUT, { recursive: true });

  log(`编译 ${files.length} 个接口 → _api/`);

  // ⚠️ 这里用 TypeScript 的 API **在进程内**编译，而不是 spawn 一个 tsc 子进程。
  //    原因：Windows 上 spawnSync(process.execPath, ...) 会撞 EBUSY
  //    （node.exe 正被当前进程占用，无法再作为子进程镜像启动）。
  //    进程内编译同时还有三个好处：不依赖 npx/PATH、跨平台一致、启动更快。
  let ts;
  try {
    ts = (await import('typescript')).default;
  } catch {
    warn('找不到 typescript 模块 —— 接口未编译。请先 npm ci。');
    return false;
  }

  const options = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: ['node'],
    outDir: API_OUT,
    rootDir: API_SRC,
  };

  const program = ts.createProgram(
    files.map((f) => join(HERE, f)),
    options,
  );
  const emit = program.emit();

  // 收集真实的 TS 报错，别让失败原因被吞掉
  const diags = ts
    .getPreEmitDiagnostics(program)
    .concat(emit.diagnostics)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);

  if (emit.emitSkipped || diags.length) {
    warn(`接口编译失败（${diags.length} 个错误）—— /api/* 将返回 500：`);
    for (const d of diags.slice(0, 12)) {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (d.file && d.start != null) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        console.warn(`  ${d.file.fileName}:${line + 1}:${character + 1}  ${msg}`);
      } else {
        console.warn(`  ${msg}`);
      }
    }
    return false;
  }
  return true;
}

const apiBuilt = await buildApi();

/* ══════════════════════════════════════════════════════════════
   2. 把原生 Node req/res 包装成 Vercel 的形状
   ══════════════════════════════════════════════════════════════ */

/** 把原始 body 读成 Buffer（Vercel 会给解析好的 body，原生 Node 不会） */
function readBody(raw) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    raw.on('data', (c) => chunks.push(c));
    raw.on('end', () => resolve(Buffer.concat(chunks)));
    raw.on('error', reject);
  });
}

/**
 * 按 Content-Type 决定 req.body 的形态 —— 必须与 Vercel 的行为一致：
 *   · application/json      → 解析成对象（api 里普遍按对象用）
 *   · 其它（含二进制上传）  → 给 Buffer（insp.ts 上传走这条）
 */
function shapeBody(buf, contentType = '') {
  if (!buf.length) return undefined;
  const ct = contentType.toLowerCase();
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      return buf.toString('utf8'); // 解析不了就给字符串，接口自己会兜底
    }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(buf.toString('utf8')));
  }
  // multipart / octet-stream / 其它 → Buffer，让接口自己处理
  return buf;
}

/** 构造 Vercel 风格的 req */
function makeReq(raw, url) {
  // req.query 是「已解析的对象」，数组值保留数组（如 ?a=1&a=2）
  const query = {};
  for (const [k, v] of url.searchParams) {
    if (k in query) {
      query[k] = Array.isArray(query[k]) ? [...query[k], v] : [query[k], v];
    } else {
      query[k] = v;
    }
  }

  const headers = {};
  for (const [k, v] of Object.entries(raw.headers)) {
    headers[k.toLowerCase()] = v;
  }

  const req = {
    method: (raw.method || 'GET').toUpperCase(),
    url: raw.url,
    headers,
    query,
    body: undefined,
  };
  return req;
}

/** 构造 Vercel 风格的 res，把方法调用落到原生 ServerResponse 上 */
function makeRes(rawRes) {
  let statusCode = 200;
  const headers = {};
  let headersSent = false;

  const flush = () => {
    if (headersSent) return;
    headersSent = true;
    rawRes.writeHead(statusCode, headers);
  };

  return {
    status(code) {
      statusCode = code;
      return this; // 支持链式 .status(200).json(...)
    },
    setHeader(key, value) {
      headers[key] = value;
    },
    json(body) {
      flush();
      rawRes.end(JSON.stringify(body));
    },
    send(body) {
      flush();
      rawRes.end(typeof body === 'string' ? body : String(body ?? ''));
    },
  };
}

/* ══════════════════════════════════════════════════════════════
   3. 静态文件的 Content-Type 与缓存策略
   ══════════════════════════════════════════════════════════════ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * 缓存策略 —— 必须和 vercel.json 里那套保持一致，
 * 否则搬到自托管后首访会反复拉大文件（这是最容易被忽略的坑）。
 */
function cacheFor(pathname) {
  // 序列帧 / 打包产物 / 媒体：一年不可变（文件名带 hash 或内容不会变）
  if (/^\/(frames|frames-sm|frames-avif|frames-sm-avif|assets)\//.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  if (/^\/(studio|media)\/.+\.(mp4|webm|m4a|mp3)$/i.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  // 图片 / 字体 / 模型：一天 + 一周 stale-while-revalidate
  if (/\.(webp|jpg|jpeg|png|gif|avif|svg|woff2|woff|ttf|otf|glb)$/i.test(pathname)) {
    return 'public, max-age=86400, stale-while-revalidate=604800';
  }
  // HTML 不缓存，保证 push 后立刻更新
  if (/\.html?$/i.test(pathname) || pathname === '/') return 'no-cache';
  return null;
}

/* ══════════════════════════════════════════════════════════════
   4. 请求总入口
   ══════════════════════════════════════════════════════════════ */

async function serveStatic(pathname, rawRes) {
  // 只做「静态根目录内」的解析，防路径穿越
  const rel = normalize(pathname)
    .replace(/^([.][.][/\\])+/, '')
    .replace(/^[/\\]+/, '');
  let file = join(DIST, rel || 'index.html');

  try {
    const st = await stat(file);
    if (st.isDirectory()) file = join(file, 'index.html');
  } catch {
    // 单页 + query 参数：找不到就回退首页（与 nginx try_files 行为一致）
    file = join(DIST, 'index.html');
  }

  let body;
  try {
    body = await readFile(file);
  } catch {
    rawRes.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    rawRes.end('404 Not Found');
    return;
  }

  const headers = {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
  };
  const cc = cacheFor(pathname);
  if (cc) headers['cache-control'] = cc;

  rawRes.writeHead(200, headers);
  rawRes.end(body);
}

const server = createServer(async (rawReq, rawRes) => {
  const url = new URL(rawReq.url, `http://${rawReq.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  // ── /api/* → 动态加载编译好的接口 ──
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice('/api/'.length).split('/')[0];

    // 白名单式取名，防目录穿越 / 加载任意文件
    if (!/^[a-z0-9-]+$/i.test(name)) {
      rawRes.writeHead(400, { 'content-type': 'application/json' });
      rawRes.end(JSON.stringify({ ok: false, reason: 'bad-api-name' }));
      return;
    }

    if (!apiBuilt) {
      rawRes.writeHead(500, { 'content-type': 'application/json' });
      rawRes.end(JSON.stringify({ ok: false, reason: 'api-not-built' }));
      return;
    }

    // 先看文件在不在 —— 区分「接口不存在」(404) 与「接口内部报错」(500)。
    // 不这样分开的话，import 一个不存在的文件会抛异常，
    // 被下面的 catch 一律当成 500，掩盖真实原因。
    const apiFile = join(API_OUT, `${name}.js`);
    if (!existsSync(apiFile)) {
      rawRes.writeHead(404, { 'content-type': 'application/json' });
      rawRes.end(JSON.stringify({ ok: false, reason: 'api-not-found' }));
      return;
    }

    try {
      const mod = await import(pathToFileURL(apiFile).href);
      const handler = mod.default || mod.handler;
      if (typeof handler !== 'function') {
        rawRes.writeHead(404, { 'content-type': 'application/json' });
        rawRes.end(JSON.stringify({ ok: false, reason: 'api-not-found' }));
        return;
      }

      const req = makeReq(rawReq, url);
      const res = makeRes(rawRes);

      // 读 body（GET / HEAD 通常没有，但读一下无害）
      const buf = await readBody(rawReq);
      req.body = shapeBody(buf, rawReq.headers['content-type']);

      await handler(req, res);
    } catch (err) {
      console.error('[api]', name, err);
      if (!rawRes.headersSent) {
        rawRes.writeHead(500, { 'content-type': 'application/json' });
      }
      rawRes.end(JSON.stringify({ ok: false, reason: 'internal-error' }));
    }
    return;
  }

  // ── 其余走静态 ──
  try {
    await serveStatic(pathname, rawRes);
  } catch (err) {
    console.error('[static]', pathname, err);
    if (!rawRes.headersSent) {
      rawRes.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    rawRes.end('500');
  }
});

server.listen(PORT, HOST, () => {
  log(`已启动 http://${HOST}:${PORT}`);
  log(`静态根目录 ${DIST}`);
  log(`接口数量   ${apiBuilt ? '已编译就绪' : '⚠️ 未就绪'}`);
  log(`环境变量   REDIS=${Boolean(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)}` +
      ` BLOB=${Boolean(process.env.BLOB_READ_WRITE_TOKEN)}` +
      ` ADMIN_KEY=${Boolean(process.env.ADMIN_KEY)}`);
});
