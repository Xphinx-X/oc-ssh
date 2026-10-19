const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');

const MAX_SESSIONS = 20;
const sessions = new Set();

function safeEqual(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

function parseArgs(argv) {
  const opts = { port: 4321, host: '127.0.0.1', lan: false, password: null, shell: process.env.SHELL || '/bin/bash', cols: 80, rows: 24, tunnel: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') opts.port = parseInt(argv[++i], 10);
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '--lan') opts.lan = true;
    else if (a === '--password') opts.password = argv[++i];
    else if (a === '--shell') opts.shell = argv[++i];
    else if (a === '--cols') opts.cols = parseInt(argv[++i], 10);
    else if (a === '--rows') opts.rows = parseInt(argv[++i], 10);
    else if (a === '--tunnel') opts.tunnel = true;
  }
  if (opts.lan) opts.host = '0.0.0.0';
  if (!opts.password) opts.password = crypto.randomBytes(12).toString('base64url');
  return opts;
}

function detectLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

function makeConnectionUrl(host, port, password) {
  return `ocssh://${host}:${port}?password=${encodeURIComponent(password)}`;
}

module.exports = function main(argv) {
  const opts = parseArgs(argv);
  const bindHost = opts.host;
  const advertiseHost = (bindHost === '0.0.0.0') ? (detectLanIp() || '127.0.0.1') : bindHost;

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('oc-ssh host running\n');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });

  wss.on('connection', (ws, req) => {
    try { if (ws._socket) { ws._socket.setNoDelay(true); ws._socket.setKeepAlive(true, 10000); } } catch {}
    if (sessions.size >= MAX_SESSIONS) {
      try { ws.close(4008, 'too many sessions'); } catch {}
      return;
    }
    sessions.add(ws);
    let authenticated = false;
    let proc = null;
    let lastPong = Date.now();
    ws.on('pong', () => { lastPong = Date.now(); });
    let authTimer = setTimeout(() => {
      if (!authenticated) { try { ws.close(4001, 'auth timeout'); } catch {} }
    }, 15000);

    ws.on('message', (raw, isBinary) => {
      if (!authenticated) {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { msg = null; }
        if (msg && msg.type === 'auth' && safeEqual(msg.password, opts.password)) {
          authenticated = true;
          clearTimeout(authTimer);
          ws.send(JSON.stringify({ type: 'auth_ok' }));
          // spawn shell
          try {
            proc = pty.spawn(opts.shell, [], {
              name: 'xterm-256color',
              cols: opts.cols,
              rows: opts.rows,
              cwd: process.env.HOME || '/',
              env: process.env,
            });
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: String(e) }));
            ws.close();
            return;
          }
          proc.onData((data) => {
            try { ws.send(data, { binary: true, compress: false }); } catch {}
          });
          proc.onExit(({ exitCode }) => {
            try { ws.send(JSON.stringify({ type: 'exit', code: exitCode })); } catch {}
            try { ws.close(); } catch {}
          });
        } else {
          ws.send(JSON.stringify({ type: 'auth_fail' }));
          try { ws.close(4003, 'auth failed'); } catch {}
        }
        return;
      }

      // authenticated
      if (isBinary) {
        if (proc) try { proc.write(raw.toString('utf8')); } catch {}
        return;
      }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { msg = null; }
      if (!msg) return;
      if (msg.type === 'input' && typeof msg.data === 'string') {
        if (proc) try { proc.write(msg.data); } catch {}
      } else if (msg.type === 'resize') {
        if (proc && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
          try { proc.resize(msg.cols, msg.rows); } catch {}
        }
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });

    const pingInterval = setInterval(() => {
      if (Date.now() - lastPong > 60000) {
        try { ws.close(4000, 'pong timeout'); } catch {}
      } else {
        try { ws.ping(); } catch {}
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(pingInterval);
      clearTimeout(authTimer);
      sessions.delete(ws);
      if (proc) try { proc.kill(); } catch {}
    });
    ws.on('error', () => {
      clearInterval(pingInterval);
      if (proc) try { proc.kill(); } catch {}
    });
  });

  const shutdown = () => {
    for (const ws of sessions) { try { ws.close(1001, 'server shutdown'); } catch {} }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(opts.port, bindHost, () => {
    const url = makeConnectionUrl(advertiseHost, opts.port, opts.password);
    console.log('oc-ssh host started');
    console.log('Bind:', bindHost, 'Port:', opts.port);
    console.log('Shell:', opts.shell);
    console.log('Password:', opts.password);
    console.log('Connection URL:', url);
    console.log('');
    try {
      const qrcode = require('qrcode-terminal');
      console.log('QR code (scan with client):');
      qrcode.generate(url, { small: true });
      console.log('');
    } catch (e) {
      console.warn('QR generation failed:', e.message);
    }
    console.log('Connect from Termux:');
    console.log(`  python3 client-termux.py ${url}`);
    console.log('or');
    console.log(`  node index.js connect ${url}`);

    if (opts.tunnel) {
      console.log('');
      const path = require('path');
      const fs = require('fs');
      const localCf = path.join(process.cwd(), 'bin', 'cloudflared');
      const cfBin = fs.existsSync(localCf) ? localCf : (require('child_process').execSync('command -v cloudflared || true').toString().trim() || null);
      if (cfBin) {
        console.log('Starting tunnel (cloudflared)...');
        const cf = spawn(cfBin, ['tunnel', '--url', `http://localhost:${opts.port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
        let printed = false;
        const handleData = (data) => {
          const text = data.toString();
          const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
          if (m && !printed) {
            printed = true;
            const connUrl = m[0] + '?password=' + encodeURIComponent(opts.password);
            console.log('Tunnel URL:', connUrl);
            try {
              const qrcode = require('qrcode-terminal');
              console.log('Tunnel QR code:');
              qrcode.generate(connUrl, { small: true });
              console.log('');
            } catch {}
            console.log('Connect via tunnel:');
            console.log(`  python3 client-termux.py ${connUrl}`);
          }
        };
        cf.stdout.on('data', handleData);
        cf.stderr.on('data', handleData);
        cf.on('close', (code) => { console.log('Tunnel exited with code', code); });
        process.on('exit', () => { try { cf.kill(); } catch {} });
      } else {
        console.log('Starting tunnel (localtunnel)...');
        const lt = spawn('npx', ['--yes', 'localtunnel', '--port', String(opts.port)], { stdio: ['ignore', 'pipe', 'pipe'] });
        let printed = false;
        const handleData = (data) => {
          const text = data.toString();
          const m = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
          if (m && !printed) {
            printed = true;
            const connUrl = m[0] + '?password=' + encodeURIComponent(opts.password);
            console.log('Tunnel URL:', connUrl);
            try {
              const qrcode = require('qrcode-terminal');
              console.log('Tunnel QR code:');
              qrcode.generate(connUrl, { small: true });
              console.log('');
            } catch {}
            console.log('Connect via tunnel:');
            console.log(`  python3 client-termux.py ${connUrl}`);
          }
        };
        lt.stdout.on('data', handleData);
        lt.stderr.on('data', handleData);
        lt.on('close', (code) => { console.log('Tunnel exited with code', code); });
        process.on('exit', () => { try { lt.kill(); } catch {} });
      }
    }
  });
};
