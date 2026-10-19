const WebSocket = require('ws');

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
  let u;
  try { u = new URL(input); } catch { u = new URL('http://' + input); }
  const host = u.hostname;
  const port = u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80);
  const password = u.searchParams.get('password');
  const wsProtocol = (u.protocol === 'https:' || u.protocol === 'wss:') ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${host}:${port}/ws`;
  return { host, port, password, wsUrl };
}

function connectOnce(opts, info) {
  return new Promise((resolve) => {
    const password = opts.password || info.password;
    const ws = new WebSocket(info.wsUrl, { perMessageDeflate: false });
    let authenticated = false;
    let cleanExit = false;
    let settled = false;

    const finish = (reconnect) => {
      if (settled) return;
      settled = true;
      try { if (process.stdin.isTTY && opts.raw) process.stdin.setRawMode(false); } catch {}
      resolve(reconnect);
    };

    ws.on('open', () => {
      try { ws._socket.setNoDelay(true); } catch {}
      if (!password) {
        const readline = require('readline');
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
          if (opts.raw && process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          process.stdin.resume();
          process.stdin.on('data', (chunk) => {
            ws.send(chunk, { binary: true });
          });
          if (process.stdout.isTTY) {
            const { columns, rows } = process.stdout;
            ws.send(JSON.stringify({ type: 'resize', cols: columns, rows }));
            process.stdout.on('resize', () => {
              ws.send(JSON.stringify({ type: 'resize', cols: process.stdout.columns, rows: process.stdout.rows }));
            });
          }
          setInterval(() => {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
          }, 5000);
        } else if (msg && msg.type === 'auth_fail') {
          console.error('Authentication failed');
          ws.close();
        } else if (msg && msg.type === 'error') {
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
          cleanExit = true;
          ws.close();
        } else if (msg && msg.type === 'pong') {
        } else {
          process.stdout.write(data);
        }
      }
    });

    ws.on('close', () => {
      try { if (process.stdin.isTTY && opts.raw) process.stdin.setRawMode(false); } catch {}
      finish(!cleanExit);
    });
    ws.on('error', (e) => {
      console.error('WebSocket error:', e.message);
    });
  });
}

module.exports = async function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.url) {
    console.error('Usage: node client-node.js <url> [--password <pw>]');
    process.exit(1);
  }
  const info = parseUrl(opts.url);

  let retries = 0;
  while (true) {
    const reconnect = await connectOnce(opts, info);
    if (!reconnect) break;
    retries++;
    if (retries > 20) {
      console.error('Too many retries, giving up');
      break;
    }
    const delay = Math.min(2 ** retries, 10) * 1000;
    console.error(`\n[oc-ssh] connection lost, reconnecting in ${delay / 1000}s...`);
    await new Promise((r) => setTimeout(r, delay));
  }
};
