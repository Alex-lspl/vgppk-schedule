'use strict';

/**
 * Обязательный опрос: перед сайтом человеку показывают вопрос (его формулирует администратор),
 * и пока он не напишет ответ нужной длины, дальше не пускают. Ответ запоминается в cookie
 * на заданное число дней, после чего вопрос показывается снова.
 *
 * Cookie подписана и содержит срок и «версию» опроса: кнопка «Спросить всех заново» увеличивает
 * версию, и все прежние cookie перестают действовать. Сами ответы хранятся в Upstash Redis
 * (хеш survey:answers), не больше MAX_ANSWERS последних, и видны администратору на странице
 * статистики, во вкладке «Ответы». К ответу прикладывается короткий код посетителя — тот же,
 * что в списке посетителей, — чтобы можно было сопоставить; IP в ответе не хранится, админка
 * подтягивает его из журнала посетителей по этому коду (см. attachIps).
 */

const crypto = require('crypto');
const auth = require('./adminAuth');
const stats = require('./stats');

const COOKIE_NAME = 'survey_done';
const ANSWERS_KEY = 'survey:answers';
const MAX_ANSWERS = 3000;
const MAX_LENGTH = 500;

const key = () => auth.deriveKey('survey');
const hmac = (k, text) => crypto.createHmac('sha256', k).update(text).digest('hex');

/** Cookie «ответил»: срок хранения — repeatDays суток, внутри подписи ещё и версия опроса. */
function makeCookie(ver, repeatDays, now = Date.now()) {
  const k = key();
  if (!k) throw new Error('Администрирование не настроено');
  const seconds = Math.round(repeatDays * 86400);
  const expiresAt = now + seconds * 1000;
  return `${COOKIE_NAME}=${expiresAt}.${ver}.${hmac(k, `survey:${expiresAt}:${ver}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

function hasAnswered(req, ver, now = Date.now()) {
  const k = key();
  if (!k) return false;
  let raw = '';
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) raw = part.slice(i + 1).trim();
  }
  const [exp, v, sig] = raw.split('.');
  const expiresAt = Number(exp);
  if (!sig || !Number.isFinite(expiresAt) || expiresAt < now || Number(v) !== ver) return false;
  const expected = Buffer.from(hmac(k, `survey:${expiresAt}:${v}`));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * Проверяет ответ: не короче minChars (пробелы по краям и повторы пробелов не считаются), не длиннее
 * MAX_LENGTH, и не «аааааа» — в нём должно быть хотя бы два разных символа.
 */
function validateAnswer(input, minChars) {
  const text = String(input == null ? '' : input).replace(/\s+/g, ' ').trim();
  if (text.length < minChars) return { ok: false, error: `Напишите чуть подробнее — минимум ${minChars} ${minChars === 1 ? 'символ' : 'символов'}.` };
  if (text.length > MAX_LENGTH) return { ok: false, error: `Ответ слишком длинный — не больше ${MAX_LENGTH} символов.` };
  if (minChars > 1 && new Set(text.toLowerCase().replace(/\s/g, '')).size < 2) return { ok: false, error: 'Напишите ответ словами.' };
  return { ok: true, text };
}

/* ---------- Хранение ответов ---------- */

async function saveAnswer({ text, question, vid, country, ua }, now = Date.now()) {
  const r = stats.getClient();
  if (!r) return false;
  const id = `${now.toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const entry = {
    id,
    at: now,
    text,
    question: String(question || '').slice(0, 200),
    code: vid ? stats.shortCode(vid) : '',
    country: /^[A-Z]{2}$/.test(country || '') ? country : null,
    browser: stats.parseBrowser(ua),
    os: stats.parseDevice({ ua }).os,
  };
  await r.hset(ANSWERS_KEY, { [id]: JSON.stringify(entry) });

  // Хранение ограничено: если ответов стало больше предела, самые старые удаляем
  const total = await r.hlen(ANSWERS_KEY);
  if (total > MAX_ANSWERS) {
    const all = await loadAnswers();
    const extra = all.slice(MAX_ANSWERS).map((a) => a.id);
    if (extra.length) await r.hdel(ANSWERS_KEY, ...extra);
  }
  return true;
}

/** Все ответы, новые сверху. */
async function loadAnswers() {
  const r = stats.getClient();
  if (!r) return [];
  const raw = (await r.hgetall(ANSWERS_KEY)) || {};
  const list = [];
  for (const value of Object.values(raw)) {
    try { list.push(typeof value === 'string' ? JSON.parse(value) : value); } catch { /* повреждённая запись */ }
  }
  return list.filter((a) => a && a.id).sort((a, b) => b.at - a.at);
}

/**
 * Добавляет к ответам IP-адрес посетителя (ip, ips, ipCount) — так же, как во вкладке «Посетители».
 * В самом ответе IP не хранится: он берётся из журнала посетителей по короткому коду. Поэтому
 * когда запись посетителя удалена или вышел срок хранения журнала, у ответа IP пустой.
 */
function attachIps(answers, records) {
  const byCode = new Map();
  const perIp = new Map();
  for (const rec of records || []) {
    byCode.set(stats.shortCode(rec.id), rec);
    if (rec.ip) perIp.set(rec.ip, (perIp.get(rec.ip) || 0) + 1);
  }
  return (answers || []).map((a) => {
    const rec = a.code ? byCode.get(a.code) : null;
    return { ...a, ip: (rec && rec.ip) || null, ips: (rec && rec.ips) || [], ipCount: rec && rec.ip ? perIp.get(rec.ip) : 0 };
  });
}

async function deleteAnswers(ids) {
  const r = stats.getClient();
  if (!r) return 0;
  const list = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 5000);
  if (!list.length) return 0;
  return r.hdel(ANSWERS_KEY, ...list);
}

async function clearAnswers() {
  const r = stats.getClient();
  if (!r) return 0;
  const n = await r.hlen(ANSWERS_KEY);
  await r.del(ANSWERS_KEY);
  return n;
}

module.exports = {
  COOKIE_NAME,
  MAX_LENGTH,
  MAX_ANSWERS,
  makeCookie,
  hasAnswered,
  validateAnswer,
  saveAnswer,
  loadAnswers,
  attachIps,
  deleteAnswers,
  clearAnswers,
};
