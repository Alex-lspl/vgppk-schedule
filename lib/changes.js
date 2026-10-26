'use strict';

/**
 * Обнаружение изменений в расписании на сайте колледжа.
 *
 * При каждой загрузке расписание сравнивается с сохранённым снимком. Пары, которых
 * в снимке не было, получают отметку об изменении, действующую 24 часа. Снимок и
 * отметки хранятся по ключу группы в data/changes.json.
 *
 * Формат записи группы:
 *   { updated, snapshot: { "<неделя>": { "<день>": [подпись, ...] } }, marks: { "<неделя>|<день>|<подпись>": ISO-время } }
 */

const { lessonSignature } = require('./lessons');
const { MSK_OFFSET_MS } = require('./weekCycle');

const MARK_TTL_MS = 24 * 3600000;
const MAX_MARKS = 300;

function snapshotOf(weeks) {
  const out = {};
  for (const week of weeks || []) {
    out[week.number] = {};
    for (const day of week.days) out[week.number][day.index] = day.lessons.map(lessonSignature).sort();
  }
  return out;
}

const markKey = (week, day, signature) => `${week}|${day}|${signature}`;

/** Разбирает время вида «21.09.2026 18:23» (МСК) в ISO-строку UTC. */
function parseCollegeTimestamp(text) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5])) - MSK_OFFSET_MS;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isActive(at, now) {
  const ts = Date.parse(at);
  return Number.isFinite(ts) && now.getTime() - ts < MARK_TTL_MS && ts <= now.getTime() + 60000;
}

/**
 * Сравнивает актуальное расписание с сохранённой записью.
 * Возвращает { entry, dirty }: новая запись и признак того, что её нужно сохранить.
 * Первая загрузка (записи нет) только создаёт снимок и отметок не ставит.
 */
function detect(prev, data, now = new Date()) {
  const snapshot = snapshotOf(data.weeks);

  if (!prev || !prev.snapshot) {
    return { entry: { updated: data.updated || null, snapshot, marks: {} }, dirty: true };
  }

  const marks = {};
  for (const [key, at] of Object.entries(prev.marks || {})) {
    if (isActive(at, now)) marks[key] = at;
  }

  // Время изменения: если колледж обновил страницу, берём его отметку, иначе — текущий момент.
  const siteTime = data.updated && data.updated !== prev.updated ? parseCollegeTimestamp(data.updated) : null;
  const at = siteTime && Date.parse(siteTime) <= now.getTime() ? siteTime : now.toISOString();

  let changed = false;
  for (const [week, days] of Object.entries(snapshot)) {
    const before = prev.snapshot[week];
    if (!before) { changed = true; continue; }
    for (const [day, sigs] of Object.entries(days)) {
      const known = new Map();
      for (const s of before[day] || []) known.set(s, (known.get(s) || 0) + 1);
      for (const s of sigs) {
        const left = known.get(s) || 0;
        if (left > 0) { known.set(s, left - 1); continue; }
        marks[markKey(week, day, s)] = at;
        changed = true;
      }
      if (!changed && (before[day] || []).length !== sigs.length) changed = true;
    }
  }

  if (!changed) return { entry: prev, dirty: false };

  const kept = Object.entries(marks).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, MAX_MARKS);
  return {
    entry: { updated: data.updated || null, snapshot, marks: Object.fromEntries(kept) },
    dirty: true,
  };
}

/** Проставляет у изменившихся пар поля changedAt / changeSource. */
function applyMarks(data, entry, now = new Date()) {
  if (!entry || !entry.marks) return data;
  for (const week of data.weeks) {
    for (const day of week.days) {
      for (const lesson of day.lessons) {
        const at = entry.marks[markKey(week.number, day.index, lessonSignature(lesson))];
        if (at && isActive(at, now)) {
          lesson.changedAt = at;
          lesson.changeSource = 'auto';
        }
      }
    }
  }
  return data;
}

module.exports = { MARK_TTL_MS, snapshotOf, parseCollegeTimestamp, detect, applyMarks, isActive };
