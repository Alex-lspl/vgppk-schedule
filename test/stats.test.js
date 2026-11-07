'use strict';

const assert = require('node:assert');
const test = require('node:test');
const stats = require('../lib/stats');
const makeFakeRedis = require('./helpers/fake-redis');

const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari';
const UA_AND = 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile';

test('определение устройства, ботов и очистка входных данных', () => {
  assert.strictEqual(stats.parseUA(UA_AND).kind, 'android');
  assert.strictEqual(stats.parseUA(UA_IOS).kind, 'ios');
  assert.strictEqual(stats.parseUA(UA_WIN).kind, 'pc');
  assert(stats.isBot('Googlebot/2.1'));
  assert(!stats.isBot('Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'), 'CUBOT — это телефон');
  assert(stats.isBot(''));
  assert(!stats.isBot(UA_WIN));
  assert(!stats.isBot(UA_IOS));
  assert.strictEqual(stats.cleanGroup('841<script>'), '841script');
  assert.strictEqual(stats.cleanGroup('  '), null);
  assert(stats.visitorId({ vid: 'bad id!', ip: '1.1.1.1', ua: 'x' }).startsWith('ip-'));
});

test('подсчёт посетителей, онлайна, стран и устройств', async () => {
  const fake = makeFakeRedis();
  stats.setClientForTests(fake);
  const T0 = Date.UTC(2026, 10, 4, 9, 0, 0); // 4 нояб 12:00 МСК

  // Короткий визит: открыл и ушёл
  await stats.record({ id: 'aaaaaaaa-1111', ip: '95.10.20.42', country: 'RU', ua: UA_WIN, group: '841', type: 'load' }, T0);
  assert.strictEqual(stats.countOnline(await stats.loadVisitors(), T0 + 5000), 1, 'сразу после открытия — онлайн');
  await stats.record({ id: 'aaaaaaaa-1111', type: 'leave' }, T0 + 8000);
  assert.strictEqual(stats.countOnline(await stats.loadVisitors(), T0 + 9000), 0, 'после leave — сразу не онлайн');

  // iPhone, две группы
  await stats.record({ id: 'bbbbbbbb-2222', ip: '178.1.2.13', country: 'DE', ua: UA_IOS, group: '841', type: 'load' }, T0 + 1000);
  await stats.record({ id: 'bbbbbbbb-2222', ip: '178.1.2.13', country: 'DE', ua: UA_IOS, group: '842', type: 'ping' }, T0 + 30000);

  // Android: вчера, затем сегодня со сменой IP
  await stats.record({ id: 'cccccccc-3333', ip: '82.9.9.91', country: 'KZ', ua: UA_AND, group: '841', type: 'load' }, T0 - 86400000);
  await stats.record({ id: 'cccccccc-3333', ip: '82.9.9.92', country: 'KZ', ua: UA_AND, group: '841', type: 'load' }, T0 + 2000);

  const recs = await stats.loadVisitors();
  assert.strictEqual(recs.length, 3);
  const s = stats.buildStats(recs, T0 + 40000);

  assert.strictEqual(s.online.count, 2);
  assert.strictEqual(s.today, 3);
  assert.strictEqual(s.week, 3);
  assert.strictEqual(s.month, 3);
  assert.strictEqual(s.daily[s.daily.length - 2].unique, 1);
  assert.strictEqual(s.periods[7].visits, 4, 'загрузок: aaaa 1 + bbbb 1 + cccc 2');
  assert.strictEqual(s.periods[7].newPct, 100);
  assert.deepStrictEqual(s.countries.map((c) => `${c.code}:${c.count}`).sort(), ['DE:1', 'KZ:1', 'RU:1']);
  assert.strictEqual(s.countriesTotal, 3);
  assert.strictEqual(s.devices.mobile, 67);
  assert.strictEqual(s.devices.pc, 33);

  const kz = s.visitors.find((v) => v.country === 'KZ');
  assert.deepStrictEqual(kz.ips, ['82.9.9.91', '82.9.9.92']);
  assert.strictEqual(kz.ip, '82.9.9.92');
  const de = s.visitors.find((v) => v.country === 'DE');
  assert.deepStrictEqual(de.groups, ['842', '841']);

  assert.strictEqual(stats.buildStats(recs, T0 + 130000).online.count, 0, 'через 2 минуты никого онлайн');

  // Пинг существующего посетителя — две команды Redis
  fake.calls.length = 0;
  await stats.record({ id: 'bbbbbbbb-2222', ip: '178.1.2.13', ua: UA_IOS, group: '841', type: 'ping' }, T0 + 60000);
  assert.deepStrictEqual(fake.calls, ['get', 'set']);

  // Истёкшая запись вычищается из индекса
  fake.kv.delete('stats:v:aaaaaaaa-1111');
  assert.strictEqual((await stats.loadVisitors()).length, 2);
  assert.strictEqual(fake.z.get('stats:index').size, 2);
});

