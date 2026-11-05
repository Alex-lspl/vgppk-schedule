'use strict';

const { hasValidSession, makeSessionCookie } = require('../lib/adminAuth');
const { adminPageHtml } = require('../lib/adminPage');
const { loginPageHtml } = require('../lib/loginPage');

// GET /admin (адрес переписывается в /api/admin через vercel.json).
// Без действующей сессии показывает страницу логина; с ней — саму панель
// и заодно продлевает сессию ещё на 30 дней (скользящее окно).
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!hasValidSession(req)) {
    res.status(200).send(loginPageHtml());
    return;
  }

  res.setHeader('Set-Cookie', makeSessionCookie());
  res.status(200).send(adminPageHtml());
};
