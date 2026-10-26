'use strict';

const assert = require('node:assert');
const test = require('node:test');
const auth = require('../lib/adminAuth');
const limiter = require('../lib/rateLimit');

const PASSWORD = 'test-password-for-unit-tests';
const SECRET = 's'.repeat(48);

function configure() {
  process.env.ADMIN_USER = 'tester';
  process.env.ADMIN_PASSWORD_HASH = auth.hashPassword(PASSWORD);
  process.env.SESSION_SECRET = SECRET;
}

function clear() {
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD_HASH;
  delete process.env.SESSION_SECRET;
}

const cookieHeader = (setCookie) => ({ headers: { cookie: setCookie.split(';')[0] } });

test('без переменных окружения вход отключён', () => {
  clear();
  assert.strictEqual(auth.isConfigured(), false);
  assert.strictEqual(auth.checkCredentials('tester', PASSWORD), false);
  assert.strictEqual(auth.hasValidSession({ headers: { cookie: 'admin_session=1.abc' } }), false);
});

test('слишком короткий секрет сессии считается ошибкой конфигурации', () => {
  configure();
  process.env.SESSION_SECRET = 'short';
  assert.strictEqual(auth.isConfigured(), false);
  clear();
});

test('проверка логина и пароля', () => {
  configure();
  assert.strictEqual(auth.checkCredentials('tester', PASSWORD), true);
  assert.strictEqual(auth.checkCredentials('tester', PASSWORD + 'x'), false);
  assert.strictEqual(auth.checkCredentials('other', PASSWORD), false);
  assert.strictEqual(auth.checkCredentials('', ''), false);
  clear();
});

test('хеш пароля солёный и не содержит пароль', () => {
  const a = auth.hashPassword(PASSWORD);
  const b = auth.hashPassword(PASSWORD);
  assert.notStrictEqual(a, b);
  assert.ok(!a.includes(PASSWORD));
  assert.ok(auth.verifyPassword(PASSWORD, a));
  assert.strictEqual(auth.verifyPassword(PASSWORD, 'scrypt$broken'), false);
});

test('сессия: подпись, подделка и смена пароля', () => {
  configure();
  const cookie = auth.makeSessionCookie();
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  const req = cookieHeader(cookie);
  assert.strictEqual(auth.hasValidSession(req), true);

  const forged = { headers: { cookie: req.headers.cookie.replace(/.$/, (c) => (c === '0' ? '1' : '0')) } };
  assert.strictEqual(auth.hasValidSession(forged), false);

  process.env.ADMIN_PASSWORD_HASH = auth.hashPassword('another password value');
  assert.strictEqual(auth.hasValidSession(req), false, 'после смены пароля старые сессии недействительны');
  clear();
});

test('проверка источника запроса', () => {
  assert.strictEqual(auth.isSameOrigin({ headers: { origin: 'https://site.example', host: 'site.example' } }), true);
  assert.strictEqual(auth.isSameOrigin({ headers: { origin: 'https://evil.example', host: 'site.example' } }), false);
  assert.strictEqual(auth.isSameOrigin({ headers: { 'sec-fetch-site': 'cross-site', host: 'site.example' } }), false);
  assert.strictEqual(auth.isSameOrigin({ headers: { host: 'site.example' } }), true);
});

test('ограничитель попыток входа', () => {
  const ip = '203.0.113.7';
  const t0 = 1_000_000;
  for (let i = 0; i < limiter.MAX_FAILURES; i += 1) {
    assert.strictEqual(limiter.check(ip, t0).allowed, true);
    limiter.recordFailure(ip, t0);
  }
  const blocked = limiter.check(ip, t0 + 1000);
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
  assert.strictEqual(limiter.check(ip, t0 + limiter.WINDOW_MS + 1).allowed, true);
  limiter.reset(ip);
});

test('пароль можно задать напрямую, секрет сессии необязателен', () => {
  clear();
  process.env.ADMIN_USER = 'tester';
  process.env.ADMIN_PASSWORD = PASSWORD;
  assert.strictEqual(auth.isConfigured(), true);
  assert.strictEqual(auth.checkCredentials('tester', PASSWORD), true);
  assert.strictEqual(auth.checkCredentials('tester', PASSWORD + '!'), false);
  assert.strictEqual(auth.checkCredentials('tester', ''), false);

  const req = cookieHeader(auth.makeSessionCookie());
  assert.strictEqual(auth.hasValidSession(req), true);

  process.env.ADMIN_PASSWORD = 'a different long password';
  assert.strictEqual(auth.hasValidSession(req), false, 'после смены пароля старые сессии недействительны');
  clear();
});

test('слишком короткий пароль не принимается', () => {
  clear();
  process.env.ADMIN_USER = 'tester';
  process.env.ADMIN_PASSWORD = 'short';
  assert.strictEqual(auth.isConfigured(), false);
  clear();
});
