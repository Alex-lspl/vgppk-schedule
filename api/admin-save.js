'use strict';

const { requireSessionApi } = require('../lib/adminAuth');
const { currentWeekKey } = require('../lib/weekKey');
const githubStore = require('../lib/githubStore');

function sanitizeLesson(l) {
  const pair = Number(l && l.pair);
  const subject = String((l && l.subject) || '').trim().slice(0, 200);
  if (!Number.isInteger(pair) || pair < 1 || pair > 9 || !subject) return null;
  return {
    pair,
    subject,
    teacher: l.teacher ? String(l.teacher).trim().slice(0, 100) || null : null,
    room: l.room ? String(l.room).trim().slice(0, 50) || null : null,
    subgroup: l.subgroup === 1 || l.subgroup === 2 ? l.subgroup : null,
    note: l.note ? String(l.note).trim().slice(0, 200) || null : null,
  };
}

function sanitizeDays(input) {
  const days = {};
  if (!input || typeof input !== 'object') return days;
  for (const [key, value] of Object.entries(input)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > 6 || !Array.isArray(value)) continue;
    days[idx] = value.map(sanitizeLesson).filter(Boolean).sort((a, b) => a.pair - b.pair);
  }
  return days;
}

// POST /api/admin-save  { page, days: { "0": [ {pair, subject, teacher, room, subgroup, note}, ... ] } }
// Заменяет целиком список пар для каждого переданного дня на текущую календарную неделю
// (коммитом в data/overrides.json в GitHub-репозитории). День, которого нет в "days",
// остаётся как в основном расписании.
module.exports = async (req, res) => {
  if (!requireSessionApi(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' });
    return;
  }
  if (!githubStore.isConfigured()) {
    res.status(503).json({ error: 'GitHub не настроен, сохранять некуда — см. README, раздел «Админка».' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const page = String(body.page || '');
  if (!/^[a-z]{1,3}\d{1,6}$/i.test(page)) {
    res.status(400).json({ error: 'Некорректная группа' });
    return;
  }

  const days = sanitizeDays(body.days);
  const weekKey = currentWeekKey();

  try {
    await githubStore.saveEntry(page, weekKey, days);
    res.status(200).json({ ok: true, weekKey, days: Object.keys(days).length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
