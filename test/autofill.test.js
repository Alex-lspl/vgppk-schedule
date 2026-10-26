'use strict';

const assert = require('node:assert');
const test = require('node:test');
const Autofill = require('../public/admin-assets/autofill.js');

const weeks = [
  { weekKey: '2026-W43', number: 2, dates: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'] },
  { weekKey: '2026-W44', number: 1, dates: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'] },
];
const catalog = {
  subjects: [
    { subject: 'Ин. язык в ПД', teachers: ['Яньшина Н.В.'] },
    { subject: 'Физ культура', teachers: ['Буракова М.В.'] },
  ],
  teachers: ['Яньшина Н.В.', 'Буракова М.В.'],
};

test('промпт для недели содержит правила, предметы и формат', () => {
  const prompt = Autofill.buildPrompt({ groupName: '841', mode: 'week', weeks, subjects: catalog.subjects });
  assert.match(prompt, /Группа: 841/);
  assert.match(prompt, /Ин\. язык в ПД — Яньшина Н\.В\./);
  assert.match(prompt, /Ожидаемый период: 19\.10–25\.10 или 26\.10–01\.11/);
  assert.match(prompt, /"days"/);
});

test('промпт для одного дня фиксирует дату', () => {
  const prompt = Autofill.buildPrompt({ groupName: '841', mode: 'day', date: '2026-10-27', weeks, subjects: [] });
  assert.match(prompt, /Вторник, 27 октября/);
  assert.match(prompt, /"date": "2026-10-27"/);
});

test('ответ разбирается вместе с markdown-обёрткой и сопоставляется с каталогом', () => {
  const text = '```json\n' + JSON.stringify({
    days: [{
      date: '2026-10-26',
      lessons: [
        { pair: '5', subject: 'ин. язык в пд', teacher: null, room: '323', subgroup: '1 подгр.' },
        { pair: 2, subject: 'Неизвестный предмет', teacher: 'Петров П. П.', room: null },
        { pair: 0, subject: 'Некорректная' },
      ],
    }, { date: '2027-05-05', lessons: [] }],
  }) + '\n```';

  const result = Autofill.parseResponse(text, { weeks, mode: 'week', catalog });
  assert.strictEqual(result.days.length, 1);
  const day = result.days[0];
  assert.deepStrictEqual([day.weekKey, day.dayIndex], ['2026-W44', 0]);
  assert.deepStrictEqual(day.lessons.map((l) => l.pair), [2, 5]);

  const english = day.lessons[1];
  assert.deepStrictEqual([english.subject, english.teacher, english.subgroup], ['Ин. язык в ПД', 'Яньшина Н.В.', 1]);
  assert.strictEqual(result.warnings.length, 3);
});

test('в режиме одного дня дата берётся из выбранной', () => {
  const text = JSON.stringify({ days: [{ date: '2026-10-20', lessons: [{ pair: 1, subject: 'Физ культура' }] }] });
  const result = Autofill.parseResponse(text, { weeks, mode: 'day', date: '2026-10-28', catalog });
  assert.strictEqual(result.days[0].date, '2026-10-28');
  assert.strictEqual(result.days[0].lessons[0].teacher, 'Буракова М.В.');
  assert.match(result.warnings[0], /заменена на выбранную/);
});

test('ошибки разбора сообщаются понятно', () => {
  assert.match(Autofill.parseResponse('просто текст', { weeks, catalog }).error, /JSON/);
  assert.match(Autofill.parseResponse('{"days": []}', { weeks, catalog }).error, /days/);
  assert.match(Autofill.parseResponse('{"days":[{"date":"2020-01-01","lessons":[]}]}', { weeks, catalog }).error, /доступными неделями/);
});
