'use strict';

/**
 * Сквозная проверка серверной части: загрузка расписания колледжа, отметки об изменениях,
 * ручные правки через обработчики API и каталог — на подменённых сайте колледжа и GitHub.
 */

const assert = require('node:assert');
const test = require('node:test');
const { stubParser, installFakes, lesson, groupSchedule } = require('./helpers/fakes');

stubParser();

process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_REPO = 'owner/repo';
process.env.GITHUB_BRANCH = 'main';
delete process.env.GITHUB_DATA_DIR;

const auth = require('../lib/adminAuth');
const { buildSchedule } = require('../lib/buildSchedule');
const { editableWeeks } = require('../lib/weekCycle');
const adminSave = require('../api/admin-save');
const adminData = require('../api/admin-data');
const adminReset = require('../api/admin-reset');
const adminCatalog = require('../api/admin-catalog');

process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASSWORD_HASH = auth.hashPassword('password-used-only-in-tests');
process.env.SESSION_SECRET = 'k'.repeat(48);

const makeCollege = (room) => groupSchedule('841', (weeks) => {
  for (const week of weeks) {
    week.days[0].lessons.push(lesson(1, 'Безопасность', 'Семичев Е.А.', '129'));
    week.days[0].lessons.push(lesson(2, 'Проектирование', 'Алябьев Д.А.', room));
  }
});

function call(handler, { method = 'GET', query = {}, body, session = true } = {}) {
  const req = {
    method,
    query,
    body,
    headers: { host: 'site.test', origin: 'https://site.test', cookie: session ? auth.makeSessionCookie().split(';')[0] : '' },
  };
  return new Promise((resolve) => {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    Promise.resolve(handler(req, res)).catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });
}

test('отметки колледжа, ручные правки и сброс', async () => {
  const fakes = installFakes({
    college: {
      'bg203.htm': makeCollege('241'),
      'bg.htm': { groups: [{ page: 'bg203', name: '841' }] },
    },
  });
  try {
    // Первая загрузка: создаётся снимок, отметок нет
    let data = await buildSchedule('bg203');
    assert.ok(data.weeks.every((w) => w.days[0].lessons.every((l) => !l.changedAt)));
    assert.ok('data/changes.json' in fakes.files);

    // Колледж меняет аудиторию: пара получает отметку «автоматически»
    fakes.college['bg203.htm'] = makeCollege('300');
    fakes.college['bg203.htm'].updated = '25.10.2026 23:10';
    data = await buildSchedule('bg203');
    const changed = data.weeks[0].days[0].lessons[1];
    assert.strictEqual(changed.room, '300');
    assert.strictEqual(changed.changeSource, 'auto');
    assert.strictEqual(data.weeks[0].days[0].lessons[0].changedAt, undefined);

    // Без доступа к API правки не сохраняются
    const denied = await call(adminSave, { method: 'POST', body: { page: 'bg203', weeks: {} }, session: false });
    assert.strictEqual(denied.status, 401);

    // Сохранение ручной правки в следующую календарную неделю
    const [, next] = editableWeeks(new Date());
    const saved = await call(adminSave, {
      method: 'POST',
      body: { page: 'bg203', weeks: { [next.weekKey]: { days: { 0: [{ pair: 3, subject: 'Замена', teacher: 'Иванов И.И.', room: '12' }] } } } },
    });
    assert.strictEqual(saved.status, 200);
    assert.deepStrictEqual(saved.body.weeks, [next.weekKey]);

    data = await buildSchedule('bg203');
    const week = data.weeks.find((w) => w.number === next.number);
    assert.deepStrictEqual(week.days[0].lessons.map((l) => l.subject), ['Замена']);
    assert.strictEqual(week.days[0].lessons[0].changeSource, 'manual');
    const other = data.weeks.find((w) => w.number !== next.number);
    assert.strictEqual(other.days[0].lessons.length, 2, 'вторая неделя не затронута');

    // Данные для редактора: расписание колледжа и сохранённые правки раздельно
    const admin = await call(adminData, { query: { page: 'bg203' } });
    assert.strictEqual(admin.status, 200);
    const editable = admin.body.weeks.find((w) => w.weekKey === next.weekKey);
    assert.strictEqual(editable.days[0].lessons.length, 2);
    assert.strictEqual(editable.overrideDays[0][0].subject, 'Замена');

    // Сброс возвращает данные колледжа
    const reset = await call(adminReset, { method: 'POST', body: { page: 'bg203' } });
    assert.strictEqual(reset.status, 200);
    data = await buildSchedule('bg203');
    assert.strictEqual(data.hasAdminOverrides, undefined);
  } finally {
    fakes.restore();
  }
});

test('каталог собирается один раз в сутки и хранится одним файлом', async () => {
  const fakes = installFakes({
    college: {
      'bg203.htm': makeCollege('241'),
      'bg.htm': { groups: [{ page: 'bg203', name: '841' }] },
    },
  });
  try {
    const first = await call(adminCatalog);
    assert.strictEqual(first.status, 200);
    assert.deepStrictEqual(first.body.teachers, ['Алябьев Д.А.', 'Семичев Е.А.']);
    assert.ok('data/catalog.json' in fakes.files);
    const writes = fakes.writes.length;

    // Повторное обращение в пределах суток не обращается к сайту колледжа
    fakes.college['bg203.htm'] = makeCollege('999');
    const second = await call(adminCatalog);
    assert.strictEqual(second.body.checkedAt, first.body.checkedAt);
    assert.strictEqual(fakes.writes.length, writes);

    // Принудительное обновление раньше, чем через час, тоже игнорируется
    const forced = await call(adminCatalog, { query: { refresh: '1' } });
    assert.strictEqual(forced.body.checkedAt, first.body.checkedAt);
  } finally {
    fakes.restore();
  }
});

test('параллельное изменение файла не теряет данные (повтор при конфликте)', async () => {
  const fakes = installFakes({ college: { 'bg203.htm': makeCollege('241') }, files: {} });
  try {
    fakes.failWrites = 2;
    const [, next] = editableWeeks(new Date());
    const saved = await call(adminSave, {
      method: 'POST',
      body: { page: 'bg203', weeks: { [next.weekKey]: { days: { 1: [{ pair: 1, subject: 'Физика' }] } } } },
    });
    assert.strictEqual(saved.status, 200);
    assert.ok(JSON.parse(fakes.files['data/overrides.json']).bg203);
  } finally {
    fakes.restore();
  }
});
