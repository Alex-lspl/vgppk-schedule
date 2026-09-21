'use strict';

const assert = require('node:assert');
const { parseSchedule, parseGroups } = require('../lib/parse');

const lesson = (j, subj, ba, room, bp, teacher) =>
  `<a href="https://rasp.vgppk.ru/j${j}.htm" title="Журнал занятий">${subj}</a> ` +
  `<a href="https://rasp.vgppk.ru/ba${ba}.htm" title="Расписание аудитории">${room}</a><br>` +
  `<a href="https://rasp.vgppk.ru/bp${bp}.htm" title="Расписание преподавателя">${teacher}</a>`;

// Вариант 1: таблица
const asTable = `<html><body><h1>Группа: 841</h1>
<ul><li>1</li><li>2</li></ul>
<table>
<tr><th>День</th><th>Пара</th><th>Неделя 1</th></tr>
<tr><td rowspan="6">Пн</td><td>1</td><td>${lesson(10620, 'ГрафДизаин и Мультимедиа', 626, '132', 792, 'Семичева А.Г.')}</td></tr>
<tr><td>2</td><td></td></tr>
<tr><td>3</td><td>${lesson(10786, 'Кураторский час', 618, '121', 807, 'Шарейко В.В.')}</td></tr>
<tr><td>4</td><td>${lesson(10669, 'Физ культура', 654, 'СЗ 3', 515, 'Буракова М.В.')}
 <br>1 подгр.</td></tr>
<tr><td>5</td><td></td></tr>
<tr><td>6</td><td></td></tr>
<tr><td rowspan="2">Вт</td><td>1</td><td></td></tr>
<tr><td>2</td><td>${lesson(10668, 'Проектирование', 703, '241', 822, 'Алябьев Д.А.')}</td></tr>
<tr><th>День</th><th>Пара</th><th>Неделя 2</th></tr>
<tr><td rowspan="1">Пн</td><td>1</td><td>${lesson(10664, 'Безопасность', 624, '129', 791, 'Семичев Е.А.')}</td></tr>
</table>
<p>Обновлено: 21.09.2026 в 18:23.</p>
<a href="https://vgppk.obrvrn.ru">Сайт колледжа</a></body></html>`;

// Вариант 2: список, «Пн 1» одной строкой
const asList = `<html><body><h1>Группа: 841</h1><ul>
<li>1 2</li>
<li>День Пара Неделя 1</li>
<li>Пн 1 ${lesson(10620, 'ГрафДизаин и Мультимедиа', 626, '132', 792, 'Семичева А.Г.')}</li>
<li>2</li>
<li>3 ${lesson(10786, 'Кураторский час', 618, '121', 807, 'Шарейко В.В.')}</li>
<li>4 ${lesson(10669, 'Физ культура', 654, 'СЗ 3', 515, 'Буракова М.В.')}<br>1 подгр.</li>
<li>Вт 1</li>
<li>2 ${lesson(10668, 'Проектирование', 703, '241', 822, 'Алябьев Д.А.')}</li>
<li>День Пара Неделя 2</li>
<li>Пн 1 ${lesson(10664, 'Безопасность', 624, '129', 791, 'Семичев Е.А.')}</li>
</ul>
<p>Обновлено: 21.09.2026 в 18:23.</p></body></html>`;

for (const [label, html] of [['table', asTable], ['list', asList]]) {
  const r = parseSchedule(html);
  assert.strictEqual(r.name, '841', label);
  assert.strictEqual(r.updated, '21.09.2026 18:23', label);
  assert.deepStrictEqual(r.weeks.map((w) => w.number), [1, 2], label);

  const w1 = r.weeks[0].days;
  assert.strictEqual(w1.length, 7, label);
  assert.deepStrictEqual(w1[0].lessons.map((l) => l.pair), [1, 3, 4], label);
  assert.deepStrictEqual(w1[0].lessons[0], {
    pair: 1, subject: 'ГрафДизаин и Мультимедиа', room: '132', teacher: 'Семичева А.Г.', subgroup: null, note: null,
  }, label);
  assert.strictEqual(w1[0].lessons[2].room, 'СЗ 3', label);
  assert.strictEqual(w1[0].lessons[2].note, '1 подгр.', label);
  assert.strictEqual(w1[1].lessons.length, 1, label);
  assert.strictEqual(w1[1].lessons[0].pair, 2, label);
  assert.strictEqual(r.weeks[1].days[0].lessons[0].subject, 'Безопасность', label);
  console.log(`ok: ${label}`);
}

// Битая страница -> понятная ошибка
assert.throws(() => parseSchedule('<html><body><p>Ошибка 500</p></body></html>'), /Не удалось найти расписание/);
console.log('ok: broken page');

// Список групп
const groups = parseGroups(`<a href="bg.htm">По группам</a>
<a href="https://rasp.vgppk.ru/bg203.htm">841</a><a href="bg10.htm">101</a><a href="bp5.htm">Иванов</a>`);
assert.deepStrictEqual(groups, [{ page: 'bg10', name: '101' }, { page: 'bg203', name: '841' }]);
console.log('ok: groups');

// windows-1251 действительно декодируется в этой версии Node
const cp1251 = Buffer.from([0xD0, 0xE0, 0xF1, 0xEF, 0xE8, 0xF1, 0xE0, 0xED, 0xE8, 0xE5]);
assert.strictEqual(new TextDecoder('windows-1251').decode(cp1251), 'Расписание');
console.log('ok: windows-1251');

// Исправление подгрупп по английскому (данные как на реальном сайте)
const { applyFixes } = require('../lib/fixes');
const eng = (j, ba, room, bp, teacher) =>
  `<a href="j${j}.htm">Ин. язык в ПД</a> <a href="ba${ba}.htm">${room}</a><br><a href="bp${bp}.htm">${teacher}</a>`;
const engHtml = `<h1>Группа: 841</h1><ul><li>День Пара Неделя 1</li>
<li>Пн 1</li><li>2</li><li>3</li><li>4</li><li>5 ${eng(10606, 640, '323', 620, 'Яньшина Н.В.')}</li><li>6</li>
<li>Вт 1 ${eng(10605, 699, '355', 659, 'Рыжкова Н.И.')}</li><li>2</li></ul>
<p>Обновлено: 21.09.2026 в 18:23.</p>`;

const fixed = applyFixes(parseSchedule(engHtml), 'bg203');
const mon = fixed.weeks[0].days[0].lessons[0];
const tue = fixed.weeks[0].days[1].lessons[0];
assert.deepStrictEqual([mon.subgroup, mon.teacher, mon.room], [2, 'Рыжкова Н.И.', '323']);
assert.deepStrictEqual([tue.subgroup, tue.teacher, tue.room], [1, 'Яньшина Н.В.', '355']);
console.log('ok: english subgroups fixed');

// Другая группа не затрагивается; если пара перенесена — правило молча не срабатывает
const other = applyFixes(parseSchedule(engHtml), 'bg999');
assert.strictEqual(other.weeks[0].days[0].lessons[0].teacher, 'Яньшина Н.В.');
assert.strictEqual(other.weeks[0].days[0].lessons[0].subgroup, null);
console.log('ok: other groups untouched');
