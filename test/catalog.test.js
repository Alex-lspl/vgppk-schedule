'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { buildCatalog, summarizeGroup, splitTeachers } = require('../lib/catalog');
const { lesson, groupSchedule } = require('./helpers/fakes');

const g841 = groupSchedule('841', (weeks) => {
  weeks[0].days[0].lessons.push(lesson(1, 'Физ культура', 'Буракова М.В.', 'СЗ 3'));
  weeks[1].days[1].lessons.push(lesson(2, 'Физ культура', 'Буракова М.В., Иванов И.И.', 'СЗ 3'));
  weeks[1].days[2].lessons.push(lesson(1, 'Безопасность', 'Семичев Е.А.', '129'));
});
const g842 = groupSchedule('842', (weeks) => {
  weeks[0].days[0].lessons.push(lesson(1, 'Право', 'Петров П.П.', '10'));
});

const extraGroups = [3, 4, 5, 6].map((n) => ({ page: `bg${n}`, name: `84${n}` }));

const deps = (failPages = []) => ({
  fetchHtml: async (path) => {
    if (failPages.includes(path)) throw new Error('недоступно');
    return path;
  },
  parseGroups: () => [{ page: 'bg1', name: '841' }, { page: 'bg2', name: '842' }, ...extraGroups],
  parseSchedule: (path) => (path === 'bg1.htm' ? g841 : g842),
});

test('несколько преподавателей в одной строке разделяются', () => {
  assert.deepStrictEqual(splitTeachers('А.А., Б.Б.'), ['А.А.', 'Б.Б.']);
});

test('сводка группы: предметы с преподавателями и аудитории', () => {
  const s = summarizeGroup(g841);
  const pe = s.subjects.find((x) => x.subject === 'Физ культура');
  assert.deepStrictEqual(pe.teachers, ['Буракова М.В.', 'Иванов И.И.']);
  assert.ok(s.rooms.includes('СЗ 3'));
});

test('каталог — один файл для всех групп', async () => {
  const catalog = await buildCatalog({ ...deps(), now: new Date('2026-10-25T10:00:00Z') });
  assert.strictEqual(catalog.groups.length, 6);
  assert.deepStrictEqual(Object.keys(catalog.subjects).sort(), ['bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'bg6']);
  assert.deepStrictEqual(catalog.teachers, ['Буракова М.В.', 'Иванов И.И.', 'Петров П.П.', 'Семичев Е.А.']);
  assert.strictEqual(catalog.checkedAt, '2026-10-25T10:00:00.000Z');
});

test('при сбое страницы группы берутся прежние данные', async () => {
  const previous = await buildCatalog(deps());
  const next = await buildCatalog({ ...deps(['bg2.htm']), previous });
  assert.deepStrictEqual(next.subjects.bg2, previous.subjects.bg2);
});

test('слишком много сбоев отменяют обновление', async () => {
  await assert.rejects(buildCatalog(deps(['bg1.htm', 'bg2.htm', 'bg3.htm'])), /Не удалось загрузить/);
});
