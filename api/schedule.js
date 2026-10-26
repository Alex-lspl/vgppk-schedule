'use strict';

const { buildSchedule } = require('../lib/buildSchedule');
const { refreshIntervalSeconds } = require('../lib/refreshWindow');
const { version } = require('../package.json');

// GET /api/schedule?page=bg203
// Ответ кэшируется на CDN Vercel: 30 минут в учебные часы, 2 часа в остальное время
// (см. lib/refreshWindow.js), поэтому сайт колледжа опрашивается не чаще, сколько бы
// людей ни открыло страницу одновременно. Ручные правки попадают в тот же кэшируемый
// ответ; кнопка «Обновить» на странице обходит кэш и подтягивает их сразу.
module.exports = async (req, res) => {
  const page = String(req.query.page || 'bg203');

  if (!/^[a-z]{1,3}\d{1,6}$/i.test(page)) {
    res.status(400).json({ error: 'Некорректный параметр page' });
    return;
  }

  try {
    const data = await buildSchedule(page);

    const maxAge = refreshIntervalSeconds();
    res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ ...data, appVersion: version });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: e.message });
  }
};
