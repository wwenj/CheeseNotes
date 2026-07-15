#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/build.sh"

cd "$ROOT_DIR/server"
exec npm run start
