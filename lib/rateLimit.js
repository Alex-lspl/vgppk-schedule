'use strict';

/**
 * Ограничитель неудачных попыток входа по IP-адресу.
 *
 * Состояние хранится в памяти экземпляра функции. В бессерверной среде экземпляров
 * может быть несколько, поэтому ограничение приблизительное и служит дополнением
 * к стойкому хешированию пароля, а не его заменой.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_TRACKED = 5000;

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Создаёт отдельный ограничитель. У входа в админку и у входа посетителей они разные:
 * студенты выходят в сеть с одного публичного IP колледжа, и их ошибки не должны
 * блокировать вход администратору (и наоборот).
 */
function createLimiter({ maxFailures = MAX_FAILURES, windowMs = WINDOW_MS } = {}) {
  const failures = new Map(); // ip → { count, resetAt }

  function prune(now) {
    if (failures.size < MAX_TRACKED) return;
    for (const [ip, rec] of failures) if (rec.resetAt <= now) failures.delete(ip);
    if (failures.size >= MAX_TRACKED) failures.clear();
  }

  return {
    /** Возвращает { allowed, retryAfterSec }. */
    check(ip, now = Date.now()) {
      const rec = failures.get(ip);
      if (!rec || rec.resetAt <= now) return { allowed: true, retryAfterSec: 0 };
      if (rec.count < maxFailures) return { allowed: true, retryAfterSec: 0 };
      return { allowed: false, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) };
    },
    recordFailure(ip, now = Date.now()) {
      prune(now);
      const rec = failures.get(ip);
      if (!rec || rec.resetAt <= now) failures.set(ip, { count: 1, resetAt: now + windowMs });
      else rec.count += 1;
    },
    reset(ip) {
      failures.delete(ip);
    },
  };
}

// Ограничитель входа в админку (используется api/admin-login.js)
const adminLimiter = createLimiter();

module.exports = {
  clientIp,
  createLimiter,
  check: adminLimiter.check,
  recordFailure: adminLimiter.recordFailure,
  reset: adminLimiter.reset,
  MAX_FAILURES,
  WINDOW_MS,
};
