import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

process.env.APP_PROOF_HASH = crypto.createHash('sha256').update('sample-proof').digest('hex');
process.env.SESSION_SECRET = 'test-session-secret-with-enough-entropy';
process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_REPO = 'owner/private-db';

const lib = await import('../api/_lib.js');
const { default: dbHandler } = await import('../api/db.js');

function mockRes() {
  return {
    headers: {}, statusCode: 200, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(v = '') { this.body = String(v); }
  };
}

function authedReq(method, body) {
  const cfg = lib.env();
  const cookie = lib.sessionCookie(lib.newSessionValue(cfg), 3600).split(';')[0];
  return { method, url: '/api/db', headers: { cookie, 'x-c27-allow-shrink': '0' }, body };
}

test('constant-time comparison helper accepts equal values and rejects different values', () => {
  assert.equal(lib.safeEqual('abc', 'abc'), true);
  assert.equal(lib.safeEqual('abc', 'abd'), false);
});

test('proof hash authentication matches the browser derivation', () => {
  assert.equal(lib.checkProof(lib.env(), 'sample-proof'), true);
  assert.equal(lib.checkProof(lib.env(), 'wrong-proof'), false);
});

test('signed session validates and tampering is rejected', () => {
  const cfg = lib.env();
  const value = lib.newSessionValue(cfg);
  const req = { headers: { cookie: `${lib.COOKIE_NAME}=${value}` } };
  assert.ok(lib.readSession(req, cfg));
  req.headers.cookie = `${lib.COOKIE_NAME}=${value}x`;
  assert.equal(lib.readSession(req, cfg), null);
});

test('database endpoint refuses unauthenticated requests', async () => {
  const res = mockRes();
  await dbHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('database endpoint refuses plaintext writes by default', async () => {
  delete process.env.ALLOW_LEGACY_PLAINTEXT_DB;
  const res = mockRes();
  await dbHandler(authedReq('POST', { cards: [], transactions: [], updatedAt: Date.now() }), res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /criptografado/i);
});

test('database endpoint rejects malformed AES envelope', async () => {
  const res = mockRes();
  await dbHandler(authedReq('POST', { v: 2, enc: 'aes-gcm-256', ksalt: 'x', iv: 'x', data: 'x' }), res);
  assert.equal(res.statusCode, 422);
});

test('readJson propagates request size limit errors', async () => {
  const req = { body: Buffer.alloc(4 * 1024 * 1024 + 1) };
  await assert.rejects(() => lib.readJson(req), /BODY_TOO_LARGE/);
});

test('login throttling activates after repeated failures in the same instance', () => {
  const req = { headers: { 'x-real-ip': '192.0.2.44' } };
  let state;
  for (let i = 0; i < 5; i++) { state = lib.loginRateLimit(req); assert.equal(state.allowed, true); lib.loginRateFail(state); }
  assert.equal(lib.loginRateLimit(req).allowed, false);
});

test('valid encrypted envelope can be written to GitHub', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'PUT') return new Response(JSON.stringify({ content: { sha: 'new-sha' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/contents/')) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    if (String(url).includes('/repos/owner/private-db')) return new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error('Unexpected URL ' + url);
  };
  try {
    const envelope = {
      v: 2, enc: 'aes-gcm-256',
      ksalt: crypto.randomBytes(16).toString('base64'),
      iv: crypto.randomBytes(12).toString('base64'),
      data: crypto.randomBytes(48).toString('base64'),
      updatedAt: Date.now()
    };
    const res = mockRes();
    await dbHandler(authedReq('POST', envelope), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /"ok":true/);
  } finally { globalThis.fetch = originalFetch; }
});

test('database endpoint blocks reading legacy plaintext by default', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/contents/')) {
      const content = Buffer.from(JSON.stringify({ cards: [], transactions: [], updatedAt: 1 })).toString('base64');
      return new Response(JSON.stringify({ type: 'file', sha: 'legacy-sha', encoding: 'base64', content }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected URL ' + url);
  };
  try {
    delete process.env.ALLOW_LEGACY_PLAINTEXT_DB;
    const res = mockRes();
    await dbHandler(authedReq('GET'), res);
    assert.equal(res.statusCode, 422);
  } finally { globalThis.fetch = originalFetch; }
});


test('v2.00c provisions a new browser only after shared server and encrypted-bank validation', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = \"v2\.00c\"/);
  assert.match(html, /const chk = await c27FirstAccessCheck\(pw\)/);
  assert.match(html, /auto_access_provisioned/);
  assert.doesNotMatch(html, /Primeiro acesso: clique em ‘Configurar primeiro acesso’/);
});
