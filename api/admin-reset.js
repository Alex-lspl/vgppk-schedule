'use strict';

const { requireSessionApi } = require('../lib/adminAuth');
const githubStore = require('../lib/githubStore');

// POST /api/admin-reset  { page }
// Убирает правки для этой группы — расписание возвращается к тому, что реально
// на сайте колледжа (+ встроенные исправления из lib/fixes.js).
module.exports = async (req, res) => {
  if (!requireSessionApi(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' });
    return;
  }
  if (!githubStore.isConfigured()) {
    res.status(503).json({ error: 'GitHub не настроен.' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const page = String(body.page || '');
  if (!/^[a-z]{1,3}\d{1,6}$/i.test(page)) {
    res.status(400).json({ error: 'Некорректная группа' });
    return;
  }

  try {
    await githubStore.deleteEntry(page);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