test('устройство: iPad под видом Mac, телефон в режиме «для ПК», планшет Android', () => {
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const dev = (x) => stats.parseDevice(x);

  assert.deepStrictEqual(dev({ ua: UA_WIN }), { kind: 'pc', os: 'Windows / ПК' });
  assert.deepStrictEqual(dev({ ua: UA_WIN, touch: 10, width: 1536 }), { kind: 'pc', os: 'Windows / ПК' }, 'сенсорный ноутбук остаётся ПК');
  assert.deepStrictEqual(dev({ ua: MAC, touch: 0, width: 1440 }), { kind: 'pc', os: 'Mac / ПК' });
  assert.deepStrictEqual(dev({ ua: MAC, touch: 5, width: 820 }), { kind: 'ios', os: 'iPad / iOS' }, 'iPadOS притворяется Mac');
  assert.deepStrictEqual(dev({ ua: MAC, touch: 5, width: 390 }), { kind: 'ios', os: 'iPhone / iOS' }, 'iPhone в режиме для ПК');
  assert.deepStrictEqual(dev({ ua: UA_AND }), { kind: 'android', os: 'Android' });
  assert.deepStrictEqual(dev({ ua: UA_AND.replace(' Mobile', '') }), { kind: 'android', os: 'Android (планшет)' });
  assert.deepStrictEqual(dev({ ua: LINUX, touch: 5, width: 412 }), { kind: 'android', os: 'Android' }, 'Android в режиме для ПК');
  assert.deepStrictEqual(dev({ ua: LINUX, chMobile: '?1' }), { kind: 'android', os: 'Android' });
  assert.deepStrictEqual(dev({ ua: LINUX, touch: 0, width: 1920 }), { kind: 'pc', os: 'Linux / ПК' });
  assert.deepStrictEqual(dev({ ua: UA_WIN, chPlatform: '"Windows"', chMobile: '?0' }), { kind: 'pc', os: 'Windows / ПК' });
});

test('браузер определяется в правильном порядке', () => {
  const b = stats.parseBrowser;
  assert.strictEqual(b('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36'), 'Chrome');
  assert.strictEqual(b('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0'), 'Edge');
  assert.strictEqual(b('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 OPR/105'), 'Opera');
  assert.strictEqual(b('Mozilla/5.0 (Windows NT 10.0) Chrome/120 YaBrowser/24.1 Safari/537.36'), 'Яндекс Браузер');
  assert.strictEqual(b('Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0'), 'Firefox');
  assert.strictEqual(b(UA_IOS), 'Safari');
  assert.strictEqual(b('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Mobile/15E148 CriOS/120 Safari/604'), 'Chrome');
  assert.strictEqual(b('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36 SamsungBrowser/23.0'), 'Samsung Internet');
});

