'use strict';

/**
 * Как часто можно опрашивать сайт колледжа, в зависимости от московского времени.
 *
 * Россия не переводит часы, поэтому московское время — это всегда UTC+3, без исключений.
 * В учебные часы (6:00–17:00 МСК) проверяем чаще, ночью и вечером — реже, чтобы не
 * дёргать сайт колледжа без надобности. Эти же числа отражены в public/app.js
 * (в блоке CONFIG) — если меняешь здесь, поменяй и там.
 */
const MSK_OFFSET_HOURS = 3;

const PEAK_START_HOUR = 6; // с 6:00 МСК…
const PEAK_END_HOUR = 17; // …до 17:00 МСК (не включительно)
const PEAK_INTERVAL_SEC = 30 * 60; // раз в 30 минут
const OFF_PEAK_INTERVAL_SEC = 2 * 60 * 60; // раз в 2 часа

function mskHour(date = new Date()) {
  return (date.getUTCHours() + MSK_OFFSET_HOURS) % 24;
}

function isPeakHour(date = new Date()) {
  const h = mskHour(date);
  return h >= PEAK_START_HOUR && h < PEAK_END_HOUR;
}

function refreshIntervalSeconds(date = new Date()) {
  return isPeakHour(date) ? PEAK_INTERVAL_SEC : OFF_PEAK_INTERVAL_SEC;
}

module.exports = {
  MSK_OFFSET_HOURS,
  PEAK_START_HOUR,
  PEAK_END_HOUR,
  PEAK_INTERVAL_SEC,
  OFF_PEAK_INTERVAL_SEC,
  mskHour,
  isPeakHour,
  refreshIntervalSeconds,
};
