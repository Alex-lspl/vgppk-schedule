'use strict';

const { hasValidSession } = require('../lib/adminAuth');
const stats = require('../lib/stats');

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const raw = xff ? String(xff).split(',')[0].trim() : req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '';
  return /^[0-9a-fA-F:.]{3,45}$/.test(raw) ? raw : null;
}

// POST /api/track  { vid, type: "load" | "ping" | "leave", group }
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
    // Не считаем: статистику без подключённого хранилища, ботов и самого админа
    if (!stats.isConfigured() || stats.isBot(ua) || hasValidSession(req)) {
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

    const ip = clientIp(req);
    const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
    await stats.record({
      id: stats.visitorId({ vid: body.vid, ip, ua }),
      ip,
      country: /^[A-Z]{2}$/.test(country) ? country : null,
      ua,
      group: stats.cleanGroup(body.group),
      type: ['load', 'ping', 'leave'].includes(body.type) ? body.type : 'ping',
    });
  } catch (e) {
    console.error('track failed:', e.message);
  }
  res.status(204).end();
};
