'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_ORIGINS = ['*'];
const MAX_BODY = 2 * 1024 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
const MAX_TIMEOUT = 180_000;
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ...['index.html', 'styles.css', 'app.js', 'api-adapter.js', 'test-cases.js', 'demo-responses.js', 'result-renderer.js'].map(file =>
    [`/${file}`, [file, file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8']]),
]);
class RelayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function positiveLimit(value, fallback, name) {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`${name} 必须为正整数。`);
  return limit;
}

function normalizedIp(address) {
  if (!net.isIP(address)) return null;
  if (net.isIP(address) === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function configuredProxies(values = []) {
  const proxies = new net.BlockList();
  for (const value of values) {
    const parts = value.split('/');
    const address = normalizedIp(parts[0]);
    if (!address || parts.length > 2) throw new Error('MIT_TRUSTED_PROXIES 必须为 IP 或 CIDR。');
    const family = net.isIP(address) === 4 ? 'ipv4' : 'ipv6';
    if (parts.length === 1) proxies.addAddress(address, family);
    else {
      const prefix = Number(parts[1]);
      if (!/^\d+$/.test(parts[1]) || !Number.isInteger(prefix) || prefix > (family === 'ipv4' ? 32 : 128)) {
        throw new Error('MIT_TRUSTED_PROXIES 的 CIDR 前缀无效。');
      }
      proxies.addSubnet(address, prefix, family);
    }
  }
  return proxies;
}

function clientAddress(req, proxies) {
  const peer = normalizedIp(req.socket.remoteAddress);
  const trusted = address => proxies.check(address, net.isIP(address) === 4 ? 'ipv4' : 'ipv6');
  if (!trusted(peer)) return peer;
  const header = req.headers['x-forwarded-for'];
  if (header === undefined) return peer;
  if (typeof header !== 'string' || header.length > 4096) throw new RelayError(400, '代理客户端 IP 无效。');
  const chain = header.split(',').map(value => normalizedIp(value.trim()));
  if (chain.length > 32 || chain.some(address => !address)) throw new RelayError(400, '代理客户端 IP 无效。');
  // Walk from the socket peer toward the client. Never use entries beyond the
  // first untrusted hop, which could have been supplied by that client.
  let address = peer;
  for (let index = chain.length - 1; index >= 0 && trusted(address); index--) address = chain[index];
  return address;
}

function configuredOrigins(values) {
  return new Set(values.map(value => {
    if (value === '*') return value;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('MIT_ALLOWED_ORIGINS 只能包含 * 或 HTTPS 来源，例如 https://api.example.com。');
    }
    return url.origin;
  }));
}

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
]) blocked.addSubnet(address, prefix, 'ipv4');
const ipv6Global = new net.BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  blocked.addSubnet(address, prefix, 'ipv6');
}
function publicAddress(address) {
  const family = net.isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && ipv6Global.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

const fakeIpRange = new net.BlockList();
fakeIpRange.addSubnet('198.18.0.0', 15, 'ipv4');
function fakeIpAddress(address) {
  return net.isIP(address) === 4 && fakeIpRange.check(address, 'ipv4');
}

// Local proxy DNS can return a synthetic 198.18/15 address. Resolve the name
// independently over HTTPS, then apply the same public-IP checks and pinning.
// Never connect to the synthetic address or send credentials to the resolver.
async function resolvePublicDns(hostname, signal, fetchImpl = fetch) {
  const answers = await Promise.all(['A', 'AAAA'].map(async type => {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', type);
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/dns-json' }, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) throw new RelayError(502, '公共 DNS 查询失败。');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 65536) { await response.body.cancel().catch(() => {}); throw new RelayError(502, '公共 DNS 响应过大。'); }
      chunks.push(Buffer.from(chunk));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data.Status !== 0) throw new RelayError(502, '公共 DNS 无法解析 API 域名。');
    return (Array.isArray(data.Answer) ? data.Answer : [])
      .filter(item => item.type === (type === 'A' ? 1 : 28))
      .map(item => ({ address: item.data, family: type === 'A' ? 4 : 6 }));
  }));
  return answers.flat();
}

