'use strict';

/**
 * Эта же логика (ISO-номер недели и чётность → «Неделя 1»/«Неделя 2») продублирована
 * в public/app.js (функции isoWeek/currentWeekNumber, блок CONFIG.oddIsoWeekIs).
 * Если меняешь ODD_ISO_WEEK_IS здесь — поменяй и там, иначе правки из админки
 * будут применяться не к той неделе, что показывает сайт.
 */
const ODD_ISO_WEEK_IS = 2;

// Московское время не переводится, поэтому МСК = UTC+3 круглый год (как и в refreshWindow.js).
function mskDateParts(date = new Date()) {
  const s = new Date(date.getTime() + 3 * 3600000);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth(), day: s.getUTCDate() };
}

function isoWeekOf(year, month, day) {
  const t = new Date(Date.UTC(year, month, day));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}

// Ключ конкретной календарной недели по МСК, например «2026-W39».
// Меняется каждый понедельник — именно на этом держится автосброс правок из админки.
function currentWeekKey(date = new Date()) {
  const p = mskDateParts(date);
  const { year, week } = isoWeekOf(p.year, p.month, p.day);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Какая из веток расписания сайта («Неделя 1» или «Неделя 2») актуальна прямо сейчас.
function currentCollegeWeekNumber(date = new Date()) {
  const p = mskDateParts(date);
  const { week } = isoWeekOf(p.year, p.month, p.day);
  const odd = week % 2 === 1;
  return odd ? ODD_ISO_WEEK_IS : 3 - ODD_ISO_WEEK_IS;
}

module.exports = { ODD_ISO_WEEK_IS, currentWeekKey, currentCollegeWeekNumber };
