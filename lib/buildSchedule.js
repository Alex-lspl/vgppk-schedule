'use strict';

const { fetchHtml } = require('./fetchPage');
const { parseSchedule, parseEntitySchedule } = require('./parse');
const { applyFixes } = require('./fixes');
const { currentWeekKey, currentCollegeWeekNumber } = require('./weekCycle');
const { detect, applyMarks } = require('./changes');
const { normalizePageEntry, applyOverrides } = require('./overrides');
const githubStore = require('./githubStore');

/**
 * Определяет изменения на сайте колледжа и проставляет отметки у изменившихся пар.
 * Сбой хранилища не должен ломать выдачу расписания, поэтому ошибки только логируются.
 */
async function markCollegeChanges(page, data, now) {
  if (!githubStore.isConfigured()) return;
  try {
    const { data: all } = await githubStore.readJson('changes');
    let result = detect(all[page], data, now);
    if (result.dirty) {
      await githubStore.updateJson('changes', (stored) => {
        result = detect(stored[page], data, now);
        if (!result.dirty) return false;
        stored[page] = result.entry;
        return true;
      }, `Снимок расписания (${page})`, { compact: true });
    }
    applyMarks(data, result.entry, now);
  } catch (e) {
    console.error('Не удалось обработать отметки об изменениях:', e.message);
  }
}

/** Расписание группы с сайта колледжа (с встроенными исправлениями и отметками изменений). */
async function loadCollegeSchedule(page, now = new Date()) {
  const html = await fetchHtml(`${page}.htm`);
  const data = applyFixes(parseSchedule(html), page);
  data.page = page;
  data.fetchedAt = now.toISOString();
  data.weekKey = currentWeekKey(now);
  data.liveWeekNumber = currentCollegeWeekNumber(now);
  await markCollegeChanges(page, data, now);
  return data;
}

async function loadOverrides(page) {
  if (!githubStore.isConfigured()) return {};
  const { data } = await githubStore.readJson('overrides');
  return normalizePageEntry(data[page]);
}

// Преподаватели (cp123) и аудитории (ca123) — «Текущее расписание» с оригинального сайта, как есть.
// Правки администратора и отметки об изменениях относятся только к группам, здесь их нет.
const ENTITY_KINDS = { cp: 'teacher', ca: 'room' };
const isEntityPage = (page) => /^c[pa]\d+$/i.test(page);

async function loadEntitySchedule(page, now = new Date()) {
  const html = await fetchHtml(`${page}.htm`);
  const data = parseEntitySchedule(html);
  data.kind = ENTITY_KINDS[page.slice(0, 2).toLowerCase()];
  data.page = page;
  data.fetchedAt = now.toISOString();
  data.weekKey = currentWeekKey(now);
  data.liveWeekNumber = currentCollegeWeekNumber(now);
  return data;
}

/** Итоговое расписание для сайта: данные колледжа + ручные правки. */
async function buildSchedule(page, now = new Date()) {
  if (isEntityPage(page)) return loadEntitySchedule(page, now);
  const data = await loadCollegeSchedule(page, now);
  let overrides = {};
  try {
    overrides = await loadOverrides(page);
  } catch (e) {
    console.error('Не удалось прочитать ручные правки:', e.message);
  }
  return applyOverrides(data, overrides, now);
}

module.exports = { buildSchedule, loadCollegeSchedule, loadEntitySchedule, isEntityPage, loadOverrides };
