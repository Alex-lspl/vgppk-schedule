'use strict';

/**
 * Календарь чередующихся недель («числитель» / «знаменатель»).
 *
 * Расписание колледжа состоит из двух недель, которые идут друг за другом.
 * Какая из них приходится на нечётную ISO-неделю года, задаёт ODD_ISO_WEEK_IS.
 * Клиентский код (public/app.js, CONFIG.oddIsoWeekIs) использует то же значение,
 * поэтому обе константы должны совпадать.
 *
 * Все вычисления выполняются по московскому времени (UTC+3, без перехода на летнее).
 */
const ODD_ISO_WEEK_IS = 2;
const MSK_OFFSET_MS = 3 * 3600000;
const DAY_MS = 86400000;

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

function mskDateParts(date = new Date()) {
  const s = new Date(date.getTime() + MSK_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth(), day: s.getUTCDate() };
}

function isoWeekOf(year, month, day) {
  const t = new Date(Date.UTC(year, month, day));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / DAY_MS + 1) / 7) };
}

/** Ключ календарной недели по МСК, например «2026-W43». Меняется каждый понедельник. */
function weekKeyOf(date = new Date()) {
  const p = mskDateParts(date);
  const { year, week } = isoWeekOf(p.year, p.month, p.day);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function parseWeekKey(key) {
  const m = WEEK_KEY_RE.exec(String(key || ''));
  if (!m) return null;
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  return { year: Number(m[1]), week };
}

/** Понедельник указанной недели в виде Date (UTC, полночь). */
function mondayOfWeekKey(key) {
  const p = parseWeekKey(key);
  if (!p) throw new Error(`Некорректный ключ недели: ${key}`);
  const jan4 = new Date(Date.UTC(p.year, 0, 4));
  const monday1 = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS);
  return new Date(monday1.getTime() + (p.week - 1) * 7 * DAY_MS);
}

function addWeeks(key, count) {
  const monday = mondayOfWeekKey(key);
  const shifted = new Date(monday.getTime() + count * 7 * DAY_MS);
  return weekKeyOf(new Date(shifted.getTime() - MSK_OFFSET_MS + 12 * 3600000));
}

/** Даты семи дней недели (Пн … Вс) в формате YYYY-MM-DD. */
function weekDates(key) {
  const monday = mondayOfWeekKey(key).getTime();
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * DAY_MS).toISOString().slice(0, 10));
}

/** Номер недели расписания (1 или 2) для календарной недели с указанным ключом. */
function collegeWeekNumberOfKey(key) {
  const p = parseWeekKey(key);
  if (!p) throw new Error(`Некорректный ключ недели: ${key}`);
  return p.week % 2 === 1 ? ODD_ISO_WEEK_IS : 3 - ODD_ISO_WEEK_IS;
}

function currentWeekKey(date = new Date()) {
  return weekKeyOf(date);
}

function currentCollegeWeekNumber(date = new Date()) {
  return collegeWeekNumberOfKey(weekKeyOf(date));
}

/**
 * Две недели, доступные для правок: текущая и следующая.
 * Возвращает [{ weekKey, number, current, dates }].
 */
function editableWeeks(date = new Date()) {
  const cur = weekKeyOf(date);
  return [cur, addWeeks(cur, 1)].map((weekKey, i) => ({
    weekKey,
    number: collegeWeekNumberOfKey(weekKey),
    current: i === 0,
    dates: weekDates(weekKey),
  }));
}

/** Ключ ближайшей календарной недели, на которую приходится неделя расписания с номером n. */
function weekKeyForCollegeWeek(n, date = new Date()) {
  const slot = editableWeeks(date).find((w) => w.number === n);
  return slot ? slot.weekKey : null;
}

module.exports = {
  ODD_ISO_WEEK_IS,
  MSK_OFFSET_MS,
  mskDateParts,
  isoWeekOf,
  weekKeyOf,
  currentWeekKey,
  parseWeekKey,
  mondayOfWeekKey,
  addWeeks,
  weekDates,
  collegeWeekNumberOfKey,
  currentCollegeWeekNumber,
  editableWeeks,
  weekKeyForCollegeWeek,
};
