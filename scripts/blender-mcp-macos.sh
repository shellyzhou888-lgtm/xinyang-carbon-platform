#!/bin/bash
# Project-local GUI bootstrap and official MCP client; no offline modeling.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOL_ROOT="$PROJECT_ROOT/storage/tooling/blender-mcp"
UV_ROOT="$TOOL_ROOT/runtime/uv-aarch64-apple-darwin"
export UV_CACHE_DIR="$TOOL_ROOT/uv-cache"
export UV_PYTHON_INSTALL_DIR="$TOOL_ROOT/python"
export UV_TOOL_DIR="$TOOL_ROOT/uv-tools"
export DISABLE_TELEMETRY=true
export BLENDER_MCP_SAFE_MODE=true
export BLENDER_HOST=127.0.0.1
export BLENDER_PORT=9876
export BLENDERMCP_ADDONS_DIR="$TOOL_ROOT/blender-user/scripts/addons"

case "${1:-help}" in
  start)
    BLENDER_BIN="$TOOL_ROOT/runtime/Blender.app/Contents/MacOS/Blender"
    ADDON_FILE="$TOOL_ROOT/blender-user/scripts/addons/blender_mcp.py"
    if [ ! -x "$BLENDER_BIN" ] || [ ! -f "$ADDON_FILE" ]; then
      echo 'Missing local Blender or MCP addon; see docs/blender-macos-session.md.' >&2
      exit 1
    fi
    if lsof -nP -iTCP:9876 -sTCP:LISTEN >/dev/null 2>&1; then
      echo 'Port 9876 is already in use. Verify the existing MCP session before opening another Blender.'
      exit 0
    fi
    export BLENDER_USER_CONFIG="$TOOL_ROOT/blender-user/config"
    export BLENDER_USER_SCRIPTS="$TOOL_ROOT/blender-user/scripts"
    mkdir -p "$BLENDER_USER_CONFIG" "$TOOL_ROOT/logs"
    SESSION_LOG="$TOOL_ROOT/logs/blender-$(date +%Y%m%d-%H%M%S)-$$.log"
    open -n -a "$TOOL_ROOT/runtime/Blender.app" \
      --env "BLENDER_USER_CONFIG=$BLENDER_USER_CONFIG" \
      --env "BLENDER_USER_SCRIPTS=$BLENDER_USER_SCRIPTS" \
      --env DISABLE_TELEMETRY=true --env BLENDER_MCP_SAFE_MODE=true \
      --stdout "$SESSION_LOG" --stderr "$SESSION_LOG" \
      --args --disable-autoexec --python "$PROJECT_ROOT/scripts/blender-mcp-bootstrap.py"
    echo "Blender GUI launch requested. Verify MCP readiness with a separate call. Log: $SESSION_LOG"
    ;;
  call)
    shift
    if [ ! -x "$UV_ROOT/uv" ] || [ ! -x "$UV_ROOT/uvx" ]; then
      echo 'Missing local uv; see docs/blender-macos-session.md.' >&2
      exit 1
    fi
    exec "$UV_ROOT/uv" run --python 3.11 --with 'mcp<2' python \
      "$PROJECT_ROOT/scripts/blender-mcp-client.py" --uvx "$UV_ROOT/uvx" "$@"
    ;;
  *)
    echo 'Usage: bash scripts/blender-mcp-macos.sh start'
    echo '       bash scripts/blender-mcp-macos.sh call --label NAME [MCP client arguments]'
    ;;
esac
