'use strict';

const { hasValidSession } = require('../lib/adminAuth');
const { statsPageHtml } = require('../lib/statsPage');
const stats = require('../lib/stats');

// GET /admin/stats (переписывается в /api/admin-stats через vercel.json) — страница статистики.
// GET /api/admin-stats?json=1 — данные для неё; ?json=1&brief=1 — только число онлайн (для значка в админке).
module.exports = async (req, res) => {
  const wantsJson = req.query && req.query.json === '1';

  if (!hasValidSession(req)) {
    if (wantsJson) {
      res.status(401).json({ error: 'Сессия истекла, войдите заново.' });
    } else {
      res.setHeader('Location', '/admin');
      res.status(302).end();
    }
    return;
  }

  res.setHeader('Cache-Control', 'no-store');

  if (!wantsJson) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(statsPageHtml());
    return;
  }

  if (!stats.isConfigured()) {
    res.status(200).json({ configured: false });
    return;
  }

  try {
    const records = await stats.loadVisitors();
    if (req.query.brief === '1') {
      res.status(200).json({ configured: true, online: stats.countOnline(records) });
      return;
    }
    res.status(200).json({ configured: true, ...stats.buildStats(records) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
