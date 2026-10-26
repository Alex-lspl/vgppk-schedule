'use strict';

/**
 * Каталог групп, предметов и преподавателей для подсказок в админке.
 *
 * Собирается из расписаний всех групп на сайте колледжа и хранится одним файлом
 * data/catalog.json. Пересборка выполняется не чаще раза в сутки при обращении
 * к каталогу; принудительное обновление из админки ограничено интервалом в час.
 *
 * Формат:
 *   { version, checkedAt,
 *     groups:   [{ page, name }],
 *     teachers: [ "Фамилия И.О.", ... ],
 *     subjects: { "<группа>": [{ subject, teachers: [...] }] },
 *     rooms:    { "<группа>": [ "132", ... ] } }
 * Номера аудиторий в сведения о предметах не входят: у одного предмета они меняются.
 */

const githubStore = require('./githubStore');

const CATALOG_VERSION = 1;
const MAX_AGE_MS = 24 * 3600000;
const MIN_FORCE_INTERVAL_MS = 3600000;
const FETCH_CONCURRENCY = 6;
const MAX_FAILED_SHARE = 0.3;
const MAX_ROOMS_PER_GROUP = 40;

const collator = new Intl.Collator('ru', { numeric: true });

function splitTeachers(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function rankByCount(counts) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .map(([name]) => name);
}

/** Сводит расписание одной группы к спискам предметов (с преподавателями) и аудиторий. */
function summarizeGroup(schedule) {
  const subjects = new Map();
  const rooms = new Map();

  for (const week of schedule.weeks) {
    for (const day of week.days) {
      for (const lesson of day.lessons) {
        const subject = String(lesson.subject || '').trim();
        if (!subject) continue;
        if (!subjects.has(subject)) subjects.set(subject, new Map());
        const teacherCounts = subjects.get(subject);
        for (const t of splitTeachers(lesson.teacher)) teacherCounts.set(t, (teacherCounts.get(t) || 0) + 1);
        for (const r of splitTeachers(lesson.room)) rooms.set(r, (rooms.get(r) || 0) + 1);
      }
    }
  }

  return {
    subjects: [...subjects.entries()]
      .map(([subject, counts]) => ({ subject, teachers: rankByCount(counts) }))
      .sort((a, b) => collator.compare(a.subject, b.subject)),
    rooms: rankByCount(rooms).slice(0, MAX_ROOMS_PER_GROUP),
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Собирает каталог. Зависимости передаются параметрами, чтобы функцию можно было
 * проверить без сети. Для групп, страницы которых не удалось загрузить, берутся
 * данные из предыдущей версии каталога; если неудач слишком много, сборка отменяется.
 */
async function buildCatalog({ fetchHtml, parseGroups, parseSchedule, previous = null, now = new Date() }) {
  const groups = parseGroups(await fetchHtml('bg.htm'));
  if (!groups.length) throw new Error('Не удалось получить список групп с сайта колледжа');

  const subjects = {};
  const rooms = {};
  let failed = 0;

  await mapWithConcurrency(groups, FETCH_CONCURRENCY, async (group) => {
    try {
      const summary = summarizeGroup(parseSchedule(await fetchHtml(`${group.page}.htm`)));
      subjects[group.page] = summary.subjects;
      rooms[group.page] = summary.rooms;
    } catch {
      failed += 1;
      if (previous && previous.subjects && previous.subjects[group.page]) {
        subjects[group.page] = previous.subjects[group.page];
        rooms[group.page] = (previous.rooms && previous.rooms[group.page]) || [];
      }
    }
  });

  if (failed > groups.length * MAX_FAILED_SHARE) {
    throw new Error(`Не удалось загрузить расписание для ${failed} из ${groups.length} групп`);
  }

  const teachers = new Set();
  for (const list of Object.values(subjects)) {
    for (const entry of list) entry.teachers.forEach((t) => teachers.add(t));
  }

  return {
    version: CATALOG_VERSION,
    checkedAt: now.toISOString(),
    groups,
    teachers: [...teachers].sort(collator.compare),
    subjects,
    rooms,
  };
}

function isStale(catalog, now) {
  const checked = catalog && Date.parse(catalog.checkedAt);
  return !Number.isFinite(checked) || now.getTime() - checked >= MAX_AGE_MS;
}

let memoryCatalog = null; // запасной вариант, когда хранилище GitHub не настроено
let refreshInFlight = null;

async function readStored() {
  if (!githubStore.isConfigured()) return memoryCatalog;
  const { data } = await githubStore.readJson('catalog');
  return data && data.version === CATALOG_VERSION ? data : null;
}

async function refresh(deps, previous, now) {
  const catalog = await buildCatalog({ ...deps, previous, now });
  if (githubStore.isConfigured()) {
    await githubStore.updateJson('catalog', (stored) => {
      Object.keys(stored).forEach((k) => delete stored[k]);
      Object.assign(stored, catalog);
      return true;
    }, 'Каталог предметов и преподавателей', { compact: true });
  } else {
    memoryCatalog = catalog;
  }
  return catalog;
}

/**
 * Возвращает актуальный каталог. Пересобирает его, если он отсутствует или старше суток;
 * с force — если прошёл минимальный интервал между принудительными обновлениями.
 */
async function getCatalog(deps, { force = false, now = new Date() } = {}) {
  const stored = await readStored();
  const age = stored && Date.parse(stored.checkedAt);
  const forceAllowed = force && (!stored || !Number.isFinite(age) || now.getTime() - age >= MIN_FORCE_INTERVAL_MS);

  if (stored && !isStale(stored, now) && !forceAllowed) return stored;

  if (!refreshInFlight) {
    refreshInFlight = refresh(deps, stored, now).finally(() => { refreshInFlight = null; });
  }
  try {
    return await refreshInFlight;
  } catch (e) {
    if (stored) return stored; // устаревший каталог лучше, чем ошибка
    throw e;
  }
}

module.exports = { buildCatalog, summarizeGroup, getCatalog, isStale, splitTeachers };
