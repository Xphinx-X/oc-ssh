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

chmod +x start.sh index.js client-termux.py 2>/dev/null || true

echo ""
echo "Installation complete."
echo "Start the host with: ./start.sh"
echo "Then connect from Termux with client-termux.py"
