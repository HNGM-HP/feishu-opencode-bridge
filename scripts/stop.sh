#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[stop] 未检测到 Node.js，无法执行停止脚本"
  exit 1
fi

node "$SCRIPT_DIR/stop.mjs" "$@"
