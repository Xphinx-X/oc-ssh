# oc-ssh

SSH-like remote terminal with OpenChamber-style connection (QR code, URL input, password).

`oc-ssh` runs a PTY shell on the host machine and exposes it over a WebSocket with
password authentication. A client (Termux, or any terminal) connects using a URL or
QR code—similar to OpenChamber's `connect-url`.

## Features

- Real PTY shell (bash/fish/etc.) over WebSocket
- Password authentication
- QR code + connection URL generation (uses `qrcode-terminal`)
- Works on LAN and through VPNs (Cloudflare quick tunnel)
- Termux-friendly Python client (stdlib only)
- Node.js client alternative
- Keepalive pings to avoid idle disconnects
- Low-latency binary I/O frames

## Quick start

```bash
git clone https://github.com/Xphinx-X/oc-ssh.git
cd oc-ssh
./install.sh
./start.sh
```

`./start.sh` binds to LAN on port `4321` by default.

Override options:

```bash
./start.sh --port 8080 --password 'my-secret'
```

## VPN / remote access

If the host is on a VPN or you need access from outside the LAN:

```bash
./start.sh --tunnel
```

This starts a Cloudflare quick tunnel and prints a public URL + QR code. Connect with that URL.

## Client: Termux (proot)

Copy `client-termux.py` (and optionally `connect.sh`) to Termux and run:

```bash
# Easy (uses ./connect.sh)
./connect.sh 192.168.1.5:4321
./connect.sh 192.168.1.5:4321 my-password
./connect.sh 'https://your-tunnel.trycloudflare.com?password=SECRET'

# Or directly
python3 client-termux.py 'ocssh://HOST_IP:4321?password=SECRET'
python3 client-termux.py 'https://your-tunnel.trycloudflare.com?password=SECRET'
```

Requirements in Termux:

```bash
pkg install python   # Termux
# or in proot:
apt install -y python3
```

## Client: Node.js

```bash
node index.js connect 'ocssh://HOST_IP:4321?password=SECRET'
```

## Host options

| Option | Description | Default |
|---|---|---|
| `--port <n>` | Listen port | `4321` |
| `--host <addr>` | Bind address | `127.0.0.1` |
| `--lan` | Bind to `0.0.0.0` (LAN access) | off |
| `--password <pw>` | Password (generated if omitted) | random |
| `--shell <path>` | Shell to spawn | `$SHELL` or `/bin/bash` |
| `--cols <n>` | Initial columns | `80` |
| `--rows <n>` | Initial rows | `24` |
| `--tunnel` | Expose via Cloudflare quick tunnel | off |

## Architecture

```
Host (node-pty)  <-->  WebSocket  <-->  Client (Termux/Node)
        |                                    |
   PTY shell                         raw terminal mode
```

- Authentication happens first via a JSON `auth` message.
- After auth, input/output are sent as **binary** WebSocket frames.
- Resize and ping use small JSON control messages.
- Keepalive pings every 5 seconds prevent idle disconnects.
- Automatic reconnect with exponential backoff on connection loss.

## Troubleshooting

### Connection timeout
- Ensure host and client are on the same network, or use `--tunnel`.
- Check host firewall allows the port.
- Verify the IP: `hostname -I` on the host.

### Idle disconnects
- Keep typing or run a long-lived command (`top`, `tail -f`).
- Ensure you are using the latest `client-termux.py`.

### node-pty build issues
- `./install.sh` installs dependencies. On some systems, allow install scripts:
  ```bash
  npm install-scripts approve node-pty
  npm install
  ```

### Tunnel URL changed
- Quick tunnel URLs are ephemeral. Re-run `./start.sh --tunnel` and use the new URL.

## Performance tips

- Prefer LAN over tunnel for lowest latency.
- Use binary frames (enabled by default) for keystrokes.
- Avoid flooding the terminal with huge output while typing.
- `TCP_NODELAY` and `TCP_QUICKACK` are enabled on both sides.

## Security notes

- Password is sent during the WebSocket handshake. Use a tunnel with TLS for untrusted networks.
- For production, consider adding TLS and stronger auth.