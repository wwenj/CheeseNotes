#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/web"
SERVER_DIR="$ROOT_DIR/server"
WEB_DIST_DIR="$WEB_DIR/dist"
SERVER_PUBLIC_DIR="$SERVER_DIR/public"

echo '==> 安装 Web 依赖'
cd "$WEB_DIR"
pnpm install --frozen-lockfile

echo '==> 构建 Web 静态产物'
# 覆盖 Vite 配置中的 outDir，避免构建过程中直接写入服务端目录。
pnpm exec tsc -b
pnpm exec vite build --outDir dist

echo '==> 同步 Web 静态产物到 server/public'
rm -rf "$SERVER_PUBLIC_DIR"
mkdir -p "$SERVER_PUBLIC_DIR"
cp -R "$WEB_DIST_DIR"/. "$SERVER_PUBLIC_DIR"/

echo '==> 安装服务端依赖'
cd "$SERVER_DIR"
pnpm install --frozen-lockfile

echo '==> 构建服务端产物'
pnpm build

echo '==> 构建完成：server/dist 与 server/public'
