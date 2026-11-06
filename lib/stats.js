'use strict';

const crypto = require('crypto');

/**
 * Статистика посещений. Данные лежат в Upstash Redis (подключается к проекту в Vercel:
 * Storage → Upstash → Redis, бесплатный тариф). Без подключения всё здесь молча
 * ничего не делает — сайт работает как обычно, просто без статистики.
 *
 * Схема данных (на каждого посетителя — одна запись, живёт 30 дней с последнего захода):
 *   stats:v:<id>   — JSON с IP, страной, устройством, группами и счётчиками по дням
 *   stats:index    — список всех id (отсортированное множество), чтобы можно было всех перебрать
 * На один сигнал уходит 2 команды (прочитать запись и записать её), на нового посетителя — 3.
 */

const ONLINE_MS = 60 * 1000; // «онлайн» = был сигнал за последнюю минуту
const RETENTION_DAYS = 30;
const RETENTION_SEC = RETENTION_DAYS * 24 * 60 * 60;
const INDEX_KEY = 'stats:index';
const vKey = (id) => `stats:v:${id}`;

let client;
let attempted = false;

// Имена переменных зависят от интеграции в Vercel: KV_REST_API_*, UPSTASH_REDIS_REST_*,
// а при выбранном при подключении префиксе — например STORAGE_KV_REST_API_*. Ищем любые по окончанию.
function findRedisEnv(env = process.env) {
  const pairs = [['KV_REST_API_URL', 'KV_REST_API_TOKEN'], ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']];
  for (const [urlName, tokenName] of pairs) {
    if (env[urlName] && env[tokenName]) return { url: env[urlName], token: env[tokenName] };
  }
  for (const key of Object.keys(env)) {
    for (const [urlName, tokenName] of pairs) {
      if (key.endsWith('_' + urlName)) {
        const token = env[key.slice(0, -urlName.length) + tokenName];
        if (env[key] && token) return { url: env[key], token };
      }
    }
  }
  return null;
}

function getClient() {
  if (attempted) return client;
  attempted = true;
  const cfg = findRedisEnv();
  if (!cfg) {
    client = null;
    return null;
  }
  const { Redis } = require('@upstash/redis');
  client = new Redis(cfg);
  return client;
}

// Только для тестов: подставить поддельный Redis.
function setClientForTests(c) {
  client = c;
  attempted = true;
}

function isConfigured() {
  return !!getClient();
}

// Дата «ГГГГ-ММ-ДД» по Москве (МСК = UTC+3 круглый год).
function dayKey(ms) {
  return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function lastDays(n, now) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKey(now - i * 86400000));
  return out;
}

/**
 * Устройство посетителя. По одному User-Agent его не определить надёжно: iPad с iPadOS 13+ и
 * телефон в режиме «версия для ПК» выдают себя за компьютер. Поэтому учитываются ещё
 * подсказки браузера (Sec-CH-UA-*) и данные, которые присылает страница сайта:
 * число точек касания (touch) и меньшая сторона экрана в CSS-пикселях (w).
 */
