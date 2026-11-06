'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const stats = require('../lib/stats');
const settings = require('../lib/settings');
const access = require('../lib/access');
const pages = require('../lib/pages');
const makeFakeRedis = require('./helpers/fake-redis');
const { mockRes, withAdminEnv, adminCookie } = require('./helpers/http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120';

function setup() {
  const fake = makeFakeRedis();
  stats.setClientForTests(fake);
  settings.resetCache();
  return fake;
}

const get = (headers = {}, query = {}) => ({ method: 'GET', headers: { host: 'site.test', 'user-agent': UA, ...headers }, query });
const post = (body, headers = {}, query = {}) => ({ method: 'POST', body, query, headers: { host: 'site.test', 'user-agent': UA, 'x-forwarded-for': '10.0.0.1', ...headers } });

/* ---------- Настройки ---------- */

test('настройки: по умолчанию всё открыто, а без базы сайт не блокируется', async () => {
  const fake = setup();
  const s = await settings.load();
  assert.strictEqual(s.maintenance.enabled, false);
  assert.strictEqual(s.access.enabled, false);
  assert.strictEqual(s.logs.retentionDays, 30);
  assert(fake.calls.includes('get'));

  stats.setClientForTests(null);
  settings.resetCache();
  assert.strictEqual((await settings.load()).maintenance.enabled, false, 'без Redis — значения по умолчанию');
});

test('настройки: проверка вводимых значений', withAdminEnv(async () => {
  setup();
  const cur = settings.defaults();
  const bad = (input, re) => assert.throws(() => settings.applyUpdate(cur, input), (e) => e instanceof settings.ValidationError && re.test(e.message));

  bad({ access: { user: 'ab' } }, /Логин/);
  bad({ access: { user: 'ivan petrov' } }, /Логин/);
  bad({ access: { enabled: true } }, /логин и пароль/);
  bad({ access: { enabled: true, user: 'student' } }, /логин и пароль/);
  bad({ access: { user: 'student', password: '123' } }, /Пароль/);
  bad({ logs: { retentionDays: 0 } }, /Срок хранения/);
  bad({ logs: { retentionDays: 91 } }, /Срок хранения/);
  bad({ logs: { retentionDays: 7.5 } }, /Срок хранения/);
  bad({ maintenance: { message: 'x'.repeat(501) } }, /не длиннее/);

  const ok = settings.applyUpdate(cur, {
    maintenance: { enabled: true, message: '  Обновляем расписание  ' },
    access: { enabled: true, user: 'Студент_1', password: 'secret1' },
    logs: { retentionDays: 14 },
  });
  assert.strictEqual(ok.maintenance.message, 'Обновляем расписание');
  assert.strictEqual(ok.access.user, 'Студент_1', 'кириллица в логине допустима');
  assert(ok.access.hash.startsWith('scrypt$'), 'пароль хранится хешем');
  assert(!JSON.stringify(settings.publicView(ok)).includes('scrypt'), 'хеш не уходит в админку');
  assert.strictEqual(ok.access.ver, 3, 'смена логина и пароля увеличивает версию сессий');
  assert.strictEqual(ok.logs.retentionDays, 14);

  const keep = settings.applyUpdate(ok, { access: { user: 'Студент_1', password: '' } });
  assert.strictEqual(keep.access.hash, ok.access.hash, 'пустой пароль — не менять');
  assert.strictEqual(keep.access.ver, ok.access.ver);

  assert.strictEqual(settings.applyUpdate(cur, { maintenance: { message: '   ' } }).maintenance.message, settings.DEFAULT_MESSAGE);
}));

test('настройки: сохраняются, кэшируются и переживают недоступность базы', async () => {
  const fake = setup();
  await settings.update({ maintenance: { enabled: true, message: 'Работы' } });
  settings.resetCache();
  assert.strictEqual((await settings.load()).maintenance.message, 'Работы', 'прочитано из базы');

  fake.calls.length = 0;
  await settings.load();
  await settings.load();
  assert.strictEqual(fake.calls.length, 0, 'повторные чтения идут из кэша');

  fake.get = async () => { throw new Error('down'); };
  assert.strictEqual((await settings.load({ fresh: true })).maintenance.message, 'Работы', 'при сбое базы — последние известные настройки');
  settings.resetCache();
  assert.strictEqual((await settings.load()).maintenance.enabled, false, 'совсем нет данных — сайт открыт');
});

/* ---------- Проверка доступа ---------- */

test('доступ: открыто / заглушка / вход; админ проходит всегда', withAdminEnv(async () => {
  setup();
  assert.strictEqual((await access.evaluate(get())).state, 'open');

  await settings.update({ access: { enabled: true, user: 'student', password: 'secret1' } });
  assert.strictEqual((await access.evaluate(get())).state, 'login');
  assert.strictEqual((await access.evaluate(get({ cookie: adminCookie() }))).state, 'open', 'админ без отдельного входа');

  await settings.update({ maintenance: { enabled: true } });
  assert.strictEqual((await access.evaluate(get())).state, 'maintenance', 'заглушка сильнее входа');
  assert.strictEqual((await access.evaluate(get({ cookie: adminCookie() }))).state, 'open', 'админ видит сайт при заглушке');
}));

test('доступ: cookie посетителя проверяется по подписи, сроку и версии', withAdminEnv(async () => {
  setup();
  await settings.update({ access: { enabled: true, user: 'student', password: 'secret1' } });
  const s = await settings.load();
  const ver = s.access.ver;
  const cookie = access.makeCookie(ver).split(';')[0];

  assert(access.makeCookie(ver).includes('HttpOnly') && access.makeCookie(ver).includes('SameSite=Lax'));
  assert(access.makeCookie(ver).includes(`Max-Age=${7 * 24 * 3600}`), 'сессия — 7 дней');
  assert.strictEqual(access.hasVisitorSession({ headers: { cookie } }, ver), true);
  assert.strictEqual(access.hasVisitorSession({ headers: { cookie } }, ver + 1), false, 'другая версия');
  assert.strictEqual(access.hasVisitorSession({ headers: { cookie: cookie.slice(0, -2) + 'ab' } }, ver), false, 'подделана подпись');
  assert.strictEqual(access.hasVisitorSession({ headers: { cookie: `${access.COOKIE_NAME}=1.${ver}.abc` } }, ver), false);
  assert.strictEqual(access.hasVisitorSession({ headers: {} }, ver), false);

  assert.strictEqual((await access.evaluate(get({ cookie }))).state, 'open');
  await settings.revokeVisitorSessions();
  assert.strictEqual((await access.evaluate(get({ cookie }))).state, 'login', '«Выйти у всех» работает');
}));

/* ---------- Привратник: страница и вход ---------- */

test('gate: открытый сайт отдаёт страницу, поддерживает ETag, закрытые состояния — заглушку и вход', withAdminEnv(async () => {
  setup();
  const gate = require('../api/gate');

  let res = mockRes();
  await gate(get(), res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.headers['x-gate'], '1', 'метка проверки доступа');
  assert(String(res.body).includes('id="homeView"'), 'отдан index.html');
  assert(res.headers['cache-control'].includes('private'), 'страницу не должен хранить CDN');
  const etag = res.headers.etag;
  res = mockRes();
  await gate(get({ 'if-none-match': etag }), res);
  assert.strictEqual(res.code, 304);

  await settings.update({ maintenance: { enabled: true, message: 'Скоро <b>вернёмся</b>' } });
  res = mockRes();
  await gate(get(), res);
  assert.strictEqual(res.code, 503);
  assert(res.headers['retry-after']);
  assert(res.body.includes('Сайт временно не работает'));
  assert(res.body.includes('Скоро &lt;b&gt;вернёмся&lt;/b&gt;') && !res.body.includes('<b>вернёмся'), 'текст экранируется');
  assert(!res.body.includes('id="homeView"'), 'сайт не отдаётся');

  res = mockRes();
  await gate(get({ cookie: adminCookie() }), res);
  assert.strictEqual(res.code, 200, 'админ видит сайт');

  await settings.update({ maintenance: { enabled: false }, access: { enabled: true, user: 'student', password: 'secret1' } });
  res = mockRes();
  await gate(get(), res);
  assert.strictEqual(res.code, 200);
  assert(res.body.includes('id="loginForm"') && !res.body.includes('id="homeView"'), 'вместо сайта — форма входа');
}));

test('gate: вход посетителя — успех, неверный пароль, чужой origin, лимит попыток', withAdminEnv(async () => {
  setup();
  await settings.update({ access: { enabled: true, user: 'student', password: 'secret1' } });
  const gate = require('../api/gate');
  const ok = { login: 'student', password: 'secret1' };

  let res = mockRes();
  await gate(post(ok, { origin: 'https://evil.test' }), res);
  assert.strictEqual(res.code, 403);

  res = mockRes();
  await gate(post({ login: 'student', password: 'wrong' }, { origin: 'https://site.test', 'x-forwarded-for': '10.1.1.1' }), res);
  assert.strictEqual(res.code, 401);
  assert(!res.headers['set-cookie']);

  res = mockRes();
  await gate(post({ login: 'nobody', password: 'secret1' }, { origin: 'https://site.test', 'x-forwarded-for': '10.1.1.1' }), res);
  assert.strictEqual(res.code, 401, 'неверный логин');

  res = mockRes();
  await gate(post(ok, { origin: 'https://site.test', 'x-forwarded-for': '10.2.2.2' }), res);
  assert.strictEqual(res.code, 200);
  const cookie = res.headers['set-cookie'].split(';')[0];
  assert.strictEqual((await access.evaluate(get({ cookie }))).state, 'open', 'после входа сайт открыт');

  // Лимит: 20 неверных попыток с одного IP, потом 429 (даже с верным паролем)
  let last;
  for (let i = 0; i < 21; i++) { last = mockRes(); await gate(post({ login: 'student', password: 'x' + i }, { origin: 'https://site.test', 'x-forwarded-for': '10.3.3.3' }), last); }
  assert.strictEqual(last.code, 429);
  res = mockRes();
  await gate(post(ok, { origin: 'https://site.test', 'x-forwarded-for': '10.3.3.3' }), res);
  assert.strictEqual(res.code, 429);
}));

test('API сайта: при выключенном или закрытом сайте расписание и группы не отдаются', withAdminEnv(async () => {
  setup();
  const groups = require('../api/groups');
  const schedule = require('../api/schedule');

  await settings.update({ access: { enabled: true, user: 'student', password: 'secret1' } });
  for (const handler of [groups, schedule]) {
    const res = mockRes();
    await handler(get({}, { page: 'bg203' }), res);
    assert.strictEqual(res.code, 401);
    assert.strictEqual(res.headers['cache-control'], 'no-store');
  }

  await settings.update({ maintenance: { enabled: true } });
  const res = mockRes();
  await groups(get(), res);
  assert.strictEqual(res.code, 503);
  assert.strictEqual(res.body.maintenance, true);
}));

test('visit: когда сайт закрыт, посещения не учитываются', withAdminEnv(async () => {
  const fake = setup();
  await settings.update({ access: { enabled: true, user: 'student', password: 'secret1' } });
  const visit = require('../api/visit');
  const res = mockRes();
  const before = fake.kv.size;
  await visit(post({ vid: 'ffffffff-6666', type: 'load' }, { origin: 'https://site.test' }), res);
  assert.strictEqual(res.code, 204);
  assert.strictEqual(res.headers['x-visit-skip'], 'gate');
  assert.strictEqual(fake.kv.size, before);
}));

/* ---------- Админка: настройки и очистка журнала ---------- */

test('admin-stats: настройки требуют сессии, сохраняются и показываются без хеша', withAdminEnv(async () => {
  setup();
  const handler = require('../api/admin-stats');
  const cookie = adminCookie();
  const origin = { origin: 'https://site.test', cookie };

  let res = mockRes();
  await handler(post({ action: 'settings.save', settings: {} }, { origin: 'https://site.test' }), res);
  assert.strictEqual(res.code, 401, 'без сессии нельзя');
  res = mockRes();
  await handler(post({ action: 'settings.save', settings: {} }, { origin: 'https://evil.test', cookie }), res);
  assert.strictEqual(res.code, 403, 'чужой origin');

  res = mockRes();
  await handler(post({ action: 'settings.save', settings: { access: { enabled: true, user: 'student' } } }, origin), res);
  assert.strictEqual(res.code, 400);
  assert(/логин и пароль/.test(res.body.error));

  res = mockRes();
  await handler(post({ action: 'settings.save', settings: { maintenance: { enabled: true, message: 'Работы' }, access: { enabled: true, user: 'student', password: 'secret1' }, logs: { retentionDays: 10 } } }, origin), res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.access.hasPassword, true);
  assert(!JSON.stringify(res.body).includes('scrypt'));

  res = mockRes();
  await handler(get({ cookie }, { json: '1', view: 'settings' }), res);
  assert.strictEqual(res.body.maintenance.enabled, true);
  assert.strictEqual(res.body.logs.retentionDays, 10);
  assert.strictEqual(res.body.configured, true);

  res = mockRes();
  await handler(get({ cookie }, { json: '1', brief: '1' }), res);
  assert.strictEqual(res.body.maintenance, true);
  assert.strictEqual(res.body.restricted, true);

  res = mockRes();
  await handler(get({ cookie }, { view: 'settings' }), res);
  assert.strictEqual(res.code, 200);
  assert(res.body.includes('/admin-assets/settings.js'));
  assert(!res.headers['content-security-policy'].includes('unsafe-inline'));

  res = mockRes();
  await handler(get({}, { view: 'settings' }), res);
  assert.strictEqual(res.code, 302, 'страница настроек без сессии ведёт на вход');
}));

test('очистка журнала: выбранные, по периоду, всё сразу', async () => {
  const fake = setup();
  const T = Date.UTC(2026, 10, 6, 12, 0, 0);
  const DAY = 86400000;
  const rec = (id, ago) => stats.record({ id, ip: '1.2.3.4', country: 'RU', ua: UA, group: '841', type: 'load' }, T - ago * DAY);
  await rec('aaaaaaaa-1', 0); await rec('bbbbbbbb-2', 3); await rec('cccccccc-3', 10); await rec('dddddddd-4', 40);
  await stats.noteSkip('bot', 'Googlebot');
  assert.strictEqual((await stats.loadVisitors()).length, 4);

  assert.strictEqual(await stats.deleteVisitors(['dddddddd-4', 'нет-такого']), 2, 'считает по переданным id');
  assert.deepStrictEqual((await stats.loadVisitors()).map((r) => r.id).sort(), ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3']);

  assert.strictEqual(await stats.purge({ mode: 'older', days: 7 }, T), 1, 'старше 7 дней — один');
  assert.strictEqual(await stats.purge({ mode: 'recent', days: 1 }, T), 1, 'за последний день — один');
  assert.deepStrictEqual((await stats.loadVisitors()).map((r) => r.id), ['bbbbbbbb-2']);
  assert.strictEqual(await stats.purge({ mode: 'nonsense', days: 1 }, T), 0, 'некорректный режим ничего не удаляет');

  await rec('eeeeeeee-5', 1);
  assert.strictEqual(await stats.clearAll(), 2);
  assert.strictEqual((await stats.loadVisitors()).length, 0);
  assert.deepStrictEqual(await stats.loadSkips(), [], 'счётчики «Не засчитано» тоже очищены');
  assert.strictEqual(fake.kv.size, 0);
});

test('admin-stats: действия очистки и сокращение срока хранения', withAdminEnv(async () => {
  setup();
  const handler = require('../api/admin-stats');
  const cookie = adminCookie();
  const origin = { origin: 'https://site.test', cookie };
  const now = Date.now();
  const rec = (id, ago) => stats.record({ id, ip: '1.2.3.4', ua: UA, type: 'load' }, now - ago * 86400000);
  await rec('aaaaaaaa-1', 0); await rec('bbbbbbbb-2', 20); await rec('cccccccc-3', 2);

  let res = mockRes();
  await handler(post({ action: 'stats.delete', ids: ['cccccccc-3'] }, origin), res);
  assert.deepStrictEqual([res.code, res.body.deleted], [200, 1]);

  res = mockRes();
  await handler(post({ action: 'stats.purge', mode: 'older', days: -1 }, origin), res);
  assert.strictEqual(res.code, 400);

  // сокращаем срок хранения с 30 до 7 дней — запись 20-дневной давности удаляется сразу
  res = mockRes();
  await handler(post({ action: 'settings.save', settings: { logs: { retentionDays: 7 } } }, origin), res);
  assert.strictEqual(res.body.purged, 1);
  assert.deepStrictEqual((await stats.loadVisitors()).map((r) => r.id), ['aaaaaaaa-1']);

  res = mockRes();
  await handler(post({ action: 'stats.clear' }, origin), res);
  assert.strictEqual(res.body.deleted, 1);

  res = mockRes();
  await handler(post({ action: 'whatever' }, origin), res);
  assert.strictEqual(res.code, 400);

  stats.setClientForTests(null);
  res = mockRes();
  await handler(post({ action: 'stats.clear' }, origin), res);
  assert.strictEqual(res.code, 409, 'без базы — понятная ошибка');
}));

test('срок хранения применяется к записям (TTL в базе)', async () => {
  const fake = setup();
  await stats.record({ id: 'aaaaaaaa-1', ip: '1.1.1.1', ua: UA, type: 'load' }, Date.now(), { retentionDays: 5 });
  assert.strictEqual(fake.ttl.get('stats:v:aaaaaaaa-1'), 5 * 86400);
  await stats.record({ id: 'bbbbbbbb-2', ip: '1.1.1.1', ua: UA, type: 'load' });
  assert.strictEqual(fake.ttl.get('stats:v:bbbbbbbb-2'), 30 * 86400, 'по умолчанию 30 дней');
});

/* ---------- Служебные страницы ---------- */

test('страницы: 404 в репозитории совпадает с шаблоном, текст экранируется', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'public', '404.html'), 'utf8');
  assert.strictEqual(file, pages.notFoundHtml(), 'запустите: node -e "require(\'fs\').writeFileSync(\'public/404.html\', require(\'./lib/pages\').notFoundHtml())"');
  assert(file.includes('Страница не найдена') && file.includes('href="/">На главную'));
  assert(!/<script/i.test(file), '404 без скриптов');
  assert(pages.maintenanceHtml('<img src=x onerror=alert(1)>').includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(pages.loginHtml().includes('/gate.js'));
});

test('сайт лежит не в public: напрямую, минуя проверку, его не отдать', () => {
  assert(!fs.existsSync(path.join(__dirname, '..', 'public', 'index.html')));
  assert(fs.existsSync(path.join(__dirname, '..', 'views', 'index.html')));
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const dest = (src) => (cfg.rewrites.find((r) => r.source === src) || {}).destination;
  assert.strictEqual(dest('/'), '/api/gate');
  assert.strictEqual(dest('/index.html'), '/api/gate');
  assert.strictEqual(dest('/admin/settings'), '/api/admin-stats?view=settings');
  assert(fs.readdirSync(path.join(__dirname, '..', 'api')).filter((f) => f.endsWith('.js')).length <= 12, 'не больше 12 функций (лимит бесплатного тарифа Vercel)');
});
