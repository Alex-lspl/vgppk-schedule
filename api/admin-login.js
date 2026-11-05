'use strict';

const auth = require('../lib/adminAuth');
const limiter = require('../lib/rateLimit');

const FAILURE_DELAY_MS = 600;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST /api/admin-login  { login, password }
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' });
    return;
  }
  if (!auth.isSameOrigin(req)) {
    res.status(403).json({ error: 'Запрос отклонён: неверный источник.' });
    return;
  }
  if (!auth.isConfigured()) {
    res.status(503).json({ error: 'Вход отключён: на сервере не заданы параметры администратора.' });
    return;
  }

  const ip = limiter.clientIp(req);
  const state = limiter.check(ip);
  if (!state.allowed) {
    res.setHeader('Retry-After', String(state.retryAfterSec));
    res.status(429).json({ error: 'Слишком много попыток. Повторите позже.' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const login = String(body.login || '').slice(0, 200);
  const password = String(body.password || '').slice(0, 500);

  if (!auth.checkCredentials(login, password)) {
    limiter.recordFailure(ip);
    await sleep(FAILURE_DELAY_MS);
    res.status(401).json({ error: 'Неверный логин или пароль' });
    return;
  }

  limiter.reset(ip);
  res.setHeader('Set-Cookie', auth.makeSessionCookie());
  res.status(200).json({ ok: true });
};
