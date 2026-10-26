'use strict';

/**
 * Ручные правки расписания.
 *
 * Хранятся в data/overrides.json по группе и ключу календарной недели:
 *   { "<группа>": { "<2026-W44>": { days: { "0": [пара, ...] }, updatedAt } } }
 * Правки действуют только для текущей и следующей недели; более старые удаляются
 * при очередном сохранении.
 */

const { sanitizeLesson, matchLessons, byPair } = require('./lessons');
const { editableWeeks, weekKeyForCollegeWeek } = require('./weekCycle');

/** Приводит запись группы к формату «ключ недели → правки», в том числе старый формат. */
function normalizePageEntry(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (typeof raw.weekKey === 'string' && raw.days && typeof raw.days === 'object') {
    return { [raw.weekKey]: { days: raw.days } };
  }
  return raw;
}

function sanitizeDays(input) {
  const days = {};
  if (!input || typeof input !== 'object') return days;
  for (const [key, value] of Object.entries(input)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > 6 || !Array.isArray(value)) continue;
    days[idx] = value.map(sanitizeLesson).filter(Boolean).sort(byPair);
  }
  return days;
}

/**
 * Определяет, какие пары действительно изменены вручную, и проставляет отметки.
 *   previous — пары, уже сохранённые ранее для этого дня (или null);
 *   base     — пары, как они приходят с сайта колледжа;
 *   next     — пары, отправленные из админки.
 * Пара, совпавшая с прежней правкой, сохраняет прежнее время изменения; совпавшая
 * с расписанием колледжа — остаётся без отметки; остальные получают текущее время.
 */
function markManualChanges(previous, base, next, now = new Date()) {
  const prevMatches = matchLessons(previous || [], next);
  const baseMatches = matchLessons(base || [], next);
  return next.map((lesson, i) => {
    const out = { ...lesson };
    delete out.changedAt;
    delete out.changeSource;
    const before = prevMatches[i];
    if (before && before.changedAt && before.changeSource === 'manual') {
      out.changedAt = before.changedAt;
      out.changeSource = 'manual';
    } else if (!before && !baseMatches[i]) {
      out.changedAt = now.toISOString();
      out.changeSource = 'manual';
    }
    return out;
  });
}

/**
 * Собирает новую запись группы из данных админки.
 *   current — запись группы в хранилище (формат normalizePageEntry);
 *   payload — { "<ключ недели>": { days } } из запроса;
 *   baseByWeek — расписание колледжа: { "<ключ недели>": [ { index, lessons } ] }.
 * Неделя в payload заменяется целиком; недели вне диапазона правок отбрасываются.
 */
function buildPageEntry(current, payload, baseByWeek, now = new Date()) {
  const allowed = new Set(editableWeeks(now).map((w) => w.weekKey));
  const result = {};

  for (const [weekKey, value] of Object.entries(payload || {})) {
    if (!allowed.has(weekKey)) continue;
    const days = sanitizeDays(value && value.days);
    const previousDays = (current[weekKey] && current[weekKey].days) || {};
    const baseDays = baseByWeek[weekKey] || [];

    const stored = {};
    for (const [idx, lessons] of Object.entries(days)) {
      const base = (baseDays.find((d) => d.index === Number(idx)) || {}).lessons || [];
      stored[idx] = markManualChanges(previousDays[idx], base, lessons, now);
    }
    if (Object.keys(stored).length) result[weekKey] = { days: stored, updatedAt: now.toISOString() };
  }

  // Недели, которых нет в запросе, сохраняются, если они ещё в допустимом диапазоне.
  for (const [weekKey, value] of Object.entries(current)) {
    if (!(weekKey in (payload || {})) && allowed.has(weekKey)) result[weekKey] = value;
  }
  return result;
}

/** Накладывает правки на расписание: для каждой недели берётся запись её календарной недели. */
function applyOverrides(data, pageEntry, now = new Date()) {
  const entry = normalizePageEntry(pageEntry);
  let applied = false;
  for (const week of data.weeks) {
    const key = weekKeyForCollegeWeek(week.number, now);
    week.weekKey = key;
    const days = key && entry[key] && entry[key].days;
    if (!days) continue;
    for (const [idx, lessons] of Object.entries(days)) {
      const day = week.days[Number(idx)];
      if (day && Array.isArray(lessons)) {
        day.lessons = lessons;
        applied = true;
      }
    }
  }
  if (applied) data.hasAdminOverrides = true;
  return data;
}

module.exports = { normalizePageEntry, sanitizeDays, markManualChanges, buildPageEntry, applyOverrides };
