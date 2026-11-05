'use strict';

const { requireSessionApi } = require('../lib/adminAuth');
const { loadCollegeSchedule, loadOverrides } = require('../lib/buildSchedule');
const { editableWeeks } = require('../lib/weekCycle');
const githubStore = require('../lib/githubStore');

const PAGE_RE = /^[a-z]{1,3}\d{1,6}$/i;

// GET /api/admin-data?page=bg203
// Данные для редактора: расписание колледжа и текущие ручные правки по двум неделям,
// доступным для редактирования (текущей и следующей).
module.exports = async (req, res) => {
  if (!requireSessionApi(req, res)) return;

  const page = String(req.query.page || '');
  if (!PAGE_RE.test(page)) {
    res.status(400).json({ error: 'Некорректный параметр page' });
    return;
  }

  try {
    const now = new Date();
    const college = await loadCollegeSchedule(page, now);
    const overrides = await loadOverrides(page);

    const weeks = editableWeeks(now).map((slot) => {
      const source = college.weeks.find((w) => w.number === slot.number);
      const stored = overrides[slot.weekKey] || {};
      return {
        weekKey: slot.weekKey,
        number: slot.number,
        current: slot.current,
        dates: slot.dates,
        days: source ? source.days : [],
        overrideDays: stored.days || {},
      };
    });

    res.status(200).json({
      page,
      name: college.name,
      updated: college.updated,
      fetchedAt: college.fetchedAt,
      storageConfigured: githubStore.isConfigured(),
      weeks,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
