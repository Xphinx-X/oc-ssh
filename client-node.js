const WebSocket = require('ws');
const readline = require('readline');

function parseArgs(argv) {
  const opts = { url: argv[0], password: null, raw: true };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--password') opts.password = argv[++i];
    else if (a === '--no-raw') opts.raw = false;
  }
  return opts;
}

function parseUrl(input) {
  // support ocssh://host:port?password=... and http(s)://...
  let u;
  try { u = new URL(input); } catch { u = new URL('http://' + input); }
  const host = u.hostname;
  const port = u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80);
  const password = u.searchParams.get('password');
  const wsProtocol = (u.protocol === 'https:' || u.protocol === 'wss:') ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${host}:${port}/ws`;
  return { host, port, password, wsUrl };
}

module.exports = function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.url) {
    console.error('Usage: node client-node.js <url> [--password <pw>]');
    process.exit(1);
  }
  const info = parseUrl(opts.url);
  const password = opts.password || info.password;

  const ws = new WebSocket(info.wsUrl);
  let authenticated = false;

  ws.on('open', () => {
    try { ws._socket.setNoDelay(true); } catch {}
    if (!password) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Password: ', (pw) => {
        rl.close();
        ws.send(JSON.stringify({ type: 'auth', password: pw }));
      });
    } else {
      ws.send(JSON.stringify({ type: 'auth', password }));
    }
  });

  ws.on('message', (data, isBinary) => {
    if (!authenticated) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { msg = null; }
      if (msg && msg.type === 'auth_ok') {
        authenticated = true;
        // raw mode
        if (opts.raw && process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.on('data', (chunk) => {
          ws.send(chunk, { binary: true });
        });
        // resize
        if (process.stdout.isTTY) {
          const { columns, rows } = process.stdout;
          ws.send(JSON.stringify({ type: 'resize', cols: columns, rows }));
          process.stdout.on('resize', () => {
            ws.send(JSON.stringify({ type: 'resize', cols: process.stdout.columns, rows: process.stdout.rows }));
          });
        }
        return;
      }
      if (msg && msg.type === 'auth_fail') {
        console.error('Authentication failed');
        process.exit(1);
      }
      if (msg && msg.type === 'error') {
        console.error('Server error:', msg.message);
      }
      return;
    }
    if (isBinary) {
      process.stdout.write(data);
    } else {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { msg = null; }
      if (msg && msg.type === 'exit') {
        process.exit(msg.code || 0);
      } else if (msg && msg.type === 'pong') {
      } else {
        // maybe text output
        process.stdout.write(data);
      }
    }
  });

  ws.on('close', () => {
    if (process.stdin.isTTY && opts.raw) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    process.exit(0);
  });
  ws.on('error', (e) => {
    console.error('WebSocket error:', e.message);
    process.exit(1);
  });
};