test('переменные Upstash находятся и с префиксом, выбранным в Vercel', () => {
  assert.deepStrictEqual(stats.findRedisEnv({ KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' }), { url: 'u', token: 't' });
  assert.deepStrictEqual(stats.findRedisEnv({ UPSTASH_REDIS_REST_URL: 'u2', UPSTASH_REDIS_REST_TOKEN: 't2' }), { url: 'u2', token: 't2' });
  assert.deepStrictEqual(stats.findRedisEnv({ STORAGE_KV_REST_API_URL: 'u3', STORAGE_KV_REST_API_TOKEN: 't3' }), { url: 'u3', token: 't3' });
  assert.strictEqual(stats.findRedisEnv({ KV_REST_API_URL: 'u' }), null);
  assert.strictEqual(stats.findRedisEnv({}), null);
});

/* ---------- Эндпоинты и защита ---------- */

const auth = require('../lib/adminAuth');

function mockRes() {
  const res = { headers: {}, code: 0, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.send = (b) => { res.body = b; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

function withAdminEnv(fn) {
  return async () => {
    process.env.ADMIN_USER = 'tester';
    process.env.ADMIN_PASSWORD = 'long-enough-password-123';
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.SESSION_SECRET;
    try { await fn(); } finally {
      delete process.env.ADMIN_USER;
      delete process.env.ADMIN_PASSWORD;
    }
  };
}

test('admin-stats: без сессии — редирект на вход и 401 для JSON', withAdminEnv(async () => {
  const handler = require('../api/admin-stats');

  const page = mockRes();
  await handler({ method: 'GET', headers: {}, query: {} }, page);
  assert.strictEqual(page.code, 302);
  assert.strictEqual(page.headers.location, '/admin');

  const json = mockRes();
  await handler({ method: 'GET', headers: {}, query: { json: '1' } }, json);
  assert.strictEqual(json.code, 401);
}));

test('admin-stats: страница с сессией отдаётся со строгой CSP', withAdminEnv(async () => {
  const handler = require('../api/admin-stats');
  const cookie = auth.makeSessionCookie().split(';')[0];
  const res = mockRes();
  await handler({ method: 'GET', headers: { cookie }, query: {} }, res);
  assert.strictEqual(res.code, 200);
  const csp = res.headers['content-security-policy'];
  assert(csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'));
  assert(res.body.includes('/admin-assets/stats.js'));
}));

test('visit: админ, чужой origin и боты не учитываются, обычный заход — да', withAdminEnv(async () => {
  const fake = makeFakeRedis();
  stats.setClientForTests(fake);
  const track = require('../api/visit');
  const body = JSON.stringify({ vid: 'dddddddd-4444', type: 'load', group: '841' });
  const base = { method: 'POST', body, headers: { 'user-agent': UA_WIN, host: 'site.test', 'x-forwarded-for': '95.1.2.3' } };

  await track({ ...base, headers: { ...base.headers, origin: 'https://evil.test' } }, mockRes());
  await track({ ...base, headers: { ...base.headers, 'user-agent': 'Googlebot/2.1' } }, mockRes());
  await track({ ...base, headers: { ...base.headers, cookie: auth.makeSessionCookie().split(';')[0] } }, mockRes());
  assert.strictEqual([...fake.kv.keys()].filter((k) => k.startsWith('stats:v:')).length, 0, 'посетитель не записан');

  const res = mockRes();
  await track({ ...base, headers: { ...base.headers, origin: 'https://site.test', 'x-vercel-ip-country': 'ru' } }, res);
  assert.strictEqual(res.code, 200, 'засчитанный визит возвращает постоянный код');
  assert.deepStrictEqual(res.body, { vid: 'dddddddd-4444' });
  assert.strictEqual([...fake.kv.keys()].filter((k) => k.startsWith('stats:v:')).length, 1, 'обычный заход записан');
  const rec = JSON.parse(fake.kv.get('stats:v:dddddddd-4444'));
  assert.strictEqual(rec.country, 'RU');
  assert.strictEqual(rec.ip, '95.1.2.3');
  assert.strictEqual(rec.browser, 'Chrome');
}));

test('отклонённые сигналы попадают в диагностику', withAdminEnv(async () => {
  const fake = makeFakeRedis();
  stats.setClientForTests(fake);
  const visit = require('../api/visit');
  const headers = { 'user-agent': 'Googlebot/2.1', host: 'site.test', 'x-forwarded-for': '66.1.1.1' };
  await visit({ method: 'POST', body: '{}', headers }, mockRes());
  await visit({ method: 'POST', body: '{}', headers: { ...headers, 'user-agent': UA_WIN, origin: 'https://evil.test' } }, mockRes());
  const skips = await stats.loadSkips();
  assert.deepStrictEqual(skips.map((x) => `${x.reason}:${x.count}`).sort(), ['bot:1', 'origin:1']);
  assert(skips.find((x) => x.reason === 'origin').sample.includes('evil.test'));
}));
