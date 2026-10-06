'use strict';

const { fetchHtml } = require('./fetchPage');
const { parseSchedule } = require('./parse');
const { applyFixes } = require('./fixes');
const { currentWeekKey, currentCollegeWeekNumber } = require('./weekKey');
const githubStore = require('./githubStore');

// Накладывает правки админки на уже разобранные данные — чистая функция без сети,
// поэтому легко проверяется юнит-тестом.
function applyOverride(data, overrideDays, liveWeekNumber) {
  if (!overrideDays) return data;
  const liveWeek = data.weeks.find((w) => w.number === liveWeekNumber);
  if (!liveWeek) return data;
  for (const [dayIdx, lessons] of Object.entries(overrideDays)) {
    const day = liveWeek.days[Number(dayIdx)];
    if (day && Array.isArray(lessons)) day.lessons = lessons;
  }
  data.hasAdminOverrides = true;
  return data;
}

// Правки действуют, только пока weekKey сохранённой записи совпадает с текущей
// календарной неделей — после понедельника запись сама перестаёт применяться,
// ничего специально удалять для этого не нужно.
async function getCurrentOverrideDays(page, weekKey) {
  if (!githubStore.isConfigured()) return null;
  const entry = await githubStore.getEntry(page);
  if (!entry || entry.weekKey !== weekKey) return null;
  return entry.days || null;
}

async function buildSchedule(page) {
  const html = await fetchHtml(`${page}.htm`);
  const data = applyFixes(parseSchedule(html), page);
  data.page = page;
  data.fetchedAt = new Date().toISOString();

  const weekKey = currentWeekKey();
  const liveWeekNumber = currentCollegeWeekNumber();
  data.weekKey = weekKey;
  data.liveWeekNumber = liveWeekNumber;

  const overrideDays = await getCurrentOverrideDays(page, weekKey);
  return applyOverride(data, overrideDays, liveWeekNumber);
}

module.exports = { buildSchedule, applyOverride, getCurrentOverrideDays };
