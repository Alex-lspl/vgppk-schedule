'use strict';

/**
 * Аутентификация администратора.
 *
 * Учётные данные не хранятся в коде или репозитории: всё берётся из переменных окружения
 * (значения в настройках хостинга закрыты от посторонних).
 *   ADMIN_USER           — имя администратора;
 *   ADMIN_PASSWORD       — пароль не короче 12 символов;
 *   ADMIN_PASSWORD_HASH  — необязательно: хеш пароля в формате scrypt вместо открытого пароля
 *                          (создаётся командой `npm run admin:setup`), имеет приоритет;
 *   SESSION_SECRET       — необязательно: случайная строка не короче 32 символов для подписи
 *                          сессий; если не задана, ключ выводится из пароля.
 * Пока учётные данные не заданы, вход отключён.
 *
 * Сессия — подписанная HMAC cookie. Ключ подписи зависит от пароля (и секрета, если он задан),
 * поэтому смена пароля завершает все действующие сессии.
 */

const crypto = require('crypto');

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

function settings() {
  const user = process.env.ADMIN_USER || '';
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || '';
  const password = process.env.ADMIN_PASSWORD || '';
  if (!user || (!passwordHash && password.length < MIN_PASSWORD_LENGTH)) return null;

  const explicitSecret = process.env.SESSION_SECRET || '';
  if (explicitSecret && explicitSecret.length < MIN_SECRET_LENGTH) return null;

  // Материал, к которому привязаны сессии: хеш пароля или сам пароль.
  const credential = passwordHash || password;
  const secret = explicitSecret || crypto.createHash('sha256').update(`session:${credential}`).digest('hex');
  return { user, passwordHash, password, credential, secret };
}

function isConfigured() {
  return !!settings();
}

/** Хеш пароля в формате «scrypt$N$r$p$соль$хеш» (соль и хеш — hex). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), hash.toString('hex')].join('$');
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger)) return false;
  try {
    const expected = Buffer.from(parts[5], 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(parts[4], 'hex'), expected.length, { N, r, p });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

/** Проверка логина и пароля; время работы не зависит от того, какое из полей неверно. */
function checkCredentials(login, password) {
  const cfg = settings();
  if (!cfg) return false;
  const loginOk = crypto.timingSafeEqual(digest(login), digest(cfg.user));
  const passwordOk = cfg.passwordHash
    ? verifyPassword(password, cfg.passwordHash)
    : crypto.timingSafeEqual(digest(password), digest(cfg.password));
  return loginOk && passwordOk;
}

function signingKey(cfg) {
  return crypto.createHmac('sha256', cfg.secret).update(cfg.credential).digest();
}

function sign(cfg, expiresAt) {
  return crypto.createHmac('sha256', signingKey(cfg)).update(`admin:${expiresAt}`).digest('hex');
}

const cookieAttributes = 'Path=/; HttpOnly; Secure; SameSite=Strict';

/** Значение заголовка Set-Cookie с новой сессией. */
function makeSessionCookie() {
  const cfg = settings();
  if (!cfg) throw new Error('Администрирование не настроено');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${expiresAt}.${sign(cfg, expiresAt)}; ${cookieAttributes}; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; ${cookieAttributes}; Max-Age=0`;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function hasValidSession(req) {
  const cfg = settings();
  if (!cfg) return false;

  const token = parseCookies(req)[COOKIE_NAME];
  const dot = token ? token.indexOf('.') : -1;
  if (dot < 0) return false;

  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = Buffer.from(sign(cfg, expiresAt));
  const actual = Buffer.from(token.slice(dot + 1));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * Запросы, изменяющие данные, должны приходить с того же origin: так страница
 * стороннего сайта не сможет отправить запрос от имени вошедшего администратора.
 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin' || site === 'none';
}

/**
 * Для JSON-эндпоинтов админки: при отсутствии сессии (или чужом origin у запросов
 * на изменение) отвечает ошибкой и возвращает false — обработчик должен завершиться.
 */
function requireSessionApi(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(req)) {
    res.status(403).json({ error: 'Запрос отклонён: неверный источник.' });
    return false;
  }
  if (hasValidSession(req)) return true;
  res.status(401).json({ error: 'Сессия истекла, войдите заново.' });
  return false;
}

module.exports = {
  COOKIE_NAME,
  MIN_SECRET_LENGTH,
  MIN_PASSWORD_LENGTH,
  isConfigured,
  hashPassword,
  verifyPassword,
  checkCredentials,
  hasValidSession,
  makeSessionCookie,
  clearSessionCookie,
  isSameOrigin,
  requireSessionApi,
};
