'use strict';

const { requireSessionApi } = require('../lib/adminAuth');
const { loadCollegeSchedule } = require('../lib/buildSchedule');
const { buildPageEntry, normalizePageEntry } = require('../lib/overrides');
const { editableWeeks } = require('../lib/weekCycle');
const githubStore = require('../lib/githubStore');

const PAGE_RE = /^[a-z]{1,3}\d{1,6}$/i;

// POST /api/admin-save  { page, weeks: { "<ключ недели>": { days: { "0": [пара, ...] } } } }
// Для каждой переданной недели заменяет правки целиком: переданные дни фиксируются,
// остальные возвращаются к расписанию колледжа. Недели, которых нет в запросе, не затрагиваются.
module.exports = async (req, res) => {
  if (!requireSessionApi(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' });
    return;
  }
  if (!githubStore.isConfigured()) {
    res.status(503).json({ error: 'Хранилище не настроено: сохранять некуда.' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const page = String(body.page || '');
  if (!PAGE_RE.test(page)) {
    res.status(400).json({ error: 'Некорректная группа' });
    return;
  }

  try {
    const now = new Date();
    const college = await loadCollegeSchedule(page, now);
    const baseByWeek = {};
    for (const slot of editableWeeks(now)) {
      const source = college.weeks.find((w) => w.number === slot.number);
      baseByWeek[slot.weekKey] = source ? source.days : [];
    }

    let saved = {};
    await githubStore.updateJson('overrides', (all) => {
      saved = buildPageEntry(normalizePageEntry(all[page]), body.weeks, baseByWeek, now);
      if (Object.keys(saved).length) all[page] = saved;
      else delete all[page];
      return true;
    }, `Расписание: правки (${page})`);

    res.status(200).json({ ok: true, weeks: Object.keys(saved) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
