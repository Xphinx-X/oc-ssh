#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

PORT="${PORT:-4321}"
PASSWORD="${PASSWORD:-}"
TUNNEL="${TUNNEL:-0}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Run ./install.sh or install Node.js first."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Dependencies missing. Running ./install.sh..."
  ./install.sh
fi

EXTRA=("$@")
HAS_PORT=false
HAS_PASSWORD=false
HAS_TUNNEL=false
for a in "${EXTRA[@]}"; do
  case "$a" in
    --port) HAS_PORT=true ;;
    --password) HAS_PASSWORD=true ;;
    --tunnel) HAS_TUNNEL=true ;;
  esac
done

ARGS=(--lan)
if [ "$HAS_PORT" = false ]; then
  ARGS+=(--port "$PORT")
fi
if [ "$HAS_PASSWORD" = false ] && [ -n "$PASSWORD" ]; then
  ARGS+=(--password "$PASSWORD")
fi
if [ "$HAS_TUNNEL" = false ] && [ "$TUNNEL" = "1" ]; then
  ARGS+=(--tunnel)
fi
ARGS+=("${EXTRA[@]}")

exec node index.js host "${ARGS[@]}"
EOF
chmod +x start.sh
echo done