#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18+ first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required."
  exit 1
fi

echo "Installing dependencies..."
npm install

# Optional: download cloudflared for reliable VPN/remote tunnels (Linux x86_64)
if ! command -v cloudflared >/dev/null 2>&1 && [ ! -x "./bin/cloudflared" ]; then
  if [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ]; then
    echo "Downloading cloudflared (for --tunnel support)..."
    mkdir -p bin
    if curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o bin/cloudflared; then
      chmod +x bin/cloudflared
      echo "cloudflared installed to ./bin/cloudflared"
    else
      echo "Warning: cloudflared download failed; --tunnel will fall back to localtunnel."
    fi
  fi
fi

chmod +x start.sh index.js client-termux.py 2>/dev/null || true

echo ""
echo "Installation complete."
echo "Start the host with: ./start.sh"
echo "For VPN/remote access: ./start.sh --tunnel"