function validateEnvelope(data, allowedOrigins) {
  if (!data || typeof data !== 'object' || !['responses', 'messages'].includes(data.protocol)) {
    throw new RelayError(400, '请选择 Responses 或 Messages 协议。');
  }
  let url;
  try { url = new URL(data.endpoint); } catch { throw new RelayError(400, 'API 地址无效。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith(`/${data.protocol}`) || /%|\\/.test(url.pathname)) {
    throw new RelayError(400, '转发仅支持不含查询参数的 HTTPS 模型端点。');
  }
  if (!allowedOrigins.has('*') && !allowedOrigins.has(url.origin)) throw new RelayError(403, '此 API 域名尚未获准转发，请联系网站维护者添加允许的 API 来源。');
  if (typeof data.apiKey !== 'string' || !data.apiKey.trim() || data.apiKey.length > 4096 || /[\r\n]/.test(data.apiKey)) {
    throw new RelayError(400, 'API Key 为空或格式无效。');
  }
  const body = data.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.model !== 'string' || !body.model.trim()) {
    throw new RelayError(400, '请求缺少模型或内容。');
  }
  if (typeof body.stream !== 'boolean' || (data.protocol === 'responses' && body.store !== false)) {
    throw new RelayError(400, 'stream 必须为布尔值；Responses 还须设置 store:false。');
  }
  const input = data.protocol === 'messages' ? body.messages : body.input;
  if (!(typeof input === 'string' && input.trim()) && !(Array.isArray(input) && input.length)) {
    throw new RelayError(400, '请求内容不能为空。');
  }
  const timeoutMs = Number(data.timeoutMs ?? 30000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT) throw new RelayError(400, '请求超时上限为 180 秒。');
  return { url, protocol: data.protocol, apiKey: data.apiKey.trim(), body, timeoutMs };
}

