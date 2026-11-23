// 輪 — 小さなサーバー（依存パッケージなし）
//   GET  /api/state  … 保存データを返す（まだ無ければ 204）
//   PUT  /api/state  … 保存データを丸ごと書き換える
//   それ以外          … public/ の静的ファイル
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 2 * 1024 * 1024; // 2MB

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function handleApi(req, res) {
  if (req.method === 'GET') {
    try { return send(res, 200, await fsp.readFile(DATA_FILE)); }
    catch (e) { return e.code === 'ENOENT' ? send(res, 204, '') : send(res, 500, '{"error":"read failed"}'); }
  }
  if (req.method === 'PUT') {
    let size = 0; const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) return send(res, 413, '{"error":"too large"}');
      chunks.push(c);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    try { const v = JSON.parse(text); if (typeof v !== 'object' || v === null) throw 0; }
    catch { return send(res, 400, '{"error":"invalid json"}'); }
    // 書きかけで壊れないよう、一時ファイルに書いてから置き換える
    const tmp = DATA_FILE + '.tmp';
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, DATA_FILE);
    return send(res, 200, '{"ok":true}');
  }
  res.setHeader('Allow', 'GET, PUT');
  return send(res, 405, '{"error":"method not allowed"}');
}

async function handleStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'bad request', 'text/plain'); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { send(res, 404, 'not found', 'text/plain'); }
}

http.createServer((req, res) => {
  const route = req.url.split('?')[0];
  if (route === '/healthz') return send(res, 200, '{"ok":true}');
  (route === '/api/state' ? handleApi : handleStatic)(req, res)
    .catch(err => { console.error(err); if (!res.headersSent) send(res, 500, '{"error":"internal"}'); });
}).listen(PORT, () => console.log(`輪: http://0.0.0.0:${PORT}  (data: ${DATA_FILE})`));
