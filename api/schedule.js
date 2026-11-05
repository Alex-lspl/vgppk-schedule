'use strict';

const { buildSchedule } = require('../lib/buildSchedule');
const { refreshIntervalSeconds } = require('../lib/refreshWindow');

// GET /api/schedule?page=bg203
// Ответ кэшируется на CDN Vercel: 30 минут в учебные часы, 2 часа в остальное время
// (см. lib/refreshWindow.js) — сайт колледжа опрашивается не чаще этого, сколько бы
// людей ни открыло страницу одновременно. Правка из админки (если есть на эту неделю)
// попадает в тот же кэшируемый ответ, поэтому может показаться не сразу — кнопка
// «Обновить» на странице сайта кэш обходит и подтягивает правку немедленно.
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
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: e.message });
  }
};
