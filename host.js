const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');
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

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let authenticated = false;
    let proc = null;
    let authTimer = setTimeout(() => {
      if (!authenticated) { try { ws.close(4001, 'auth timeout'); } catch {} }
    }, 15000);

    ws.on('message', (raw, isBinary) => {
      if (!authenticated) {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { msg = null; }
        if (msg && msg.type === 'auth' && msg.password === opts.password) {
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
            try { ws.send(data, { binary: true }); } catch {}
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

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (proc) try { proc.kill(); } catch {}
    });
    ws.on('error', () => {
      if (proc) try { proc.kill(); } catch {}
    });
  });

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
      console.log('Starting tunnel (localtunnel)...');
      const lt = spawn('npx', ['--yes', 'localtunnel', '--port', String(opts.port)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let printed = false;
      const handleData = (data) => {
        const text = data.toString();
        const m = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
        if (m && !printed) {
          printed = true;
          const publicUrl = m[0] + '?password=' + encodeURIComponent(opts.password);
          // convert to ocssh-style? keep https URL; client supports https
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
      lt.on('close', (code) => {
        console.log('Tunnel exited with code', code);
      });
      process.on('exit', () => { try { lt.kill(); } catch {} });
    }
  });
};
