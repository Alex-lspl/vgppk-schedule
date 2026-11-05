'use strict';

const { hasValidSession, makeSessionCookie, isConfigured } = require('../lib/adminAuth');
const { adminPageHtml, CONTENT_SECURITY_POLICY } = require('../lib/adminPage');
const { loginPageHtml } = require('../lib/loginPage');

// GET /admin (адрес переписывается на /api/admin в vercel.json).
// Без действующей сессии показывает страницу входа, с ней — панель; при этом срок
// сессии продлевается (скользящее окно).
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (!hasValidSession(req)) {
    const notice = isConfigured() ? undefined : 'Вход отключён: на сервере не заданы параметры администратора.';
    res.status(200).send(loginPageHtml(notice));
    return;
  }

  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('Set-Cookie', makeSessionCookie());
  res.status(200).send(adminPageHtml());
};
