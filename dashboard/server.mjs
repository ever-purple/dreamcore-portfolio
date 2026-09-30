// 网站管理面板 —— 本地 Node 服务（零依赖，仅用内置 http/https）
//
// 职责：
//   1. 读取本地 config.json（Vercel Token + ADMIN_KEY + 站点地址），不出现在前端
//   2. 起 localhost 服务，托管前端看板页面
//   3. 转发请求到 Vercel API 和你的网站 API —— 服务端请求不受浏览器 CORS 限制
//
// 启动：node server.mjs  （桌面双击 启动面板.bat 也可）
// 默认端口 8787，可用 PORT 环境变量覆盖

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

// ---------- 读配置 ----------
function loadConfig() {
  const p = path.join(__dirname, 'config.json');
  if (!fs.existsSync(p)) {
    return { vercelToken: '', adminKey: '', site: 'https://www.everpurple.top', teamId: '', projectId: 'prj_l7ut3JA06qZnhGHECpLo8x8yIhYA' };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { vercelToken: '', adminKey: '', site: 'https://www.everpurple.top', teamId: '', projectId: '' };
  }
}

function httpJson(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const opt = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: { 'User-Agent': 'portfolio-dashboard', Accept: 'application/json', ...headers },
    };
    if (body != null) {
      opt.headers['Content-Type'] = 'application/json';
    }
    const req = lib.request(opt, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(data); } catch { j = data; }
        resolve({ status: res.statusCode, json: j });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const jsonReply = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

// ---------- 各数据源 ----------
async function fetchVisitLog(cfg) {
  const url = `${cfg.site}/api/visitlog?key=${encodeURIComponent(cfg.adminKey)}`;
  const r = await httpJson(url);
  return r.json;
}

async function fetchGuestbook(cfg) {
  const url = `${cfg.site}/api/guestbook?key=${encodeURIComponent(cfg.adminKey)}`;
  const r = await httpJson(url);
  return r.json;
}

async function fetchVercelDeployments(cfg) {
  // 项目信息 + 最近部署（已验证可用）
  const url = `https://api.vercel.com/v9/projects/${cfg.projectId}?teamId=${cfg.teamId}`;
  const r = await httpJson(url, {
    headers: { Authorization: `Bearer ${cfg.vercelToken}` },
  });
  if (r.status !== 200 || !r.json || r.json.latestDeployments === undefined) {
    return { ok: false, status: r.status, error: r.json };
  }
  const p = r.json;
  const deployments = (p.latestDeployments || []).map((d) => ({
    id: d.id,
    url: d.url,
    alias: d.alias,
    state: d.readyState,
    substate: d.readySubstate,
    createdAt: d.createdAt,
    readyAt: d.readyAt,
    commitMessage: (d.meta && d.meta.githubCommitMessage) || '',
    commitSha: (d.meta && d.meta.githubCommitSha) || '',
  }));
  return {
    ok: true,
    project: {
      id: p.id,
      name: p.name,
      plan: p.plan || 'hobby',
      framework: p.framework,
      nodeVersion: p.nodeVersion,
      live: p.live,
    },
    deploymentExpiration: p.deploymentExpiration || null,
    deployments,
  };
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const cfg = loadConfig();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // 静态资源：前端页面
  if (p === '/' || p === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file, 'utf-8'));
    return;
  }

  // API 路由
  try {
    if (p === '/api/config-status') {
      jsonReply(res, 200, {
        hasToken: Boolean(cfg.vercelToken),
        hasAdminKey: Boolean(cfg.adminKey),
        site: cfg.site,
        projectId: cfg.projectId,
        teamId: cfg.teamId,
      });
      return;
    }
    if (p === '/api/visitlog') {
      const data = await fetchVisitLog(cfg);
      jsonReply(res, 200, data);
      return;
    }
    if (p === '/api/guestbook') {
      const data = await fetchGuestbook(cfg);
      jsonReply(res, 200, data);
      return;
    }
    if (p === '/api/vercel/deployments') {
      const data = await fetchVercelDeployments(cfg);
      jsonReply(res, 200, data);
      return;
    }
    jsonReply(res, 404, { ok: false, reason: 'not-found' });
  } catch (err) {
    jsonReply(res, 502, { ok: false, reason: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, () => {
  console.log(`面板已启动：http://localhost:${PORT}`);
  const cfg = loadConfig();
  console.log(`  配置：Vercel Token ${cfg.vercelToken ? '✓ 已填' : '✗ 未填'} · ADMIN_KEY ${cfg.adminKey ? '✓ 已填' : '✗ 未填'}`);
});
