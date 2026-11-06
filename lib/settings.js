'use strict';

/**
 * Настройки сайта, которые администратор меняет из админки (/admin/settings):
 * режим «сайт не работает», вход посетителей по паролю и срок хранения журнала посещений.
 *
 * Хранятся в Upstash Redis (тот же, что у статистики) одним ключом — так переключатели
 * действуют сразу, без публикации новой версии. Пароль посетителей — только в виде хеша.
 *
 * Чтение кэшируется в памяти на CACHE_MS, чтобы не обращаться к Redis при каждом запросе;
 * поэтому изменение вступает в силу в течение этого времени (на разных экземплярах функции).
 * Если Redis недоступен, используются последние известные настройки (до STALE_MS),
 * а при их отсутствии сайт остаётся открытым — недоступность базы не должна «класть» сайт.
 */

const stats = require('./stats');
const { hashPassword } = require('./adminAuth');

const KEY = 'site:settings';
const CACHE_MS = 15 * 1000;
const STALE_MS = 10 * 60 * 1000;

const DEFAULT_MESSAGE = 'Идут технические работы. Скоро всё заработает — загляните чуть позже.';
const MAX_MESSAGE = 500;
const MIN_RETENTION = 1;
const MAX_RETENTION = 90;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 100;
const LOGIN_RE = /^[\p{L}\p{N}._@-]{3,40}$/u;

class ValidationError extends Error {}

const defaults = () => ({
  maintenance: { enabled: false, message: DEFAULT_MESSAGE },
  access: { enabled: false, user: '', hash: '', ver: 1 },
  logs: { retentionDays: stats.RETENTION_DAYS },
});

/** Приводит то, что лежит в базе, к полному и корректному виду. */
function normalize(raw) {
  let src = raw;
  if (typeof src === 'string') { try { src = JSON.parse(src); } catch { src = null; } }
  const base = defaults();
  if (!src || typeof src !== 'object') return base;
  const m = src.maintenance || {};
  const a = src.access || {};
  const l = src.logs || {};
  const days = Math.round(Number(l.retentionDays));
  return {
    maintenance: {
      enabled: m.enabled === true,
      message: typeof m.message === 'string' && m.message.trim() ? m.message.slice(0, MAX_MESSAGE) : base.maintenance.message,
    },
    access: {
      enabled: a.enabled === true && !!a.user && !!a.hash,
      user: typeof a.user === 'string' ? a.user : '',
      hash: typeof a.hash === 'string' ? a.hash : '',
      ver: Number.isInteger(a.ver) && a.ver > 0 ? a.ver : 1,
    },
    logs: { retentionDays: days >= MIN_RETENTION && days <= MAX_RETENTION ? days : base.logs.retentionDays },
  };
}

let cache = null; // { value, at }

function resetCache() {
  cache = null;
}

async function load({ fresh = false, now = Date.now() } = {}) {
  const r = stats.getClient();
  if (!r) return defaults();
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.value;
  try {
    const value = normalize(await r.get(KEY));
    cache = { value, at: now };
    return value;
  } catch (e) {
    console.error('settings load failed:', e.message);
    if (cache && now - cache.at < STALE_MS) return cache.value;
    return defaults();
  }
}

/** Что можно показывать в админке: без хеша пароля. */
function publicView(s) {
  return {
    maintenance: { enabled: s.maintenance.enabled, message: s.maintenance.message },
    access: { enabled: s.access.enabled, user: s.access.user, hasPassword: !!s.access.hash },
    logs: { retentionDays: s.logs.retentionDays },
  };
}

/**
 * Применяет к текущим настройкам то, что прислала админка. Разделы необязательны:
 * непереданный раздел не меняется. Бросает ValidationError с понятным текстом.
 */
function applyUpdate(current, input) {
  const next = JSON.parse(JSON.stringify(current));
  const inp = input && typeof input === 'object' ? input : {};

  if (inp.maintenance) {
    const m = inp.maintenance;
    if (m.enabled !== undefined) next.maintenance.enabled = m.enabled === true;
    if (m.message !== undefined) {
      const text = String(m.message).trim();
      if (text.length > MAX_MESSAGE) throw new ValidationError(`Текст на странице заглушки — не длиннее ${MAX_MESSAGE} символов.`);
      next.maintenance.message = text || DEFAULT_MESSAGE;
    }
  }

  if (inp.access) {
    const a = inp.access;
    if (a.user !== undefined) {
      const user = String(a.user).trim();
      if (user && !LOGIN_RE.test(user)) {
        throw new ValidationError('Логин — от 3 до 40 символов: буквы, цифры и знаки . _ - @ (без пробелов).');
      }
      if (user !== next.access.user) next.access.ver += 1; // смена логина завершает все сессии
      next.access.user = user;
    }
    const password = a.password === undefined ? '' : String(a.password);
    if (password) {
      if (password.length < MIN_PASSWORD) throw new ValidationError(`Пароль — не короче ${MIN_PASSWORD} символов.`);
      if (password.length > MAX_PASSWORD) throw new ValidationError(`Пароль — не длиннее ${MAX_PASSWORD} символов.`);
      next.access.hash = hashPassword(password);
      next.access.ver += 1; // смена пароля завершает все сессии
    }
    if (a.enabled !== undefined) next.access.enabled = a.enabled === true;
    if (next.access.enabled && (!next.access.user || !next.access.hash)) {
      throw new ValidationError('Чтобы включить вход по паролю, задайте логин и пароль.');
    }
  }

  if (inp.logs && inp.logs.retentionDays !== undefined) {
    const d = Number(inp.logs.retentionDays);
    if (!Number.isInteger(d) || d < MIN_RETENTION || d > MAX_RETENTION) {
      throw new ValidationError(`Срок хранения журнала — целое число дней от ${MIN_RETENTION} до ${MAX_RETENTION}.`);
    }
    next.logs.retentionDays = d;
  }
  return next;
}

async function write(value) {
  const r = stats.getClient();
  if (!r) throw new ValidationError('Не подключено хранилище Upstash Redis — настройки сохранить некуда.');
  await r.set(KEY, JSON.stringify(value));
  cache = { value, at: Date.now() };
  return value;
}

async function update(input) {
  const current = await load({ fresh: true });
  return write(applyUpdate(current, input));
}

/** «Выйти у всех»: меняет номер версии, и все выданные посетителям сессии перестают действовать. */
async function revokeVisitorSessions() {
  const current = await load({ fresh: true });
  const next = JSON.parse(JSON.stringify(current));
  next.access.ver += 1;
  return write(next);
}

module.exports = {
  KEY,
  DEFAULT_MESSAGE,
  MAX_MESSAGE,
  MIN_RETENTION,
  MAX_RETENTION,
  ValidationError,
  defaults,
  normalize,
  load,
  resetCache,
  publicView,
  applyUpdate,
  update,
  revokeVisitorSessions,
};
