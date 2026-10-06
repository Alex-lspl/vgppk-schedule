'use strict';

const { requireAuth } = require('../lib/adminAuth');
const { adminPageHtml } = require('../lib/adminPage');

// GET /admin (адрес переписывается в /api/admin через vercel.json).
// Без верного логина/пароля браузер получает 401 и сам показывает системное окно входа.
module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(adminPageHtml());
};
