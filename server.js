// 輪 — サーバー
//   GET  /api/state  … 保存データ（無ければ初期データ）
//   PUT  /api/state  … 画面からの保存。{ rev, state }。rev が古ければ 409 と最新データ
//   POST /mcp        … MCP（Streamable HTTP）。Claude が読み書きする入口
//   GET  /healthz    … 死活確認
//   それ以外          … public/ の静的ファイル
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { Store } = require('./store');
const { createMcpServer } = require('./mcp');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MCP_TOKEN = process.env.WA_MCP_TOKEN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 2 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const store = new Store(DATA_DIR);

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); }
  catch { throw Object.assign(new Error('invalid json'), { status: 400 }); }
}

async function handleApi(req, res) {
  if (req.method === 'GET') return send(res, 200, await store.read());
  if (req.method === 'PUT') {
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || !body.state || !Array.isArray(body.state.stats)) return send(res, 400, { error: 'invalid state' });
    const r = await store.replace(body.state, body.rev);
    return r.conflict ? send(res, 409, { error: 'conflict', state: r.state }) : send(res, 200, { ok: true, rev: r.rev });
  }
  res.setHeader('Allow', 'GET, PUT');
  return send(res, 405, { error: 'method not allowed' });
}

function tokenOk(req) {
  if (!MCP_TOKEN) return true;
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${MCP_TOKEN}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

async function handleMcp(req, res) {
  if (!tokenOk(req)) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') {
    // セッションを持たない（stateless）構成なので GET/DELETE は使わない
    res.setHeader('Allow', 'POST');
    return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  }
  const body = await readJson(req);
  const server = createMcpServer(store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
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
  const h = route === '/healthz' ? async () => send(res, 200, { ok: true })
    : route === '/api/state' ? handleApi
    : route === '/mcp' ? handleMcp
    : handleStatic;
  Promise.resolve(h(req, res)).catch(err => {
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'internal' });
  });
}).listen(PORT, () => {
  console.log(`輪: http://0.0.0.0:${PORT}  MCP: /mcp${MCP_TOKEN ? '（トークンあり）' : ''}  data: ${store.file}`);
});
