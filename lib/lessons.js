'use strict';

/**
 * Общие операции над парой расписания: нормализация, сравнение и подсчёт отличий.
 *
 * Пара — объект { pair, subject, teacher, room, subgroup, note }.
 * Служебные поля changedAt / changeSource появляются только у изменённых пар.
 */

const LIMITS = { subject: 200, teacher: 100, room: 50, note: 200 };
const CHANGE_SOURCES = new Set(['auto', 'manual']);

const clean = (value, max) => {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};

/** Приводит произвольный объект к допустимой паре или возвращает null. */
function sanitizeLesson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pair = Number(raw.pair);
  const subject = clean(raw.subject, LIMITS.subject);
  if (!Number.isInteger(pair) || pair < 1 || pair > 9 || !subject) return null;

  const lesson = {
    pair,
    subject,
    teacher: clean(raw.teacher, LIMITS.teacher),
    room: clean(raw.room, LIMITS.room),
    subgroup: Number(raw.subgroup) === 1 ? 1 : Number(raw.subgroup) === 2 ? 2 : null,
    note: clean(raw.note, LIMITS.note),
  };

  if (typeof raw.changedAt === 'string' && Number.isFinite(Date.parse(raw.changedAt)) && CHANGE_SOURCES.has(raw.changeSource)) {
    lesson.changedAt = new Date(raw.changedAt).toISOString();
    lesson.changeSource = raw.changeSource;
  }
  return lesson;
}

/** Строка, однозначно описывающая содержимое пары (без служебных полей). */
function lessonSignature(l) {
  const part = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
  return [l.pair, l.subject, l.teacher, l.room, l.subgroup, l.note].map(part).join('|');
}

/**
 * Сопоставляет новые пары со старыми по содержимому (с учётом повторов).
 * Возвращает массив той же длины, что и `next`: найденная старая пара или null.
 */
function matchLessons(prev, next) {
  const pool = new Map();
  for (const l of prev || []) {
    const sig = lessonSignature(l);
    if (!pool.has(sig)) pool.set(sig, []);
    pool.get(sig).push(l);
  }
  return (next || []).map((l) => {
    const bucket = pool.get(lessonSignature(l));
    return bucket && bucket.length ? bucket.shift() : null;
  });
}

const byPair = (a, b) => a.pair - b.pair || a.subject.localeCompare(b.subject, 'ru');

module.exports = { LIMITS, sanitizeLesson, lessonSignature, matchLessons, byPair };
