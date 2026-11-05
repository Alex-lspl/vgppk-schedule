'use strict';

const { checkCredentials, makeSessionCookie } = require('../lib/adminAuth');

// POST /api/admin-login  { login, password }
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const login = String(body.login || '');
  const password = String(body.password || '');

  if (!checkCredentials(login, password)) {
    res.status(401).json({ error: 'Неверный логин или пароль' });
    return;
  }

  res.setHeader('Set-Cookie', makeSessionCookie());
  res.status(200).json({ ok: true });
};
