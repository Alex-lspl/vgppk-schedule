'use strict';

const { hasValidSession, isSameOrigin } = require('../lib/adminAuth');
const stats = require('../lib/stats');
const access = require('../lib/access');

const VID_COOKIE = 'vid';
const VID_MAX_AGE = 365 * 24 * 60 * 60; // постоянный код посетителя хранится год
const VID_RE = /^[A-Za-z0-9-]{8,64}$/;

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// Адрес намеренно называется нейтрально: слово «track» есть в списках блокировщиков рекламы
// (AdGuard, uBlock, Brave), и такие посетители просто не попадали бы в статистику.
// Публичный эндпоинт, поэтому он ограничен: запросы только с того же origin и не чаще
// LIMIT_PER_MIN с одного IP (состояние в памяти экземпляра — ограничение приблизительное,
// но защищает дневной лимит Redis от случайного шквала и простого флуда).
// Запас большой: в колледже десятки студентов выходят в сеть с одного публичного IP.
const LIMIT_PER_MIN = 300;
const MAX_TRACKED = 5000;
const hits = new Map(); // ip → { count, resetAt }

function overLimit(ip, now = Date.now()) {
  if (hits.size >= MAX_TRACKED) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    if (hits.size >= MAX_TRACKED) hits.clear();
  }
  const rec = hits.get(ip);
  if (!rec || rec.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + 60 * 1000 });
    return false;
  }
  rec.count += 1;
  return rec.count > LIMIT_PER_MIN;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const raw = xff ? String(xff).split(',')[0].trim() : req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '';
  return /^[0-9a-fA-F:.]{3,45}$/.test(raw) ? raw : null;
}

// POST /api/visit  { vid, type: "load" | "ping" | "leave", group, touch, w }
// Страница сайта шлёт сюда короткий сигнал «я тут». Посетителю всегда отвечаем 204 —
// даже если статистика не подключена или что-то пошло не так, сайт от этого страдать не должен.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' });
    return;
  }

  try {
    const ua = String(req.headers['user-agent'] || '');
    const ip = clientIp(req);
    // Не считаем: статистику без подключённого хранилища, чужие origin, ботов, флуд и самого админа.
    // Причина пропуска видна в заголовке X-Visit-Skip ответа (DevTools → Network).
    const skip = !stats.isConfigured() ? 'no-storage'
      : overLimit(ip || 'unknown') ? 'limit'
      : !isSameOrigin(req) ? 'origin'
      : stats.isBot(ua) ? 'bot'
      : hasValidSession(req) ? 'admin'
      : null;
    if (skip) {
      res.setHeader('X-Visit-Skip', skip);
      // Причины, которые стоит видеть в статистике (флуд и отсутствие базы не пишем)
      if (skip === 'origin' || skip === 'bot' || skip === 'admin') {
        const sample = skip === 'origin' ? `origin=${req.headers.origin || '-'} host=${req.headers.host || '-'} | ${ua}`
          : skip === 'bot' ? ua // у бота полезно видеть его настоящее имя
          : stats.describeClient(ua);
        await stats.noteSkip(skip, sample).catch(() => {});
      }
      res.status(204).end();
      return;
    }

    // Сайт выключен или закрыт паролем — человек его не видит, учитывать нечего
    const ev = await access.evaluate(req);
    if (ev.state !== 'open') {
      res.setHeader('X-Visit-Skip', 'gate');
      res.status(204).end();
      return;
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== 'object') body = {};

    // Постоянный код посетителя. Главный — cookie: она остаётся при смене IP (VPN, Wi-Fi ↔ мобильная
    // сеть), поэтому человек остаётся одним и тем же без регистрации. Если cookie нет (первый заход
    // или они отключены), берём код, который сайт хранит в браузере; новый заводим только в крайнем случае.
    const fromCookie = readCookie(req, VID_COOKIE);
    const vid = VID_RE.test(fromCookie) ? fromCookie : VID_RE.test(String(body.vid || '')) ? String(body.vid) : '';
    const id = stats.visitorId({ vid, ip, ua });
    if (vid && vid !== fromCookie) {
      res.setHeader('Set-Cookie', `${VID_COOKIE}=${vid}; Path=/; Max-Age=${VID_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
    }

    const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
    await stats.record({
      id,
      ip,
      country: /^[A-Z]{2}$/.test(country) ? country : null,
      ua,
      chMobile: String(req.headers['sec-ch-ua-mobile'] || '').slice(0, 4),
      chPlatform: String(req.headers['sec-ch-ua-platform'] || '').slice(0, 30),
      touch: Math.min(10, Math.max(0, parseInt(body.touch, 10) || 0)),
      width: Math.min(5000, Math.max(0, parseInt(body.w, 10) || 0)),
      group: stats.cleanGroup(body.group),
      type: ['load', 'ping', 'leave'].includes(body.type) ? body.type : 'ping',
    }, Date.now(), { retentionDays: ev.settings.logs.retentionDays });
    if (vid) {
      res.status(200).json({ vid }); // сайт запоминает этот код у себя
      return;
    }
  } catch (e) {
    console.error('track failed:', e.message);
  }
  res.status(204).end();
};
