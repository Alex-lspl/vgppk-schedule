'use strict';

const { hasValidSession, requireSessionApi } = require('../lib/adminAuth');
const { statsPageHtml, CONTENT_SECURITY_POLICY } = require('../lib/statsPage');
const stats = require('../lib/stats');

// GET /admin/stats (адрес переписывается на /api/admin-stats в vercel.json) — страница статистики.
// GET /api/admin-stats?json=1 — данные для неё; ?json=1&brief=1 — только число онлайн (для карточки в админке).
// Без действующей сессии страница перенаправляет на вход, а JSON-запрос получает 401.
module.exports = async (req, res) => {
  const wantsJson = !!(req.query && req.query.json === '1');

  if (!wantsJson) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!hasValidSession(req)) {
      res.setHeader('Location', '/admin');
      res.status(302).end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.status(200).send(statsPageHtml());
    return;
  }

  if (!requireSessionApi(req, res)) return;

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
    console.error('admin-stats failed:', e.message);
    res.status(502).json({ error: 'Не удалось получить данные статистики.' });
  }
};
