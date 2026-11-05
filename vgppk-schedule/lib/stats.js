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

// Имена переменных зависят от интеграции в Vercel: KV_REST_API_* или UPSTASH_REDIS_REST_*.
function getClient() {
  if (attempted) return client;
  attempted = true;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    client = null;
    return null;
  }
  const { Redis } = require('@upstash/redis');
  client = new Redis({ url, token });
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

function parseUA(ua = '') {
  if (/iPhone|iPod/i.test(ua)) return { kind: 'ios', os: 'iPhone / iOS' };
  if (/iPad/i.test(ua)) return { kind: 'ios', os: 'iPad / iOS' };
  if (/Android/i.test(ua)) return { kind: 'android', os: 'Android' };
  if (/Windows/i.test(ua)) return { kind: 'pc', os: 'Windows / ПК' };
  if (/Macintosh|Mac OS X/i.test(ua)) return { kind: 'pc', os: 'Mac / ПК' };
  if (/Linux|X11|CrOS/i.test(ua)) return { kind: 'pc', os: 'Linux / ПК' };
  return { kind: 'other', os: 'Другое' };
}

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|uptime|curl|wget|python|axios|node-fetch|go-http|java\/|vercel|facebookexternalhit|telegrambot|whatsapp\/|discordbot/i;

function isBot(ua) {
  return !ua || BOT_RE.test(ua);
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
async function record(info, now = Date.now()) {
  const r = getClient();
  if (!r) return false;

  const key = vKey(info.id);
  let rec = parseRecord(await r.get(key));

  if (info.type === 'leave') {
    if (!rec) return false;
    rec.left = true;
    await r.set(key, JSON.stringify(rec), { ex: RETENTION_SEC });
    return true;
  }

  const isNew = !rec;
  if (!rec) rec = { id: info.id, first: now, ips: [], groups: {}, days: {} };

  const dev = parseUA(info.ua);
  rec.last = now;
  rec.left = false;
  rec.kind = dev.kind;
  rec.os = dev.os;
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
  const oldest = dayKey(now - (RETENTION_DAYS - 1) * 86400000);
  for (const d of Object.keys(rec.days)) if (d < oldest) delete rec.days[d];

  await r.set(key, JSON.stringify(rec), { ex: RETENTION_SEC });
  if (isNew) await r.zadd(INDEX_KEY, { score: now, member: info.id });
  return true;
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
      os: rec.os || 'Другое',
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
  isBot,
  cleanVid,
  cleanGroup,
  visitorId,
  record,
  loadVisitors,
  countOnline,
  buildStats,
};
