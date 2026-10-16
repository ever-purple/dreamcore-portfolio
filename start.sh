#!/usr/bin/env bash
# pm2 入口包装：确保 --env-file 在脚本名之前传给 node。
#
# 直接 `pm2 start server.mjs --node-args="--env-file=..."` 会把参数放到脚本名之后，
# node 把它当成脚本参数而非 Node flag，导致 ADMIN_KEY=false、Redis/Blob 接口 503。
# 这里把 flag 放在脚本名之前，env 才能正确加载。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node --env-file="$DIR/.env.production" "$DIR/server.mjs"
