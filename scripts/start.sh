#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[start] 未检测到 Node.js，请先执行 ./scripts/deploy.sh deploy"
  exit 1
fi

node "$SCRIPT_DIR/start.mjs" "$@"
