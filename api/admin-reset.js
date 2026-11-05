'use strict';

const { requireSessionApi } = require('../lib/adminAuth');
const githubStore = require('../lib/githubStore');

const PAGE_RE = /^[a-z]{1,3}\d{1,6}$/i;

// POST /api/admin-reset  { page }
// Удаляет все ручные правки группы: расписание возвращается к данным сайта колледжа
// (с учётом встроенных исправлений из lib/fixes.js).
module.exports = async (req, res) => {
  if (!requireSessionApi(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' });
    return;
  }
  if (!githubStore.isConfigured()) {
    res.status(503).json({ error: 'Хранилище не настроено.' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const page = String(body.page || '');
  if (!PAGE_RE.test(page)) {
    res.status(400).json({ error: 'Некорректная группа' });
    return;
  }

  try {
    await githubStore.updateJson('overrides', (all) => {
      if (!(page in all)) return false;
      delete all[page];
      return true;
    }, `Расписание: сброс правок (${page})`);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
