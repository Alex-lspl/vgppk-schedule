'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { parseEntitySchedule, parseList } = require('../lib/parse');
const { mockRes } = require('./helpers/http');

const A = (href, text) => `<a href="https://rasp.vgppk.ru/${href}.htm">${text}</a>`;

// Вёрстка воспроизведена по тексту страниц cp831.htm / ca697.htm «Текущего расписания»
const TEACHER_PAGE = `<html><body><h1>Расписание занятий</h1><h1>Преподаватель: Алейникова М.И</h1><table>
<tr><td>День</td><td>Пара</td></tr>
<tr><td>19.10.2026<br>Пн-2 1</td><td></td></tr>
<tr><td>2</td><td>${A('cg121', '511')} ${A('ca697', '359')}<br>${A('j9424', 'Ин язык')}</td></tr>
<tr><td>4</td><td>${A('cg148', '632')} ${A('ca697', '359')}<br>${A('j10556', 'Ин. язык в ПД')}</td></tr>
<tr><td>20.10.2026<br>Вт-2 1</td><td>${A('cg175', '642')} ${A('cg176', '643')} ${A('ca698', '360')}<br>${A('j10580', 'Ин. язык в ПД')} 1 п/г</td></tr>
<tr><td>26.10.2026<br>Пн-1 1</td><td></td></tr>
<tr><td>2</td><td>${A('cg121', '511')} ${A('ca697', '359')}<br>${A('j9424', 'Ин язык')}</td></tr>
</table><p>Обновлено: 15.11.2026 в 17:28.</p></body></html>`;

const ROOM_PAGE = `<html><body><h1>Аудитория: 359</h1><table>
<tr><td>19.10.2026<br>Пн-2 1</td><td></td></tr>
<tr><td>2</td><td>${A('cg121', '511')} ${A('cp831', 'Алейникова М.И')}<br>${A('j9424', 'Ин язык')}</td></tr>
<tr><td>5</td><td>${A('cg148', '632')} ${A('cp831', 'Алейникова М.И')}<br>${A('j10556', 'Ин. язык в ПД')}</td></tr>
</table><p>Обновлено: 15.11.2026 в 17:28.</p></body></html>`;

const lessonsOf = (r, week, day) => r.weeks.find((w) => w.number === week).days[day].lessons;

test('страница преподавателя: группы и кабинет привязаны к паре, даты не попадают в примечания', () => {
  const r = parseEntitySchedule(TEACHER_PAGE);
  assert.strictEqual(r.name, 'Алейникова М.И');
  assert.strictEqual(r.kind, 'teacher');
  assert.strictEqual(r.updated, '15.11.2026 17:28');
  assert.deepStrictEqual(r.weeks.map((w) => w.number), [1, 2], 'недели берутся из суффикса «Пн-2» / «Пн-1»');

  const mon2 = lessonsOf(r, 2, 0);
  assert.deepStrictEqual(mon2.map((l) => [l.pair, l.subject, l.group, l.room, l.note]), [
    [2, 'Ин язык', '511', '359', null],
    [4, 'Ин. язык в ПД', '632', '359', null],
  ]);
  const tue2 = lessonsOf(r, 2, 1)[0];
  assert.strictEqual(tue2.group, '642, 643', 'несколько групп в одной паре');
  assert.strictEqual(tue2.room, '360');
  assert.strictEqual(tue2.note, '1 п/г');
  assert.strictEqual(lessonsOf(r, 1, 0).length, 1);
  assert(!JSON.stringify(r).includes('19.10.2026'), 'дата — не примечание');
});

test('страница аудитории: группа и преподаватель привязаны к паре', () => {
  const r = parseEntitySchedule(ROOM_PAGE);
  assert.strictEqual(r.name, '359');
  assert.strictEqual(r.kind, 'room');
  assert.deepStrictEqual(lessonsOf(r, 2, 0).map((l) => [l.pair, l.group, l.teacher]), [[2, '511', 'Алейникова М.И'], [5, '632', 'Алейникова М.И']]);
});

test('если вёрстка не похожа на расписание — понятная ошибка, а не пустой результат', () => {
  assert.throws(() => parseEntitySchedule('<html><body><h1>Преподаватель: X</h1><p>ничего</p></body></html>'), /вёрстка/);
});

test('списки преподавателей и кабинетов', () => {
  const teachers = parseList(`<a href="cp831.htm">Алейникова М.И</a><a href="https://rasp.vgppk.ru/cp869.htm">Алейникова М.И +</a><a href="cp822.htm">Алябьев Д.А.</a><a href="bp5.htm">не то</a><a href="cp831.htm">дубль</a>`, 'cp');
  assert.deepStrictEqual(teachers, [
    { page: 'cp831', name: 'Алейникова М.И' },
    { page: 'cp869', name: 'Алейникова М.И +' },
    { page: 'cp822', name: 'Алябьев Д.А.' },
  ]);
  const rooms = parseList(`<a href="ca697.htm">359</a><a href="ca12.htm">12</a><a href="ca100.htm">Спортзал</a>`, 'ca');
  assert.deepStrictEqual(rooms.map((r) => r.name), ['12', '359', 'Спортзал'], 'числа сортируются как числа');
});

/* ---------- API с подменой сети ---------- */

function stubNetwork(pages) {
  const original = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    const path = String(url).replace('https://rasp.vgppk.ru/', '');
    seen.push(path);
    if (!(path in pages)) return { ok: false, status: 404, headers: new Map() };
    return { ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' }, arrayBuffer: async () => Buffer.from(pages[path], 'utf8') };
  };
  return { seen, restore: () => { global.fetch = original; } };
}

test('/api/groups?type=teachers|rooms отдаёт списки', async () => {
  const net = stubNetwork({
    'cp.htm': '<a href="cp831.htm">Алейникова М.И</a>',
    'ca.htm': '<a href="ca697.htm">359</a>',
    'bg.htm': '<a href="bg203.htm">203</a>',
  });
  try {
    const groups = require('../api/groups');
    const get = (type) => { const res = mockRes(); return groups({ method: 'GET', query: type ? { type } : {}, headers: { host: 'site.test' } }, res).then(() => res); };
    assert.deepStrictEqual((await get('teachers')).body.groups, [{ page: 'cp831', name: 'Алейникова М.И' }]);
    assert.deepStrictEqual((await get('rooms')).body.groups, [{ page: 'ca697', name: '359' }]);
    assert.deepStrictEqual((await get()).body.groups, [{ page: 'bg203', name: '203' }]);
    assert.deepStrictEqual(net.seen, ['cp.htm', 'ca.htm', 'bg.htm']);
  } finally { net.restore(); }
});

test('/api/schedule?page=cp… возвращает расписание преподавателя с видом kind', async () => {
  const net = stubNetwork({ 'cp831.htm': TEACHER_PAGE, 'ca697.htm': ROOM_PAGE });
  try {
    const schedule = require('../api/schedule');
    const get = (page) => { const res = mockRes(); return schedule({ method: 'GET', query: { page }, headers: { host: 'site.test' } }, res).then(() => res); };
    const t = await get('cp831');
    assert.strictEqual(t.code, 200);
    assert.strictEqual(t.body.kind, 'teacher');
    assert.strictEqual(t.body.name, 'Алейникова М.И');
    assert(t.body.weekKey && t.body.appVersion, 'те же служебные поля, что и у групп');
    const r = await get('ca697');
    assert.strictEqual(r.body.kind, 'room');
    assert.strictEqual((await get('cp1;drop')).code, 400, 'некорректный адрес отклоняется');
  } finally { net.restore(); }
});
