# oc-ssh: SSH-like remote terminal (OpenChamber-style connection)

## Quick start

```bash
git clone https://github.com/Xphinx-X/oc-ssh.git
cd oc-ssh
./install.sh
./start.sh
```

`./start.sh` binds to LAN on port 4321 by default. Override:
```bash
./start.sh --port 8080 --password 'my-secret'
```

### Remote / VPN access
If your machine is on a VPN or you need access from outside the LAN:
```bash
./start.sh --tunnel
```
This creates a public URL (via localtunnel) and prints a new QR code. Connect with that URL.

A lightweight SSH replacement. The host spawns a real PTY shell and exposes it
over a WebSocket with password authentication. Connection is shared via a URL and
QR code, like OpenChamber's `connect-url`.

## Host (this machine)

```bash
# LAN access (Termux on same network)
node index.js host --lan --port 4321

# custom password
node index.js host --lan --port 4321 --password 'my-secret'

# loopback only
node index.js host --port 4321
```

It prints a connection URL, password, and QR code.

## Client from Termux (proot)

Copy `client-termux.py` into Termux, then:

```bash
python3 client-termux.py 'ocssh://HOST_IP:4321?password=SECRET'
# or
python3 client-termux.py http://HOST_IP:4321 --password SECRET
```

If Python is unavailable in proot, use the Node client:

```bash
node index.js connect 'ocssh://HOST_IP:4321?password=SECRET'
```

## Termux setup (first time)

```bash
pkg update && pkg install python  # or: pkg install nodejs
# copy client-termux.py to Termux, e.g. via scp-like or paste
chmod +x client-termux.py
```

## Notes
- Requires host and Termux on a reachable network (same LAN, VPN, or tunnel).
- For internet access, run a tunnel (cloudflared/ngrok) in front of the host port.
- Password is sent during the WebSocket handshake; use a tunnel with TLS for untrusted networks.