// DNS is checked once and the validated address is pinned to the TLS connection.
// Redirects are never followed, and caller-supplied headers/cookies are ignored.
async function forwardUpstream(job, signal, dependencies = {}) {
  const lookup = dependencies.lookup || dns.lookup;
  const request = dependencies.request || https.request;
  const now = dependencies.now || Date.now;
  const started = now();
  let phase = '解析域名';
  const tlsCodes = new Set(['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE']);
  const knownCodes = new Set(['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
    'EPROTO', 'ENOTFOUND', 'EAI_AGAIN', 'INCOMPLETE_HTTP_RESPONSE', ...tlsCodes]);
  const failure = (status, code, message) => {
    const elapsedSeconds = Math.max(0, Math.round((now() - started) / 1000));
    const error = new RelayError(status, `${message}（${code}；${phase}；已用时 ${elapsedSeconds} 秒）`);
    Object.assign(error, { code, phase, elapsedSeconds });
    return error;
  };
  // Include only fixed error codes and our own phase/timing, never error.message,
  // headers, request bodies, or arbitrary codes supplied by an upstream library.
  const networkFailure = (error) => {
    if (signal.aborted) return failure(504, 'REQUEST_ABORTED', '上游请求超时或已取消。');
    const code = knownCodes.has(error?.code) ? error.code : 'NETWORK_ERROR';
    if (tlsCodes.has(code) || code === 'EPROTO') return failure(502, code, '上游 TLS 握手或证书校验失败，请检查供应商证书及本机网络。');
    if (['ECONNRESET', 'EPIPE', 'INCOMPLETE_HTTP_RESPONSE'].includes(code)) {
      return failure(502, code, '上游连接被中断，未收到完整模型回答，可单项重试。');
    }
    if (code === 'ETIMEDOUT') return failure(504, code, '上游网络连接超时，可单项重试。');
    return failure(502, code, '无法建立或维持上游连接，请检查网络及供应商服务状态。');
  };
  const hostname = job.url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
    if (!net.isIP(hostname) && addresses.length && addresses.every(item => fakeIpAddress(item.address))) {
      addresses = await (dependencies.resolvePublicDns || resolvePublicDns)(hostname, signal);
    }
  } catch (error) {
    if (signal.aborted) throw networkFailure(error);
    if (error instanceof RelayError) throw error;
    throw failure(502, ['ENOTFOUND', 'EAI_AGAIN'].includes(error?.code) ? error.code : 'DNS_ERROR', '无法解析 API 域名。');
  }
  if (signal.aborted) throw new RelayError(504, '上游请求超时或已取消。');
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {
    throw new RelayError(403, 'API 域名必须解析到公网地址，不能访问本机或内网。');
  }
  const pinned = addresses.find(item => item.family === 4) || addresses[0];
  const payload = JSON.stringify(job.body);
  const headers = { Accept: job.body.stream ? 'text/event-stream' : 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  if (job.protocol === 'responses') headers.Authorization = `Bearer ${job.apiKey}`;
  else { headers['x-api-key'] = job.apiKey; headers['anthropic-version'] = '2023-06-01'; }
  phase = '建立连接或 TLS 握手';
  return new Promise((resolve, reject) => {
    let stopped = false;
    const fail = error => { if (!stopped) { stopped = true; reject(error); } };
    const upstream = request(job.url, {
      method: 'POST', headers, agent: false, signal,
      lookup: (_name, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, response => {
      phase = '读取响应正文';
      const status = response.statusCode;
      if (status >= 300 && status < 400) {
        response.resume(); upstream.destroy();
        fail(new RelayError(502, 'API 返回重定向，请填写最终接口地址。')); return;
      }
      const streaming = job.body.stream && status >= 200 && status < 300;
      if (streaming) {
        if (!response.headers?.['content-type']?.toLowerCase().startsWith('text/event-stream') || !dependencies.streamStart || !dependencies.streamChunk) {
          fail(new RelayError(502, '上游未返回可转发的 SSE 流式响应，请确认供应商支持 stream:true。'));
          response.resume(); upstream.destroy(); return;
        }
        dependencies.streamStart(status);
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        if (stopped) return;
        size += chunk.length;
        if (size > MAX_RESPONSE) { fail(new RelayError(502, 'API 响应超过 8 MB 上限。')); upstream.destroy(); }
        else if (streaming) dependencies.streamChunk(chunk, response);
        else chunks.push(chunk);
      });
      response.on('aborted', () => fail(networkFailure({ code: 'ECONNRESET' })));
      response.on('error', error => fail(networkFailure(error)));
      response.on('close', () => {
        if (response.complete === false) fail(networkFailure({ code: 'INCOMPLETE_HTTP_RESPONSE' }));
      });
      response.on('end', () => {
        if (stopped) return;
        if (response.complete === false) { fail(networkFailure({ code: 'INCOMPLETE_HTTP_RESPONSE' })); return; }
        if (streaming) { stopped = true; resolve({ status, streamed: true }); return; }
        const raw = Buffer.concat(chunks).toString('utf8');
        try { JSON.parse(raw); }
        catch {
          if ([408, 504, 524].includes(status)) fail(failure(status, `HTTP_${status}`, '上游 API 或网关等待超时；本站延长等待不能恢复已断开的上游请求。'));
          else fail(failure(status >= 400 && status <= 599 ? status : 502, `HTTP_${status}`, `API 未返回有效 JSON（HTTP ${status}），请检查接口地址或供应商网关。`));
          return;
        }
        stopped = true; resolve({ status, raw });
      });
    });
    upstream.on('socket', socket => socket.once('secureConnect', () => { phase = '等待模型响应'; }));
    upstream.on('error', error => fail(networkFailure(error)));
    upstream.end(payload);
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RelayError(413, '请求超过 2 MB 上限。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RelayError(400, '请求必须是有效 JSON。'); }
}
function sendJson(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.end(`event: mit_relay_error\ndata: ${JSON.stringify(data)}\n\n`); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function createServer(options = {}) {
  const allowedOrigins = configuredOrigins(options.allowedOrigins || DEFAULT_ORIGINS);
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : null;
  const forward = options.forward || forwardUpstream;
  const maxConcurrent = positiveLimit(options.maxConcurrent, 30, 'MIT_MAX_CONCURRENT');
  const maxConcurrentPerIp = positiveLimit(options.maxConcurrentPerIp, 3, 'MIT_MAX_CONCURRENT_PER_IP');
  const requestsPerMinute = positiveLimit(options.requestsPerMinute, 30, 'MIT_REQUESTS_PER_MINUTE');
  const trustedProxies = configuredProxies(options.trustedProxies);
  const clients = new Map();
  let active = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let job;
    let envelope;
    let client;
    let admitted = false;
    let timer;
    let onClose;
    try {
      const localHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`, `[::1]:${server.address().port}`];
      if (!localHosts.includes(req.headers.host) && req.headers.host !== (publicOrigin && new URL(publicOrigin).host)) {
        throw new RelayError(403, '网站来源未配置。部署时请设置 PUBLIC_ORIGIN。');
      }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (pathname === '/api/health') { sendJson(res, 200, { ok: true, transport: 'server-relay' }); return; }
        const asset = ASSETS.get(pathname);
        if (!asset) throw new RelayError(404, '页面不存在。');
        const bytes = await fs.readFile(path.join(__dirname, asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1], 'Content-Security-Policy': "connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'" });
        res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      if (pathname !== '/api/model') throw new RelayError(404, '接口不存在。');
      if (req.method !== 'POST') throw new RelayError(405, '仅支持 POST。');
      const expectedOrigin = publicOrigin || `http://${req.headers.host}`;
      if (req.headers.origin !== expectedOrigin || req.headers['x-mit-request'] !== '1' ||
          req.headers['sec-fetch-site'] === 'cross-site') throw new RelayError(403, '请从本站页面发起请求。');
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new RelayError(415, '需要 application/json 请求。');
      if (Number(req.headers['content-length']) > MAX_BODY) throw new RelayError(413, '请求超过 2 MB 上限。');
      const now = Date.now();
      for (const [key, value] of clients) if (!value.active && value.until < now) clients.delete(key);
      const ip = clientAddress(req, trustedProxies);
      client = clients.get(ip);
      if (!client) {
        if (clients.size >= 1000) throw new RelayError(503, '服务繁忙，请稍后重试。');
        client = { count: 0, active: 0, until: now + 60000 }; clients.set(ip, client);
      }
      if (client.until < now) { client.count = 0; client.until = now + 60000; }
      if (active >= maxConcurrent || client.active >= maxConcurrentPerIp || client.count >= requestsPerMinute) {
        throw new RelayError(429, '请求过于频繁，请等待当前请求完成后重试。');
      }
      active++; client.active++; client.count++; admitted = true;
      envelope = await readJson(req);
      job = validateEnvelope(envelope, allowedOrigins);
      const controller = new AbortController();
      onClose = () => controller.abort();
      res.on('close', onClose);
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new RelayError(504, `本站等待上游超时（${job.timeoutMs / 1000} 秒上限）。`);
          error.code = 'RELAY_TIMEOUT';
          reject(error);
          controller.abort();
        }, job.timeoutMs);
      });
      const result = await Promise.race([forward(job, controller.signal, {
        streamStart: status => {
          res.writeHead(status, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
        },
        streamChunk: (chunk, response) => {
          if (res.destroyed || res.writableEnded) { controller.abort(); return; }
          if (!res.write(chunk)) {
            response.pause();
            res.once('drain', () => { if (!controller.signal.aborted) response.resume(); });
          }
        },
      }), deadline]);
      if (!res.destroyed && !res.writableEnded) {
        if (!result.streamed) res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(result.streamed ? undefined : result.raw);
      }
    } catch (error) {
      sendJson(res, error instanceof RelayError ? error.status : 500, {
        error: { message: error instanceof RelayError ? error.message : '转发服务暂时不可用。', type: 'relay_error',
          ...(error instanceof RelayError && error.code ? { code: error.code, phase: error.phase, elapsedSeconds: error.elapsedSeconds } : {}) },
      });
    } finally {
      clearTimeout(timer);
      if (onClose) res.off('close', onClose);
      if (admitted) { active--; client.active--; }
      if (job) job.apiKey = '';
      if (envelope) envelope.apiKey = '';
      // No request, response, credential, or exception logging.
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.timeout = MAX_TIMEOUT + 10000;
  return server;
}

if (require.main === module) {
  try {
    const server = createServer({
      allowedOrigins: process.env.MIT_ALLOWED_ORIGINS ? process.env.MIT_ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean) : DEFAULT_ORIGINS,
      publicOrigin: process.env.PUBLIC_ORIGIN,
      maxConcurrent: process.env.MIT_MAX_CONCURRENT,
      maxConcurrentPerIp: process.env.MIT_MAX_CONCURRENT_PER_IP,
      requestsPerMinute: process.env.MIT_REQUESTS_PER_MINUTE,
      trustedProxies: process.env.MIT_TRUSTED_PROXIES ? process.env.MIT_TRUSTED_PROXIES.split(',').map(value => value.trim()).filter(Boolean) : [],
    });
    const port = Number(process.env.PORT || 8080);
    const host = process.env.HOST || '127.0.0.1';
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已被占用，请设置其他 PORT。' : '服务启动失败，请检查配置。'); process.exitCode = 1; });
    server.listen(port, host, () => console.log(`MIT 已启动：http://${host}:${port}（Key 仅临时转发，不保存）`));
  } catch { console.error('服务配置无效，请检查来源、端口、并发额度和可信代理配置。'); process.exitCode = 1; }
}
module.exports = { createServer, forwardUpstream, resolvePublicDns, publicAddress, validateEnvelope, configuredOrigins, RelayError, DEFAULT_ORIGINS };
