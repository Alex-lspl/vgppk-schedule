'use strict';

const { hasValidSession, isSameOrigin } = require('../lib/adminAuth');
const stats = require('../lib/stats');
const access = require('../lib/access');

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
        const sample = skip === 'origin' ? `origin=${req.headers.origin || '-'} host=${req.headers.host || '-'} | ${ua}` : ua;
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

    const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
    await stats.record({
      id: stats.visitorId({ vid: body.vid, ip, ua }),
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
  } catch (e) {
    console.error('track failed:', e.message);
  }
  res.status(204).end();
};