function parseDevice({ ua = '', chMobile = '', chPlatform = '', touch = 0, width = 0 } = {}) {
  const platform = String(chPlatform).replace(/"/g, '');
  const touchy = Number(touch) > 1;
  const w = Number(width) || 0;
  const hintMobile = String(chMobile) === '?1';

  if (/iPhone|iPod/i.test(ua)) return { kind: 'ios', os: 'iPhone / iOS' };
  if (/iPad/i.test(ua)) return { kind: 'ios', os: 'iPad / iOS' };
  // iPadOS и iPhone в режиме «версия для ПК» представляются как Mac, но у них есть сенсорный экран
  if (/Macintosh|Mac OS X/i.test(ua) && touchy) {
    return { kind: 'ios', os: w && w <= 500 ? 'iPhone / iOS' : 'iPad / iOS' };
  }
  if (/Android/i.test(ua) || platform === 'Android') {
    const tablet = !/Mobile/i.test(ua) && !hintMobile;
    return { kind: 'android', os: tablet ? 'Android (планшет)' : 'Android' };
  }
  // Android в режиме «версия для ПК»: в UA нет слова Android, но экран маленький и сенсорный
  if (/Linux|X11/i.test(ua) && !/CrOS/i.test(ua) && (hintMobile || (touchy && w && w <= 1024))) {
    return { kind: 'android', os: 'Android' };
  }
  if (/CrOS/i.test(ua)) return { kind: 'pc', os: 'ChromeOS / ПК' };
  if (/Windows/i.test(ua)) return { kind: 'pc', os: 'Windows / ПК' };
  if (/Macintosh|Mac OS X/i.test(ua)) return { kind: 'pc', os: 'Mac / ПК' };
  if (/Linux|X11/i.test(ua)) return { kind: 'pc', os: 'Linux / ПК' };
  return { kind: 'other', os: 'Другое' };
}

// Для обратной совместимости: определение только по User-Agent.
const parseUA = (ua = '') => parseDevice({ ua });

// Порядок важен: Edge, Opera, Яндекс и др. тоже содержат слово Chrome, а Chrome — слово Safari.
function parseBrowser(ua = '') {
  if (/YaBrowser/i.test(ua)) return 'Яндекс Браузер';
  if (/Edg(e|A|iOS)?\//i.test(ua)) return 'Edge';
  if (/OPR\/|OPiOS|Opera/i.test(ua)) return 'Opera';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Vivaldi/i.test(ua)) return 'Vivaldi';
  if (/DuckDuckGo/i.test(ua)) return 'DuckDuckGo';
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/VKApp|VKClient/i.test(ua)) return 'VK';
  if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
  if (/CriOS|Chrome|Chromium/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Другой';
}

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|uptime|curl|wget|python|axios|node-fetch|go-http|java\/|vercel|facebookexternalhit|telegrambot|whatsapp\/|discordbot/i;

function isBot(ua) {
  // Слово «bot» встречается и в названиях телефонов (CUBOT) — такие устройства ботами не считаем
  return !ua || BOT_RE.test(String(ua).replace(/cubot/gi, ''));
}

function cleanVid(v) {
  return typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}

// Посетитель = id из браузера (localStorage). Нет id — запасной вариант по IP + браузеру.
function visitorId({ vid, ip, ua }) {
  const good = cleanVid(vid);
  if (good) return good;
  return 'ip-' + crypto.createHash('sha1').update(`${ip || ''}|${ua || ''}`).digest('hex').slice(0, 20);
}

function cleanGroup(g) {
  const s = String(g == null ? '' : g).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40);
  return s || null;
}

