'use strict';

/**
 * Решает, пускать ли человека на сайт: режим «сайт не работает» и вход посетителей по паролю.
 * Администратор (с действующей сессией админки) проходит всегда — так его нельзя запереть
 * и он может проверить сайт во время технических работ.
 *
 * Сессия посетителя — подписанная HMAC cookie вида «срок.версия.подпись». Версия берётся из
 * настроек: смена логина или пароля и кнопка «Выйти у всех» увеличивают её, и все выданные
 * ранее cookie перестают действовать. SameSite=Lax, а не Strict: иначе при переходе по ссылке
 * из Telegram cookie не отправлялась бы, и человека каждый раз просили бы войти заново.
 */

const crypto = require('crypto');
const auth = require('./adminAuth');
const settings = require('./settings');

const COOKIE_NAME = 'visitor_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

function sign(key, expiresAt, ver) {
  return crypto.createHmac('sha256', key).update(`visitor:${expiresAt}:${ver}`).digest('hex');
}

function makeCookie(ver) {
  const key = auth.deriveKey('visitor-session');
  if (!key) throw new Error('Администрирование не настроено');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${COOKIE_NAME}=${expiresAt}.${ver}.${sign(key, expiresAt, ver)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function parseCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function hasVisitorSession(req, ver) {
  const key = auth.deriveKey('visitor-session');
  if (!key) return false;
  const [exp, v, sig] = parseCookie(req, COOKIE_NAME).split('.');
  const expiresAt = Number(exp);
  if (!sig || !Number.isFinite(expiresAt) || expiresAt < Date.now() || Number(v) !== ver) return false;
  const expected = Buffer.from(sign(key, expiresAt, ver));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Логин и пароль посетителя; время работы не зависит от того, какое из полей неверно. */
function checkVisitorCredentials(login, password, s) {
  const loginOk = crypto.timingSafeEqual(digest(login), digest(s.access.user));
  const passwordOk = auth.verifyPassword(password, s.access.hash);
  return loginOk && passwordOk;
}

/**
 * Итог проверки запроса:
 *   { state: 'open', settings }         — пускаем;
 *   { state: 'maintenance', settings }  — сайт выключен;
 *   { state: 'login', settings }        — нужен вход по паролю.
 * Режим «сайт не работает» сильнее входа по паролю.
 */
async function evaluate(req) {
  const s = await settings.load();
  const maintenance = s.maintenance.enabled;
  // Без настроенной админки подписывать сессии нечем — вход по паролю тогда не применяется
  const restricted = s.access.enabled && auth.isConfigured();
  if (!maintenance && !restricted) return { state: 'open', gated: false, settings: s };
  if (auth.hasValidSession(req)) return { state: 'open', gated: true, admin: true, settings: s };
  if (maintenance) return { state: 'maintenance', gated: true, settings: s };
  if (hasVisitorSession(req, s.access.ver)) return { state: 'open', gated: true, settings: s };
  return { state: 'login', gated: true, settings: s };
}

/**
 * Для JSON-эндпоинтов сайта (расписание, список групп): если пускать нельзя, отвечает ошибкой
 * и возвращает true — обработчик должен завершиться. Ответ не кэшируется, а клиент по статусу
 * понимает, что нужно перезагрузить страницу (там покажется вход или заглушка).
 */
function blockApi(res, ev) {
  if (ev.state === 'open') return false;
  res.setHeader('Cache-Control', 'no-store');
  if (ev.state === 'maintenance') {
    res.setHeader('Retry-After', '300');
    res.status(503).json({ error: 'Сайт временно не работает', maintenance: true });
  } else {
    res.status(401).json({ error: 'Нужен вход', auth: true });
  }
  return true;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  makeCookie,
  hasVisitorSession,
  checkVisitorCredentials,
  evaluate,
  blockApi,
};
