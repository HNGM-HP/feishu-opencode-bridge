#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIN_NODE_MAJOR=18

is_interactive_shell() {
  [[ -t 0 && -t 1 ]]
}

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

ask_yes_no() {
  local prompt="$1"
  local default_yes="$2"

  if ! is_interactive_shell; then
    [[ "$default_yes" == "yes" ]]
    return
  fi

  local answer=""
  read -r -p "$prompt" answer || true
  answer="$(to_lower "$answer")"

  if [[ -z "$answer" ]]; then
    [[ "$default_yes" == "yes" ]]
    return
  fi

  case "$answer" in
    y|yes|1|true|是)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

print_node_install_guide() {
  echo "[deploy] Node.js 安装指引（请按需执行）"
  local os_name
  os_name="$(uname -s 2>/dev/null || echo unknown)"

  case "$os_name" in
    Darwin)
      echo "  - brew install node"
      echo "  - 或官方安装包: https://nodejs.org/"
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        echo "  - sudo apt-get update && sudo apt-get install -y nodejs npm"
      fi
      if command -v dnf >/dev/null 2>&1; then
        echo "  - sudo dnf install -y nodejs npm"
      fi
      if command -v yum >/dev/null 2>&1; then
        echo "  - sudo yum install -y nodejs npm"
      fi
      if command -v pacman >/dev/null 2>&1; then
        echo "  - sudo pacman -S --needed nodejs npm"
      fi
      if ! command -v apt-get >/dev/null 2>&1 && ! command -v dnf >/dev/null 2>&1 && ! command -v yum >/dev/null 2>&1 && ! command -v pacman >/dev/null 2>&1; then
        echo "  - 官方安装包: https://nodejs.org/"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "  - PowerShell: winget install -e --id OpenJS.NodeJS.LTS"
      echo "  - 或官方安装包: https://nodejs.org/"
      ;;
    *)
      echo "  - 官方安装包: https://nodejs.org/"
      ;;
  esac
}

get_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  local version
  version="$(node -v 2>/dev/null || true)"
  version="${version#v}"
  local major
  major="${version%%.*}"

  if [[ ! "$major" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  echo "$major"
}

get_npm_version() {
  if ! command -v npm >/dev/null 2>&1; then
    return 1
  fi

  npm -v 2>/dev/null || true
}

ensure_node_runtime() {
  local major
  major="$(get_node_major || true)"

  if [[ -n "$major" ]] && (( major >= MIN_NODE_MAJOR )); then
    echo "[deploy] Node.js 已就绪: $(node -v)"
    return
  fi

  if [[ -n "$major" ]]; then
    echo "[deploy] 检测到 Node.js 版本过低: $(node -v)，需要 >= ${MIN_NODE_MAJOR}"
  else
    echo "[deploy] 未检测到 Node.js"
  fi

  if ask_yes_no "[deploy] 是否现在查看 Node.js 安装引导？[Y/n]: " yes; then
    print_node_install_guide
  fi

  if ask_yes_no "[deploy] 完成安装或升级后，是否立即重试检测？[Y/n]: " yes; then
    major="$(get_node_major || true)"
    if [[ -n "$major" ]] && (( major >= MIN_NODE_MAJOR )); then
      echo "[deploy] Node.js 已就绪: $(node -v)"
      return
    fi
  fi

  echo "[deploy] Node.js 未就绪，请安装 Node.js >= ${MIN_NODE_MAJOR} 后重试"
  exit 1
}

ensure_npm_runtime() {
  local npm_version
  npm_version="$(get_npm_version || true)"

  if [[ -n "$npm_version" ]]; then
    echo "[deploy] npm 已就绪: ${npm_version}"
    return
  fi

  echo "[deploy] 未检测到 npm，可能是 npm 未安装或 PATH 未生效"

  if ask_yes_no "[deploy] 是否现在查看 npm 安装引导？[Y/n]: " yes; then
    print_node_install_guide
  fi

  if ask_yes_no "[deploy] 完成安装或修复 PATH 后，是否立即重试 npm 检测？[Y/n]: " yes; then
    npm_version="$(get_npm_version || true)"
    if [[ -n "$npm_version" ]]; then
      echo "[deploy] npm 已就绪: ${npm_version}"
      return
    fi
  fi

  echo "[deploy] npm 未就绪，请安装后重试"
  exit 1
}

ensure_node_runtime
ensure_npm_runtime

BRIDGE_RUNTIME_PRECHECKED=1 node "$SCRIPT_DIR/deploy.mjs" "$@"
