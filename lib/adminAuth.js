'use strict';

const crypto = require('crypto');

// Логин и пароль от админки. Чтобы сменить — поменяй значения здесь и залей файл заново.
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'administrator sp42';

// Секрет для подписи сессионной куки (HMAC). Это не пароль и нигде не показывается —
// он просто доказывает, что куку выдал наш сервер, а не подделал кто-то посторонний.
// Если его поменять, все, кто уже вошёл, будут разлогинены — подпись перестанет сходиться.
const SESSION_SECRET = 'vgppk-schedule-admin-session-7f2c9e41';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

function sign(expiresAt) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`admin:${expiresAt}`).digest('hex');
}

// Строка для заголовка Set-Cookie. HttpOnly — куку не видно из JS (защита от XSS),
// Secure — передаётся только по HTTPS, SameSite=Lax — достаточно и не мешает навигации.
function makeSessionCookie() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = `${expiresAt}.${sign(expiresAt)}`;
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  });
  return out;
}

function hasValidSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return false;

  const dot = token.indexOf('.');
  if (dot < 0) return false;

  const expiresAt = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = sign(expiresAt);
  if (expected.length !== sig.length) return false;
  // Сравнение за постоянное время, чтобы подпись нельзя было подобрать по времени ответа.
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

function checkCredentials(login, password) {
  return login === ADMIN_USER && password === ADMIN_PASS;
}

// Для JSON-эндпоинтов (/api/admin-*): если сессии нет — сразу отвечает 401 и возвращает false,
// обработчик в этом случае должен немедленно завершиться.
function requireSessionApi(req, res) {
  if (hasValidSession(req)) return true;
  res.status(401).json({ error: 'Сессия истекла, войдите заново.' });
  return false;
}

module.exports = {
  ADMIN_USER,
  ADMIN_PASS,
  COOKIE_NAME,
  checkCredentials,
  hasValidSession,
  makeSessionCookie,
  clearSessionCookie,
  requireSessionApi,
};
