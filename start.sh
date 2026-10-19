#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Dependencies not installed. Run ./install.sh first."
  exit 1
fi

exec node index.js host --lan "$@"
