#!/usr/bin/env python3
import os
import sys
import time
import socket
import ssl
import json
import struct
import base64
import threading
import termios
import tty
import signal
import getpass

def parse_url(input_url):
    s = input_url.strip()
    if '://' not in s:
        s = 'http://' + s
    # normalize ocssh -> http
    s = s.replace('ocssh://', 'http://').replace('ocsshs://', 'https://')
    from urllib.parse import urlparse, parse_qs
    u = urlparse(s)
    host = u.hostname
    port = u.port
    if port is None:
        port = 443 if u.scheme in ('https', 'wss') else 80
    qs = parse_qs(u.query)
    password = qs.get('password', [None])[0]
    secure = u.scheme in ('https', 'wss')
    return host, port, password, secure

def ws_connect(host, port, secure=False):
    sock = socket.create_connection((host, port), timeout=10)
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except Exception:
        pass
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_QUICKACK, 1)
    except Exception:
        pass
    if secure:
        ctx = ssl.create_default_context()
        sock = ctx.wrap_socket(sock, server_hostname=host)
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_QUICKACK, 1)
        except Exception:
            pass
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET /ws HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    )
    sock.sendall(req.encode())
    # read response headers
    buf = b''
    while b'\r\n\r\n' not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionError('connection closed during handshake')
        buf += chunk
    header, _, rest = buf.partition(b'\r\n\r\n')
    status_line = header.split(b'\r\n', 1)[0].decode()
    if '101' not in status_line:
        raise ConnectionError('WebSocket handshake failed: ' + status_line)
    return sock, rest

def send_frame(sock, payload_bytes, opcode=0x1, mask=True):
    # client frames must be masked
    b1 = 0x80 | (opcode & 0x0f)
    length = len(payload_bytes)
    header = bytes([b1])
    if length < 126:
        header += bytes([0x80 | length]) if mask else bytes([length])
    elif length < 65536:
        header += (bytes([0x80 | 126]) if mask else bytes([126])) + struct.pack('!H', length)
    else:
        header += (bytes([0x80 | 127]) if mask else bytes([127])) + struct.pack('!Q', length)
    if mask:
        masking_key = os.urandom(4)
        header += masking_key
        masked = bytes(b ^ masking_key[i % 4] for i, b in enumerate(payload_bytes))
        sock.sendall(header + masked)
    else:
        sock.sendall(header + payload_bytes)

def send_text(sock, text):
    send_frame(sock, text.encode('utf-8'), opcode=0x1)

def recv_exact(sock, n, buf_holder):
    # buf_holder: list with leftover bytes
    data = buf_holder[0]
    while len(data) < n:
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionError('connection closed')
        data += chunk
    result = data[:n]
    buf_holder[0] = data[n:]
    return result

def recv_frame(sock, buf_holder):
    # returns (opcode, payload_bytes)
    h = recv_exact(sock, 2, buf_holder)
    b1, b2 = h[0], h[1]
    fin = b1 & 0x80
    opcode = b1 & 0x0f
    masked = bool(b2 & 0x80)
    length = b2 & 0x7f
    if length == 126:
        (length,) = struct.unpack('!H', recv_exact(sock, 2, buf_holder))
    elif length == 127:
        (length,) = struct.unpack('!Q', recv_exact(sock, 8, buf_holder))
    mask_key = None
    if masked:
        mask_key = recv_exact(sock, 4, buf_holder)
    payload = recv_exact(sock, length, buf_holder)
    if masked and mask_key:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return opcode, payload

def main():
    if len(sys.argv) < 2:
        print('Usage: python3 client-termux.py <url> [--password <pw>]', file=sys.stderr)
        sys.exit(1)
    url = sys.argv[1]
    password = None
    if '--password' in sys.argv:
        idx = sys.argv.index('--password')
        password = sys.argv[idx+1]
    host, port, url_pw, secure = parse_url(url)
    if password is None:
        password = url_pw
    if password is None:
        password = getpass.getpass('Password: ')

    sock, leftover = ws_connect(host, port, secure)
    buf_holder = [leftover]

    # auth
    send_text(sock, json.dumps({'type': 'auth', 'password': password}))

    # wait for auth_ok
    authenticated = False
    while not authenticated:
        opcode, payload = recv_frame(sock, buf_holder)
        if opcode == 0x8:  # close
            print('Connection closed', file=sys.stderr)
            sys.exit(1)
        if opcode == 0x1:
            try:
                msg = json.loads(payload.decode('utf-8'))
            except Exception:
                msg = None
            if msg and msg.get('type') == 'auth_ok':
                authenticated = True
            elif msg and msg.get('type') == 'auth_fail':
                print('Authentication failed', file=sys.stderr)
                sys.exit(1)
            elif msg and msg.get('type') == 'error':
                print('Server error:', msg.get('message'), file=sys.stderr)
                sys.exit(1)

    # terminal raw mode
    is_tty = sys.stdin.isatty()
    old_settings = None
    if is_tty:
        fd = sys.stdin.fileno()
        old_settings = termios.tcgetattr(fd)
        tty.setraw(fd)

    def restore():
        if is_tty and old_settings is not None:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, old_settings)

    # send initial resize
    try:
        if is_tty:
            size = os.get_terminal_size(sys.stdout.fileno())
            send_text(sock, json.dumps({'type': 'resize', 'cols': size.columns, 'rows': size.lines}))
    except Exception:
        pass

    # stdin thread
    stop = threading.Event()
    def stdin_loop():
        try:
            while not stop.is_set():
                data = os.read(sys.stdin.fileno(), 4096)
                if not data:
                    break
                send_frame(sock, data, opcode=0x2)
        except Exception:
            pass
        finally:
            stop.set()

    t = threading.Thread(target=stdin_loop, daemon=True)
    t.start()

    # keepalive to prevent tunnel/proxy idle timeouts
    def keepalive_loop():
        while not stop.is_set():
            time.sleep(5)
            if stop.is_set():
                break
            try:
                send_text(sock, json.dumps({'type': 'ping'}))
            except Exception:
                break
    ka = threading.Thread(target=keepalive_loop, daemon=True)
    ka.start()

    # handle SIGWINCH
    def on_winch(signum, frame):
        try:
            size = os.get_terminal_size(sys.stdout.fileno())
            send_text(sock, json.dumps({'type': 'resize', 'cols': size.columns, 'rows': size.lines}))
        except Exception:
            pass
    try:
        signal.signal(signal.SIGWINCH, on_winch)
    except Exception:
        pass

    try:
        while True:
            opcode, payload = recv_frame(sock, buf_holder)
            if opcode == 0x8:
                break
            if opcode == 0x9:  # ping
                send_frame(sock, payload, opcode=0xA)  # pong
                continue
            if opcode == 0x1:
                try:
                    msg = json.loads(payload.decode('utf-8'))
                except Exception:
                    msg = None
                if msg and msg.get('type') == 'exit':
                    break
                if msg and msg.get('type') == 'pong':
                    continue
                # if JSON message not output, maybe write raw
                if msg and 'data' in msg and msg.get('type') == 'output':
                    sys.stdout.buffer.write(msg['data'].encode('utf-8'))
                    sys.stdout.buffer.flush()
                    continue
                # fallback: write payload as text
                sys.stdout.buffer.write(payload)
                sys.stdout.buffer.flush()
            elif opcode == 0x2:  # binary
                sys.stdout.buffer.write(payload)
                sys.stdout.buffer.flush()
    except (ConnectionError, OSError):
        pass
    finally:
        stop.set()
        restore()
        try:
            sock.close()
        except Exception:
            pass

if __name__ == '__main__':
    main()
