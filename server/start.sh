#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

install_marker="node_modules/.modules.yaml"
if [[ ! -f "$install_marker" || package.json -nt "$install_marker" || pnpm-lock.yaml -nt "$install_marker" ]] \
  || ! node -e "require.resolve('reflect-metadata')" >/dev/null 2>&1; then
  pnpm install
fi

pnpm build
exec npm run start
