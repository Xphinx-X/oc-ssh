#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ -z "$1" ]; then
  echo "Usage: ./connect.sh <ip-or-url> [password]"
  echo "Examples:"
  echo "  ./connect.sh 192.168.1.5:4321"
  echo "  ./connect.sh 192.168.1.5:4321 my-password"
  echo "  ./connect.sh 'https://your-tunnel.trycloudflare.com?password=secret'"
  exit 1
fi

INPUT="$1"
PASSWORD="${2:-}"

# Allow bare IP/host (default port 4321)
if [[ "$INPUT" != *"://"* ]]; then
  if [[ "$INPUT" != *":"* ]]; then
    INPUT="${INPUT}:4321"
  fi
  INPUT="http://${INPUT}"
fi

if [ -n "$PASSWORD" ]; then
  exec python3 client-termux.py "$INPUT" --password "$PASSWORD"
else
  exec python3 client-termux.py "$INPUT"
fi
EOF
chmod +x connect.sh
echo done