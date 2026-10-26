'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { detect, applyMarks, parseCollegeTimestamp, snapshotOf } = require('../lib/changes');
const { lesson, groupSchedule } = require('./helpers/fakes');

const NOW = new Date('2026-10-26T10:00:00Z');

const make = (extra = {}, updated = '26.10.2026 12:30') => {
  const data = groupSchedule('841', (weeks) => {
    weeks[0].days[0].lessons.push(lesson(1, 'Безопасность', 'Семичев Е.А.', '129'));
    weeks[0].days[0].lessons.push(lesson(2, 'Проектирование', 'Алябьев Д.А.', '241', extra));
  });
  data.updated = updated;
  return data;
};

test('время колледжа переводится из МСК в UTC', () => {
  assert.strictEqual(parseCollegeTimestamp('26.10.2026 12:30'), '2026-10-26T09:30:00.000Z');
  assert.strictEqual(parseCollegeTimestamp('мусор'), null);
});

test('первая загрузка создаёт снимок без отметок', () => {
  const result = detect(null, make(), NOW);
  assert.strictEqual(result.dirty, true);
  assert.deepStrictEqual(result.entry.marks, {});
});

test('без изменений запись не перезаписывается', () => {
  const first = detect(null, make(), NOW).entry;
  const again = detect(first, make(), NOW);
  assert.strictEqual(again.dirty, false);
  assert.strictEqual(again.entry, first);
});

test('изменённая пара получает отметку со временем обновления колледжа', () => {
  const before = detect(null, make({}, '25.10.2026 10:00'), NOW).entry;
  const changed = make({ room: '300' }, '26.10.2026 12:30');
  const result = detect(before, changed, NOW);
  assert.strictEqual(result.dirty, true);

  applyMarks(changed, result.entry, NOW);
  const [untouched, edited] = changed.weeks[0].days[0].lessons;
  assert.strictEqual(untouched.changedAt, undefined);
  assert.strictEqual(edited.changeSource, 'auto');
  assert.strictEqual(edited.changedAt, '2026-10-26T09:30:00.000Z');
});

test('отметка действует 24 часа', () => {
  const before = detect(null, make(), NOW).entry;
  const changed = make({ room: '300' });
  const entry = detect(before, changed, NOW).entry;

  const later = (hours) => new Date(NOW.getTime() + hours * 3600000);
  const fresh = make({ room: '300' });
  applyMarks(fresh, entry, later(20));
  assert.ok(fresh.weeks[0].days[0].lessons[1].changedAt);

  const expired = make({ room: '300' });
  applyMarks(expired, entry, later(30));
  assert.strictEqual(expired.weeks[0].days[0].lessons[1].changedAt, undefined);
});

test('удаление пары обновляет снимок без новых отметок', () => {
  const before = detect(null, make(), NOW).entry;
  const shorter = groupSchedule('841', (weeks) => {
    weeks[0].days[0].lessons.push(lesson(1, 'Безопасность', 'Семичев Е.А.', '129'));
  });
  const result = detect(before, shorter, NOW);
  assert.strictEqual(result.dirty, true);
  assert.deepStrictEqual(result.entry.marks, {});
  assert.strictEqual(snapshotOf(shorter.weeks)['1']['0'].length, 1);
});