function parseRecord(v) {
  if (v == null) return null;
  let obj = v;
  if (typeof v === 'string') {
    try {
      obj = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return obj && typeof obj === 'object' && obj.id ? obj : null;
}

// Один сигнал от страницы. type: 'load' (открыли страницу), 'ping' (всё ещё тут), 'leave' (ушёл).
async function record(info, now = Date.now(), { retentionDays = RETENTION_DAYS } = {}) {
  const r = getClient();
  if (!r) return false;
  const ttl = Math.max(1, Math.round(retentionDays)) * 24 * 60 * 60;

  const key = vKey(info.id);
  let rec = parseRecord(await r.get(key));

  if (info.type === 'leave') {
    if (!rec) return false;
    rec.left = true;
    await r.set(key, JSON.stringify(rec), { ex: ttl });
    return true;
  }

  const isNew = !rec;
  if (!rec) rec = { id: info.id, first: now, ips: [], groups: {}, days: {} };

  const dev = parseDevice({ ua: info.ua, chMobile: info.chMobile, chPlatform: info.chPlatform, touch: info.touch, width: info.width });
  rec.last = now;
  rec.left = false;
  rec.kind = dev.kind;
  rec.os = dev.os;
  rec.browser = parseBrowser(info.ua);
  rec.country = info.country || rec.country || null;
  if (info.ip) {
    rec.ip = info.ip;
    if (!rec.ips.includes(info.ip)) rec.ips = [...rec.ips, info.ip].slice(-5);
  }

  if (info.group) {
    rec.groups[info.group] = now;
    const newest = Object.entries(rec.groups).sort((a, b) => b[1] - a[1]).slice(0, 10);
    rec.groups = Object.fromEntries(newest);
  }

  const today = dayKey(now);
  rec.days[today] = (rec.days[today] || 0) + (info.type === 'load' ? 1 : 0);
  const oldest = dayKey(now - (Math.max(1, Math.round(retentionDays)) - 1) * 86400000);
  for (const d of Object.keys(rec.days)) if (d < oldest) delete rec.days[d];

  await r.set(key, JSON.stringify(rec), { ex: ttl });
  if (isNew) await r.zadd(INDEX_KEY, { score: now, member: info.id });
  return true;
}

/* ---------- Очистка журнала ---------- */

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Удаляет записи указанных посетителей. Возвращает, сколько записей удалено. */
async function deleteVisitors(ids) {
  const r = getClient();
  if (!r) return 0;
  const list = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 5000);
  for (const part of chunks(list, 100)) {
    await r.del(...part.map(vKey));
    await r.zrem(INDEX_KEY, ...part);
  }
  return list.length;
}

/**
 * Удаление по давности последнего визита.
 *  mode 'older'  — всё, что старше days суток;
 *  mode 'recent' — только то, что заходило за последние days суток.
 */
async function purge({ mode, days }, now = Date.now()) {
  const d = Number(days);
  if (!['older', 'recent'].includes(mode) || !Number.isFinite(d) || d < 0) return 0;
  const cutoff = now - d * 86400000;
  const records = await loadVisitors();
  const ids = records
    .filter((rec) => (mode === 'older' ? (rec.last || 0) < cutoff : (rec.last || 0) >= cutoff))
    .map((rec) => rec.id);
  return deleteVisitors(ids);
}

/** Полная очистка: все записи посетителей и счётчики отклонённых сигналов. */
async function clearAll() {
  const r = getClient();
  if (!r) return 0;
  const ids = ((await r.zrange(INDEX_KEY, 0, -1)) || []).map(String);
  for (const part of chunks(ids, 100)) await r.del(...part.map(vKey));
  await r.del(INDEX_KEY, ...skipKeysForCleanup());
  return ids.length;
}

/* ---------- Отклонённые сигналы (для диагностики) ----------
   Если посетитель «не отображается» или нужно понять, кто заходит на сайт, здесь видно, сколько
   сигналов сервер отклонил и по какой причине. Это не журнал: хранятся только счётчики по часам
   и один последний пример на причину, и всё это живёт не дольше 24 часов. */

const SKIP_KEY = 'stats:skips'; // прежний формат (хеш) — только для очистки
const SKIP_LAST_KEY = 'stats:skips:last';
const SKIP_REASONS = ['bot', 'origin', 'admin', 'captcha-shown', 'captcha-passed', 'captcha-failed'];
const SKIP_WINDOW_HOURS = 24;
const HOUR_MS = 3600 * 1000;

const skipKey = (reason, hour) => `stats:skip:${reason}:${hour}`;
const skipLastKey = (reason) => `stats:skip-last:${reason}`;

/** Краткое описание клиента для диагностики: «Яндекс Браузер · Windows / ПК». */
function describeClient(ua) {
  return `${parseBrowser(ua)} · ${parseDevice({ ua }).os}`;
}

async function noteSkip(reason, sample, now = Date.now()) {
  const r = getClient();
  if (!r || !SKIP_REASONS.includes(reason)) return;
  const key = skipKey(reason, Math.floor(now / HOUR_MS));
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, (SKIP_WINDOW_HOURS + 1) * 3600); // часовая корзина живёт чуть дольше окна
  await r.set(skipLastKey(reason), JSON.stringify({ at: now, sample: String(sample || '').slice(0, 300) }), { ex: SKIP_WINDOW_HOURS * 3600 });
}

async function loadSkips(now = Date.now()) {
  const r = getClient();
  if (!r) return [];
  const nowHour = Math.floor(now / HOUR_MS);
  const hours = Array.from({ length: SKIP_WINDOW_HOURS }, (_, i) => nowHour - i);
  const keys = [];
  for (const reason of SKIP_REASONS) {
    for (const h of hours) keys.push(skipKey(reason, h));
    keys.push(skipLastKey(reason));
  }
  const values = (await r.mget(...keys)) || [];
  const per = SKIP_WINDOW_HOURS + 1;
  const out = [];
  SKIP_REASONS.forEach((reason, i) => {
    const slice = values.slice(i * per, (i + 1) * per);
    const count = slice.slice(0, SKIP_WINDOW_HOURS).reduce((sum, v) => sum + (Number(v) || 0), 0);
    if (!count) return;
    let info = slice[SKIP_WINDOW_HOURS];
    if (typeof info === 'string') { try { info = JSON.parse(info); } catch { info = null; } }
    out.push({ reason, count, at: (info && info.at) || null, sample: (info && info.sample) || '' });
  });
  return out.sort((a, b) => b.count - a.count);
}

/** Ключи диагностики, которые нужно убрать при полной очистке (включая прежний формат). */
function skipKeysForCleanup(now = Date.now()) {
  const nowHour = Math.floor(now / HOUR_MS);
  const keys = [SKIP_KEY, SKIP_LAST_KEY];
  for (const reason of SKIP_REASONS) {
    keys.push(skipLastKey(reason));
    for (let i = 0; i <= SKIP_WINDOW_HOURS + 1; i++) keys.push(skipKey(reason, nowHour - i));
  }
  return keys;
}

