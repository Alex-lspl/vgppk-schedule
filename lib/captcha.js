'use strict';

/**
 * Простая проверка «не робот» без сторонних сервисов: посетителю показывают страницу с кнопкой,
 * по нажатию браузер решает небольшую вычислительную задачу (proof-of-work), сервер проверяет
 * решение и выдаёт cookie на заданное время. Cookie привязана к IP-адресу, поэтому при заходе
 * с нового адреса проверка показывается снова.
 *
 * Что это даёт: отсекает простые скрипты и «глупых» ботов, которые не выполняют JavaScript
 * и не умеют нажимать кнопки, и делает массовый сбор данных дороже. Чего не даёт: защиты от
 * целенаправленного бота с настоящим браузером — для этого нужны внешние капчи вроде Turnstile.
 *
 * Токен задачи подписан сервером и содержит время выдачи и привязку к IP, так что подделать
 * его или решить заранее «впрок» нельзя. Хранить на сервере ничего не нужно.
 */

const crypto = require('crypto');
const auth = require('./adminAuth');
const { clientIp } = require('./rateLimit');

const COOKIE_NAME = 'human_check';
const DIFFICULTY_BITS = 12; // в среднем ~4 000 хешей — доли секунды в браузере
const MIN_AGE_MS = 900; // человек не решит быстрее: заставляем подождать, как живой
const MAX_AGE_MS = 10 * 60 * 1000;

const key = () => auth.deriveKey('human-check');
const hmac = (k, text) => crypto.createHmac('sha256', k).update(text).digest('hex');

/** Метка IP: для IPv4 — адрес целиком, для IPv6 — первые 64 бита (сеть, а не устройство). */
function ipTag(req, k) {
  const ip = clientIp(req);
  const norm = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
  return hmac(k, `ip:${norm}`).slice(0, 16);
}

function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** Выдаёт задачу для текущего посетителя. Возвращает строку-токен. */
function issueChallenge(req, now = Date.now()) {
  const k = key();
  if (!k) throw new Error('Администрирование не настроено');
  const payload = Buffer.from(`${now}.${crypto.randomBytes(12).toString('hex')}.${ipTag(req, k)}`).toString('base64url');
  return `${payload}.${hmac(k, `challenge:${payload}`)}`;
}

/**
 * Проверяет решение. Возвращает { ok: true } или { ok: false, reason }.
 * Причины нужны только для диагностики, посетителю показывается общий текст.
 */
function verifySolution(req, { token, nonce, trusted }, now = Date.now()) {
  const k = key();
  if (!k) return { ok: false, reason: 'not-configured' };
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return { ok: false, reason: 'bad-token' };

  const expected = Buffer.from(hmac(k, `challenge:${payload}`));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return { ok: false, reason: 'bad-signature' };

  const [issuedAt, , tag] = Buffer.from(payload, 'base64url').toString().split('.');
  const age = now - Number(issuedAt);
  if (!Number.isFinite(age) || age < MIN_AGE_MS) return { ok: false, reason: 'too-fast' };
  if (age > MAX_AGE_MS) return { ok: false, reason: 'expired' };
  if (tag !== ipTag(req, k)) return { ok: false, reason: 'other-ip' };
  if (trusted !== true) return { ok: false, reason: 'not-a-click' };

  const nonceStr = String(nonce ?? '');
  if (!/^\d{1,12}$/.test(nonceStr)) return { ok: false, reason: 'bad-nonce' };
  const digest = crypto.createHash('sha256').update(`${token}:${nonceStr}`).digest();
  if (leadingZeroBits(digest) < DIFFICULTY_BITS) return { ok: false, reason: 'bad-work' };
  return { ok: true };
}

/** Cookie «проверку прошёл»: срок и IP внутри подписи. */
function makeCookie(req, ttlHours, now = Date.now()) {
  const k = key();
  if (!k) throw new Error('Администрирование не настроено');
  const seconds = Math.round(ttlHours * 3600);
  const expiresAt = now + seconds * 1000;
  const tag = ipTag(req, k);
  return `${COOKIE_NAME}=${expiresAt}.${tag}.${hmac(k, `human:${expiresAt}:${tag}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

function hasPassed(req, now = Date.now()) {
  const k = key();
  if (!k) return false;
  let raw = '';
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) raw = part.slice(i + 1).trim();
  }
  const [exp, tag, sig] = raw.split('.');
  const expiresAt = Number(exp);
  if (!sig || !Number.isFinite(expiresAt) || expiresAt < now) return false;
  if (tag !== ipTag(req, k)) return false; // зашёл с другого адреса — проверяем заново
  const expected = Buffer.from(hmac(k, `human:${expiresAt}:${tag}`));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  COOKIE_NAME,
  DIFFICULTY_BITS,
  MIN_AGE_MS,
  MAX_AGE_MS,
  issueChallenge,
  verifySolution,
  makeCookie,
  hasPassed,
  leadingZeroBits,
};
