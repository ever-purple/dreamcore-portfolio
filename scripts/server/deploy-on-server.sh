#!/usr/bin/env bash
#
# 服务器端部署脚本 —— 由 GitHub Actions 通过 SSH 调用，也可以在服务器上手动跑：
#
#   cd /var/www/dreamcore
#   TARGET_SHA=<某个 commit> bash scripts/server/deploy-on-server.sh
#
# ── 为什么这么设计 ────────────────────────────────────────────
# · 构建放在服务器上跑，而不是把 441MB 的 dist 从境外传过来
#   → 每次部署的跨境流量只有源码增量（通常几百 KB ~ 几 MB）
# · 首次用 --depth=1 浅克隆，不拉 746MB 的完整历史
# · 仓库里有 server.mjs 就当 Node 服务重启（pm2）；没有就按纯静态重载 nginx
#
# ── 可用环境变量覆盖 ──────────────────────────────────────────
#   DREAMCORE_REPO            仓库地址（默认 GitHub HTTPS）
#   DREAMCORE_BRANCH          分支（默认 main）
#   DREAMCORE_APP_DIR         部署目录（默认 /var/www/dreamcore）
#   DREAMCORE_PM2_APP         pm2 进程名（默认 dreamcore）
#   DREAMCORE_NODE_HEAP       构建时的 Node 堆上限 MB（默认按物理内存的 3/4 自适应）
#   DREAMCORE_SKIP_NGINX=1    跳过 nginx 重载
#
set -euo pipefail

REPO_URL="${DREAMCORE_REPO:-https://github.com/ever-purple/dreamcore-portfolio.git}"
BRANCH="${DREAMCORE_BRANCH:-main}"
APP_DIR="${DREAMCORE_APP_DIR:-/var/www/dreamcore}"
PM2_APP="${DREAMCORE_PM2_APP:-dreamcore}"
TARGET_SHA="${TARGET_SHA:-}"

# ── 构建时的 Node 堆上限 ──────────────────────────────────────
# 按物理内存自适应（2G 机器 → 1536MB，4G → 3072MB），别写死：
# 写死会在小内存机上 OOM，在大内存机上又白白浪费。
MEM_MB="$(awk '/^MemTotal:/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 2048)"
if [ -n "${DREAMCORE_NODE_HEAP:-}" ]; then
  NODE_HEAP="$DREAMCORE_NODE_HEAP"
else
  NODE_HEAP=$(( MEM_MB * 3 / 4 ))
  [ "$NODE_HEAP" -lt 512 ] && NODE_HEAP=512
fi

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }

log "部署开始  $(date '+%F %T')   目标目录 = $APP_DIR"

# ── 1. 取代码 ─────────────────────────────────────────────────
if [ ! -d "$APP_DIR/.git" ]; then
  log "首次部署：浅克隆到 $APP_DIR（约 400MB，视线路可能较慢）"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  log "拉取 $BRANCH 最新提交"
  cd "$APP_DIR"
  git fetch --depth=1 origin "$BRANCH"
  git reset --hard FETCH_HEAD
  # 清掉构建残留，避免上一次的 dist 混进来
  git clean -fd -e node_modules -e dist -e start.sh >/dev/null 2>&1 || true
fi

cd "$APP_DIR"

# 校验 CI 指定的提交确实落地了
if [ -n "$TARGET_SHA" ]; then
  ACTUAL="$(git rev-parse HEAD)"
  if [ "$ACTUAL" != "$TARGET_SHA" ]; then
    warn "期望提交 $TARGET_SHA，实际 $ACTUAL —— 继续构建，但请留意。"
  else
    log "提交校验通过：$ACTUAL"
  fi
fi

# ── 2. 依赖 ───────────────────────────────────────────────────
log "安装依赖"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

# ── 3. 构建 ───────────────────────────────────────────────────
log "构建（tsc -b && vite build）"
NODE_OPTIONS="--max-old-space-size=$NODE_HEAP" npm run build

# ── 4. 重启服务 ───────────────────────────────────────────────
if [ -f server.mjs ]; then
  log "检测到 server.mjs → 以 Node 服务方式重启（pm2: $PM2_APP）"

  # 环境变量文件 —— 里面是 ADMIN_KEY / Upstash Redis / Vercel Blob 三组凭据。
  # ⚠️ 没有它的话，留言板、访客统计、灵感收藏上传会**静默失效**
  #    （接口返回 503，页面本身照常打开，不报错，极难发现）。
  ENV_FILE="$APP_DIR/.env.production"
  if [ -f "$ENV_FILE" ]; then
    log "已找到 $ENV_FILE，将随 start.sh 一起注入环境变量"
  else
    warn "未找到 $ENV_FILE —— 接口会因缺少凭据而返回 503（留言板/访客统计/上传失效）。"
    warn "照 docs/deploy-to-server.md「3.5 处理 /api」建好它再重新部署。"
  fi

  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
  fi
  # 用仓库里的 start.sh 包装器启动：它保证 --env-file 在脚本名之前传给 node。
  # 直接 `pm2 start server.mjs --node-args=...` 会把参数放到脚本名之后，env 不加载
  # （ADMIN_KEY=false、Redis/Blob 接口 503）。
  pm2 start start.sh --name "$PM2_APP" --interpreter bash
  pm2 save
elif [ "${DREAMCORE_SKIP_NGINX:-0}" != "1" ] && command -v nginx >/dev/null 2>&1; then
  log "未检测到 server.mjs → 按纯静态处理，重载 nginx"
  # 需要给部署用户配 sudo NOPASSWD，否则 CI 里会卡在密码提示
  if sudo -n nginx -t 2>/dev/null; then
    sudo -n systemctl reload nginx
  else
    warn "sudo 无法免密执行 nginx —— 请按 docs/deploy-to-server.md 配 NOPASSWD。"
  fi
else
  log "静态产物已就绪：$APP_DIR/dist"
fi

log "部署完成  $(date '+%F %T')"
