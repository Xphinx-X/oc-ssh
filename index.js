#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const cmd = args[0];

function usage() {
  console.log(`oc-ssh - SSH-like remote terminal (OpenChamber-style connection)

Usage:
  node index.js host [options]          Start host server
  node index.js connect <url> [options]  Connect as client
  node index.js qr <url>                Print QR for a URL

Host options:
  --port <n>          Port (default 4321)
  --host <addr>       Bind address (default 127.0.0.1)
  --lan               Bind 0.0.0.0 (LAN access)
  --password <pw>     Password (generated if omitted)
  --shell <path>      Shell to spawn (default $SHELL or /bin/bash)
  --cols <n>          Initial columns (default 80)
  --rows <n>          Initial rows (default 24)
  --tunnel            Expose via public tunnel (localtunnel) for VPN/remote access

Client options:
  --password <pw>     Password (prompted if needed)
  --no-raw            Do not put terminal in raw mode

Examples:
  node index.js host --lan --port 4321
  node index.js connect http://192.168.1.5:4321 --password secret
  node index.js connect ocssh://192.168.1.5:4321?password=secret
`);
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  usage();
  process.exit(0);
}

if (cmd === 'host') {
  require('./host.js')(args.slice(1));
} else if (cmd === 'connect') {
  require('./client-node.js')(args.slice(1));
} else if (cmd === 'qr') {
  const url = args[1];
  if (!url) { console.error('Usage: node index.js qr <url>'); process.exit(1); }
  const qrcode = require('qrcode-terminal');
  qrcode.generate(url, { small: true });
} else {
  console.error('Unknown command:', cmd);
  usage();
  process.exit(1);
}