'use strict';

const { requireSessionApi } = require('../lib/adminAuth');
const { buildSchedule } = require('../lib/buildSchedule');
const githubStore = require('../lib/githubStore');

// GET /api/admin-data?page=bg203 — только для админки (требует логин/пароль).
// Отдаёт текущее расписание (с уже применённой правкой, если она есть и актуальна)
// и отдельно её «сырые» дни — чтобы форма в админке знала, что уже переопределено.
module.exports = async (req, res) => {
  if (!requireSessionApi(req, res)) return;

  const page = String(req.query.page || 'bg203');
  if (!/^[a-z]{1,3}\d{1,6}$/i.test(page)) {
    res.status(400).json({ error: 'Некорректный параметр page' });
    return;
  }

  try {
    const data = await buildSchedule(page);
    const entry = githubStore.isConfigured() ? await githubStore.getEntry(page) : null;
    const overrideDays = entry && entry.weekKey === data.weekKey ? entry.days : {};

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ...data,
      storageConfigured: githubStore.isConfigured(),
      overrideDays: overrideDays || {},
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: e.message });
  }
};
