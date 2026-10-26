'use strict';

const assert = require('node:assert');
const test = require('node:test');
const w = require('../lib/weekCycle');

test('ключ недели и даты по МСК', () => {
  assert.strictEqual(w.weekKeyOf(new Date('2026-10-25T12:00:00Z')), '2026-W43');
  // Воскресенье 22:00 UTC — в Москве уже понедельник следующей недели
  assert.strictEqual(w.weekKeyOf(new Date('2026-10-25T22:00:00Z')), '2026-W44');
  assert.deepStrictEqual(w.weekDates('2026-W44'), [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
  ]);
});

test('переход через границу года и 53-ю неделю', () => {
  assert.strictEqual(w.addWeeks('2026-W52', 1), '2026-W53');
  assert.strictEqual(w.addWeeks('2026-W53', 1), '2027-W01');
  assert.strictEqual(w.weekDates('2027-W01')[0], '2027-01-04');
});

test('чередование недель расписания', () => {
  assert.strictEqual(w.collegeWeekNumberOfKey('2026-W43'), 2);
  assert.strictEqual(w.collegeWeekNumberOfKey('2026-W44'), 1);
  const [cur, next] = w.editableWeeks(new Date('2026-10-21T09:00:00Z'));
  assert.deepStrictEqual([cur.weekKey, cur.number, cur.current], ['2026-W43', 2, true]);
  assert.deepStrictEqual([next.weekKey, next.number, next.current], ['2026-W44', 1, false]);
  assert.strictEqual(w.weekKeyForCollegeWeek(1, new Date('2026-10-21T09:00:00Z')), '2026-W44');
});

test('некорректный ключ недели отклоняется', () => {
  assert.throws(() => w.mondayOfWeekKey('2026-43'));
  assert.strictEqual(w.parseWeekKey('2026-W00'), null);
});
