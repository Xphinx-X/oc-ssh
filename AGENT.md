# AGENT.md

Guidance for AI agents working in this repository.

## Project overview

`oc-ssh` is a lightweight SSH replacement. A host process spawns a PTY shell and
exposes it over a WebSocket with password authentication. Clients (Termux/Node)
connect via URL or QR code.

## Repository structure

- `index.js` – CLI entry point (`host`, `connect`, `qr`)
- `host.js` – PTY-over-WebSocket server
- `client-termux.py` – Python client (stdlib only, Termux-friendly)
- `client-node.js` – Node.js client
- `install.sh` – installs npm deps and optional cloudflared
- `start.sh` – starts host in LAN mode
- `package.json` – Node dependencies
- `README.md` – user documentation

## Key conventions

- Keep the host and clients dependency-light.
- Terminal I/O uses **binary** WebSocket frames after authentication.
- Control messages (auth, resize, ping) use JSON text frames.
- Passwords must never be logged in committed code or docs.
- Avoid personal IPs/paths in committed files.

## Running locally

```bash
./install.sh
./start.sh            # LAN mode
./start.sh --tunnel   # public tunnel
```

## Testing

Manual end-to-end:

```bash
# host
node index.js host --port 4399 --password testpw --shell /bin/bash

# client
python3 client-termux.py 'ocssh://127.0.0.1:4399?password=testpw'
```

## Agent tasks

When modifying:
- Preserve binary-frame I/O path for performance.
- Keep `client-termux.py` stdlib-only.
- Update README.md and AGENT.md for user-facing changes.
- Sync changes to the GitHub repo (`Xphinx-X/oc-ssh`) and push.

## Safety

- Do not commit secrets, IPs, or local paths.
- Treat `node_modules/` and `openchamber-main/` as generated/vendored; do not commit.
EOF
echo done