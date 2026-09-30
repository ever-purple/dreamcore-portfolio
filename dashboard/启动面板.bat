@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动网站管理面板...
start "" http://localhost:8787
node server.mjs
