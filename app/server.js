'use strict';
/**
 * cors-relay — tiny CORS front-end for feeds that refuse browser origins.
 *
 * GET /?url=<encoded absolute url>   -> upstream body, with Access-Control-Allow-Origin: *
 * GET /healthz                      -> "ok"
 *
 * Env:
 *   PORT           listen port (default 8787)
 *   ALLOW_HOSTS    comma-separated hostname suffix allowlist (empty = any public host)
 *   MAX_BYTES      response size cap (default 5000000)
 *   TIMEOUT_MS     upstream timeout (default 10000)
 */
const http = require('http');
const dns = require('dns').promises;
const net = require('net');

const PORT = Number(process.env.PORT || 8787);
const MAX_BYTES = Number(process.env.MAX_BYTES || 5000000);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 10000);
const ALLOW_HOSTS = String(process.env.ALLOW_HOSTS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
};

function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) return true;
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7));
    return false;
  }
  return true;
}

function hostAllowed(host) {
  if (!ALLOW_HOSTS.length) return true;
  const h = host.toLowerCase();
  return ALLOW_HOSTS.some(a => h === a || h.endsWith('.' + a));
}

async function targetIsPublic(host) {
  if (net.isIP(host)) return !isPrivateIp(host);
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); }
  catch (e) { return false; }
  return addrs.length > 0 && addrs.every(a => !isPrivateIp(a.address));
}

function fail(res, code, msg) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS));
  res.end(msg + '\n');
}

function targetFromRequest(reqUrl) {
  // Accept ?url=<encoded>, ?<encoded>, and /<absolute url>
  const qs = reqUrl.indexOf('?');
  if (qs !== -1) {
    const raw = reqUrl.slice(qs + 1);
    const params = new URLSearchParams(raw);
    const named = params.get('url') || params.get('q') || params.get('quest');
    if (named) return named;
    if (raw && raw.indexOf('=') === -1) return decodeURIComponent(raw);
  }
  const path = (qs === -1 ? reqUrl : reqUrl.slice(0, qs)).replace(/^\//, '');
  if (/^https?:\/\//i.test(path)) return decodeURIComponent(path);
  if (/^https?%3a/i.test(path)) return decodeURIComponent(path);
  return '';
}

async function relay(req, res) {
  const target = targetFromRequest(req.url || '/');
  if (!target) return fail(res, 400, 'usage: /?url=<encoded absolute url>');

  let u;
  try { u = new URL(target); } catch (e) { return fail(res, 400, 'malformed url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail(res, 400, 'only http(s)');
  if (!hostAllowed(u.hostname)) return fail(res, 403, 'host not in ALLOW_HOSTS');
  if (!(await targetIsPublic(u.hostname))) return fail(res, 403, 'target resolves to a private address');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(u.toString(), {
      redirect: 'follow',
      signal: ctl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
  } catch (e) {
    clearTimeout(timer);
    return fail(res, 502, 'upstream fetch failed: ' + (e && e.message ? e.message : e));
  }
  clearTimeout(timer);

  const buf = Buffer.from(await upstream.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (buf.length > MAX_BYTES) return fail(res, 502, 'upstream response too large');

  console.log(new Date().toISOString() + ' ' + (req.headers.origin || 'no-origin') +
    ' -> ' + u.hostname + u.pathname + ' ' + upstream.status + ' ' + buf.length + 'b');

  res.writeHead(upstream.status, Object.assign({
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Content-Length': String(buf.length),
    'Cache-Control': 'public, max-age=60',
    'X-Relay-Target': u.hostname
  }, CORS));
  res.end(buf);
}

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'GET only');
  if (path === '/healthz') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain' }, CORS));
    return res.end('ok\n');
  }
  relay(req, res).catch(e => fail(res, 500, 'relay error: ' + (e && e.message ? e.message : e)));
});

server.requestTimeout = TIMEOUT_MS + 5000;
server.headersTimeout = TIMEOUT_MS + 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('cors-relay listening on :' + PORT +
    (ALLOW_HOSTS.length ? ' allow=' + ALLOW_HOSTS.join(',') : ' allow=any public host'));
});
