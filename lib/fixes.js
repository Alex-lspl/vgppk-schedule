'use strict';

/**
 * Ручные исправления расписания.
 *
 * Применяются на сервере после разбора страницы, поэтому попадают и на сайт,
 * и в Android-приложение. Ключ — страница группы (bg203 = группа 841).
 *
 * Правило:
 *   day     — день недели: 0 = Пн, 1 = Вт … 6 = Вс
 *   pair    — номер пары так, как он указан на сайте колледжа
 *   subject — (необязательно) регулярное выражение для названия предмета
 *   week    — (необязательно) номер недели; если не указан, правило для обеих недель
 *   set     — какие поля lesson перезаписать: teacher, room, subgroup, note, subject
 *
 * Если правило ничему не соответствует (пара перенесена или удалена) — оно
 * просто ничего не делает, ошибки не будет.
 */
const FIXES = {
  bg203: [
    // Английский: на сайте преподаватели перепутаны между подгруппами.
    // 1 подгруппа — Яньшина Н.В. (вторник, 1 пара), 2 подгруппа — Рыжкова Н.И. (понедельник, 5 пара).
    { day: 0, pair: 5, subject: /^Ин\. язык/i, set: { subgroup: 2, teacher: 'Рыжкова Н.И.' } },
    { day: 1, pair: 1, subject: /^Ин\. язык/i, set: { subgroup: 1, teacher: 'Яньшина Н.В.' } },
  ],
};

function applyFixes(data, page) {
  const rules = FIXES[page];
  if (!rules || !rules.length) return data;

  for (const week of data.weeks) {
    for (const day of week.days) {
      for (const lesson of day.lessons) {
        for (const rule of rules) {
          if (rule.day !== day.index || rule.pair !== lesson.pair) continue;
          if (rule.week && rule.week !== week.number) continue;
          if (rule.subject && !rule.subject.test(lesson.subject)) continue;
          Object.assign(lesson, rule.set);
        }
      }
    }
  }
  return data;
}

module.exports = { applyFixes, FIXES };