async function loadVisitors() {
  const r = getClient();
  if (!r) return [];
  const ids = ((await r.zrange(INDEX_KEY, 0, -1)) || []).map(String);
  if (!ids.length) return [];

  const out = [];
  const dead = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const vals = await r.mget(...chunk.map(vKey));
    vals.forEach((v, j) => {
      const rec = parseRecord(v);
      if (rec) out.push(rec);
      else dead.push(chunk[j]);
    });
  }
  // Записи, у которых вышел срок хранения, убираем и из списка
  if (dead.length) await r.zrem(INDEX_KEY, ...dead);
  return out;
}

function isOnline(rec, now) {
  return !rec.left && now - rec.last <= ONLINE_MS;
}

function countOnline(records, now = Date.now()) {
  return records.filter((rec) => isOnline(rec, now)).length;
}

function buildStats(records, now = Date.now()) {
  const days = lastDays(30, now);
  const daily = days.map((date) => ({ date, unique: 0, visits: 0 }));
  const byDate = new Map(daily.map((row) => [row.date, row]));

  const periods = { 7: { uniqueSet: new Set(), visits: 0, newCount: 0 }, 30: { uniqueSet: new Set(), visits: 0, newCount: 0 } };
  const countryCount = new Map();
  const kinds = { pc: 0, ios: 0, android: 0, other: 0 };
  const visitors = [];

  for (const rec of records) {
    const activeDays = Object.keys(rec.days || {}).filter((d) => byDate.has(d));
    for (const d of activeDays) {
      const row = byDate.get(d);
      row.unique += 1;
      row.visits += rec.days[d];
    }

    const firstDay = dayKey(rec.first);
    for (const n of [7, 30]) {
      const window = days.slice(-n);
      const inWindow = activeDays.filter((d) => window.includes(d));
      if (!inWindow.length) continue;
      periods[n].uniqueSet.add(rec.id);
      periods[n].visits += inWindow.reduce((s, d) => s + rec.days[d], 0);
      if (window.includes(firstDay)) periods[n].newCount += 1;
    }

    const code = rec.country || '';
    countryCount.set(code, (countryCount.get(code) || 0) + 1);
    kinds[kinds[rec.kind] === undefined ? 'other' : rec.kind] += 1;

    const groups = Object.entries(rec.groups || {}).sort((a, b) => b[1] - a[1]).map(([name]) => name);
    visitors.push({
      id: rec.id,
      short: String(rec.id).replace(/^ip-/, '').replace(/-/g, '').slice(0, 4).toUpperCase(),
      ip: rec.ip || null,
      ips: rec.ips || [],
      country: code,
      kind: rec.kind || 'other',
      id: rec.id,
      os: rec.os || 'Другое',
      browser: rec.browser || '',
      groups,
      first: rec.first,
      last: rec.last,
      online: isOnline(rec, now),
    });
  }

  visitors.sort((a, b) => b.last - a.last);

  const totalDevices = records.length || 1;
  const pct = (n) => Math.round((n / totalDevices) * 100);
  const outPeriods = {};
  for (const n of [7, 30]) {
    const unique = periods[n].uniqueSet.size;
    const sumDaily = daily.slice(-n).reduce((s, row) => s + row.unique, 0);
    outPeriods[n] = {
      unique,
      visits: periods[n].visits,
      avgPerDay: Math.round(sumDaily / n),
      newPct: unique ? Math.round((periods[n].newCount / unique) * 100) : 0,
    };
  }

  const countries = [...countryCount.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
  const online = visitors.filter((v) => v.online);

  return {
    now,
    online: { count: online.length, list: online },
    today: daily[daily.length - 1].unique,
    week: outPeriods[7].unique,
    month: outPeriods[30].unique,
    daily,
    periods: outPeriods,
    countries,
    countriesTotal: countries.filter((c) => c.code).length,
    devices: {
      pc: pct(kinds.pc),
      ios: pct(kinds.ios),
      android: pct(kinds.android),
      mobile: pct(kinds.ios + kinds.android),
    },
    visitors: visitors.slice(0, 500),
    recent: visitors.slice(0, 8),
  };
}

module.exports = {
  ONLINE_MS,
  isConfigured,
  setClientForTests,
  dayKey,
  parseUA,
  parseDevice,
  parseBrowser,
  findRedisEnv,
  isBot,
  cleanVid,
  cleanGroup,
  visitorId,
  getClient,
  RETENTION_DAYS,
  record,
  deleteVisitors,
  purge,
  clearAll,
  noteSkip,
  loadSkips,
  describeClient,
  loadVisitors,
  countOnline,
  buildStats,
};
