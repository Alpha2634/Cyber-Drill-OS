'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const game = require('./lib/game');
const { HttpError, token } = require('./lib/util');
const { ROUND_MS, MAX_HINTS, HINT_PENALTY } = require('./lib/scoring');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function createApp(opts = {}) {
  const store = new Store(opts.dataFile === undefined ? path.join(__dirname, 'data', 'db.json') : opts.dataFile);
  const now = opts.now || Date.now;
  const publicDir = opts.publicDir || path.join(__dirname, 'public');
  const log = opts.silent ? () => {} : (...a) => console.log(...a);
  const aiOpts = {
    complete: opts.aiComplete,
    apiKey: opts.aiComplete ? undefined : process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL || 'claude-haiku-5-5',
    timeoutMs: 5000,
    log,
  };

  // naive per-IP rate limiter
  const hits = new Map();
  const RATE = opts.rateLimit || 240; // requests / minute
  function limited(ip) {
    const t = now();
    const h = hits.get(ip) || { start: t, n: 0 };
    if (t - h.start > 60_000) { h.start = t; h.n = 0; }
    h.n += 1; hits.set(ip, h);
    return h.n > RATE;
  }

  const routes = [];
  const route = (method, pattern, handler, { auth = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, auth });
  };

  /* ---------- routes ---------- */
  route('GET', '/api/health', () => ({ status: 'ok', time: now(), ai: aiOpts.complete || aiOpts.apiKey ? 'enabled' : 'static-fallback' }));

  route('GET', '/api/config', () => ({
    roundDurationMs: ROUND_MS, maxHints: MAX_HINTS, hintPenalties: HINT_PENALTY,
    modes: Object.entries(game.MODES).map(([id, m]) => ({ id, ...m })),
  }));

  route('POST', '/api/users', ({ body }) => {
    const name = String(body.username || '').trim();
    if (!/^[A-Za-z0-9_\- ]{2,20}$/.test(name)) throw new HttpError(400, 'username must be 2-20 letters, numbers, spaces, _ or -', 'BAD_USERNAME');
    if (store.getUserByName(name)) throw new HttpError(409, 'That username is taken', 'USERNAME_TAKEN');
    const user = game.newUser(name, token());
    store.putUser(user);
    return { status: 201, body: { token: user.token, user: game.publicUser(user) } };
  });

  route('GET', '/api/me', ({ user }) => game.progressView(user), { auth: true });

  route('GET', '/api/scenarios', ({ query }) => {
    if (query.mode && !game.MODES[query.mode]) throw new HttpError(400, 'Unknown mode', 'BAD_MODE');
    return { scenarios: game.listScenarios(query.mode) };
  });

  route('POST', '/api/rounds', ({ user, body }) => ({
    status: 201, body: game.startRound(store, user, body, now()),
  }), { auth: true });

  route('GET', '/api/rounds/:id', ({ user, params }) => game.getRound(store, user, params.id, now()), { auth: true });

  route('POST', '/api/rounds/:id/hint', ({ user, params }) => game.useHint(store, user, params.id, now()), { auth: true });

  route('POST', '/api/rounds/:id/decision', ({ user, params, body }) =>
    game.submitDecision(store, user, params.id, body.optionId, now(), aiOpts), { auth: true });

  route('GET', '/api/leaderboard', ({ query }) => ({
    by: query.by === 'best' ? 'best' : 'total',
    entries: game.leaderboard(store, query.by, Math.min(50, Number(query.limit) || 20)),
  }));

  /* ---------- plumbing ---------- */
  function send(res, status, payload) {
    if (status === 204) {
      res.writeHead(204, {
        'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-max-age': '600',
      });
      return res.end();
    }
    const data = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data),
      'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store',
    });
    res.end(data);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 10_000) { reject(new HttpError(413, 'Body too large', 'TOO_LARGE')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
        } catch { reject(new HttpError(400, 'Invalid JSON body', 'BAD_JSON')); }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      if (limited(req.socket.remoteAddress)) throw new HttpError(429, 'Too many requests', 'RATE_LIMITED');

      if (!url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && serveStatic(req, res, url.pathname)) return;
        throw new HttpError(404, 'Not found', 'NOT_FOUND');
      }

      for (const r of routes) {
        const m = url.pathname.match(r.re);
        if (!m) continue;
        if (r.method !== req.method) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        let user = null;
        if (r.auth) {
          const h = req.headers.authorization || '';
          user = store.getUserByToken(h.startsWith('Bearer ') ? h.slice(7) : '');
          if (!user) throw new HttpError(401, 'Missing or invalid token', 'UNAUTHORIZED');
        }
        const body = req.method === 'POST' ? await readBody(req) : {};
        const out = await r.handler({ params, query: Object.fromEntries(url.searchParams), body, user });
        if (out && out.status && out.body) return send(res, out.status, out.body);
        return send(res, 200, out);
      }
      if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Method not allowed', 'METHOD');
      throw new HttpError(404, 'Not found', 'NOT_FOUND');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      log('Unhandled error:', err);
      return send(res, 500, { error: { code: 'INTERNAL', message: 'Internal server error' } });
    }
  });

  return { server, store, close: () => new Promise((r) => { store.flush(); server.close(() => r()); }) };
}

module.exports = { createApp };
