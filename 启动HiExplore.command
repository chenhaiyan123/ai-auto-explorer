#!/bin/bash
# 双击启动 HiExplore 本地开发版：自动打开浏览器 http://localhost:3000
# 关闭这个终端窗口（或按 Ctrl+C）就停止
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
npm run dev -- --open
