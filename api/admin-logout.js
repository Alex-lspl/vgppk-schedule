'use strict';

const { clearSessionCookie, isSameOrigin } = require('../lib/adminAuth');

// POST /api/admin-logout
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: 'Запрос отклонён: неверный источник.' });
    return;
  }
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(200).json({ ok: true });
};
