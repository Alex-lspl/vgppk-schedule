'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { buildPageEntry, applyOverrides, normalizePageEntry, markManualChanges } = require('../lib/overrides');
const { sanitizeLesson } = require('../lib/lessons');
const { lesson, groupSchedule } = require('./helpers/fakes');

const NOW = new Date('2026-10-21T09:00:00Z'); // W43 (неделя 2), следующая W44 (неделя 1)
const WEEK_NOW = '2026-W43';
const WEEK_NEXT = '2026-W44';

const base = (n) => groupSchedule('841', (weeks) => {
  weeks[n - 1].days[0].lessons.push(lesson(1, 'Безопасность', 'Семичев Е.А.', '129'));
});

const baseDays = (n) => base(n).weeks[n - 1].days;

test('санитайзер ограничивает поля и отбрасывает мусор', () => {
  assert.strictEqual(sanitizeLesson({ pair: 12, subject: 'X' }), null);
  assert.strictEqual(sanitizeLesson({ pair: 1, subject: '   ' }), null);
  const ok = sanitizeLesson({ pair: '2', subject: '  Физ   культура ', teacher: '', room: '5', subgroup: '2', changedAt: 'мусор' });
  assert.deepStrictEqual(ok, { pair: 2, subject: 'Физ культура', teacher: null, room: '5', subgroup: 2, note: null });
});

test('новая правка получает ручную отметку, неизменённая пара — нет', () => {
  const next = [
    sanitizeLesson({ pair: 1, subject: 'Безопасность', teacher: 'Семичев Е.А.', room: '129' }),
    sanitizeLesson({ pair: 2, subject: 'Право', teacher: 'Иванов И.И.', room: '12' }),
  ];
  const marked = markManualChanges(null, baseDays(2)[0].lessons, next, NOW);
  assert.strictEqual(marked[0].changedAt, undefined);
  assert.strictEqual(marked[1].changeSource, 'manual');
  assert.strictEqual(marked[1].changedAt, NOW.toISOString());
});

test('повторное сохранение не обновляет время прежней отметки', () => {
  const first = buildPageEntry({}, { [WEEK_NOW]: { days: { 0: [{ pair: 2, subject: 'Право' }] } } }, { [WEEK_NOW]: baseDays(2) }, NOW);
  const later = new Date(NOW.getTime() + 3600000);
  const second = buildPageEntry(first, { [WEEK_NOW]: { days: { 0: [{ pair: 2, subject: 'Право' }] } } }, { [WEEK_NOW]: baseDays(2) }, later);
  assert.strictEqual(second[WEEK_NOW].days[0][0].changedAt, NOW.toISOString());
});

test('недели вне диапазона отбрасываются, остальные сохраняются', () => {
  const current = { [WEEK_NEXT]: { days: { 1: [{ pair: 1, subject: 'Физика', teacher: null, room: null, subgroup: null, note: null }] } } };
  const result = buildPageEntry(current, {
    '2026-W10': { days: { 0: [{ pair: 1, subject: 'Старое' }] } },
    [WEEK_NOW]: { days: { 0: [{ pair: 1, subject: 'Новое' }] } },
  }, { [WEEK_NOW]: baseDays(2), [WEEK_NEXT]: baseDays(1) }, NOW);
  assert.deepStrictEqual(Object.keys(result).sort(), [WEEK_NOW, WEEK_NEXT]);
  assert.ok(!('2026-W10' in result));
});

test('пустой список недели очищает правки', () => {
  const current = { [WEEK_NOW]: { days: { 0: [] } } };
  const result = buildPageEntry(current, { [WEEK_NOW]: { days: {} } }, {}, NOW);
  assert.deepStrictEqual(result, {});
});

test('правки накладываются на нужную календарную неделю', () => {
  const data = groupSchedule('841', (weeks) => {
    weeks[0].days[0].lessons.push(lesson(1, 'Безопасность', null, '129'));
    weeks[1].days[0].lessons.push(lesson(1, 'Графика', null, '132'));
  });
  const entry = { [WEEK_NEXT]: { days: { 0: [{ pair: 3, subject: 'Замена', teacher: null, room: '1', subgroup: null, note: null }] } } };
  applyOverrides(data, entry, NOW);
  // Неделя 1 приходится на следующую календарную неделю (W44) — правка применяется к ней
  assert.strictEqual(data.weeks[0].days[0].lessons[0].subject, 'Замена');
  assert.strictEqual(data.weeks[1].days[0].lessons[0].subject, 'Графика');
  assert.strictEqual(data.weeks[0].weekKey, WEEK_NEXT);
  assert.strictEqual(data.hasAdminOverrides, true);
});

test('старый формат записи читается', () => {
  assert.deepStrictEqual(normalizePageEntry({ weekKey: WEEK_NOW, days: { 0: [] } }), { [WEEK_NOW]: { days: { 0: [] } } });
  assert.deepStrictEqual(normalizePageEntry(null), {});
});
