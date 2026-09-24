'use strict';

const { fetchHtml } = require('../lib/fetchPage');
const { parseSchedule } = require('../lib/parse');
const { applyFixes } = require('../lib/fixes');
const { refreshIntervalSeconds } = require('../lib/refreshWindow');

// GET /api/schedule?page=bg203
// Ответ кэшируется на CDN Vercel. Длительность кэша зависит от московского времени
// (см. lib/refreshWindow.js): в учебные часы — 30 минут, в остальное время — 2 часа.
// Сайт колледжа опрашивается не чаще, чем раз в этот промежуток, сколько бы людей
// ни открыло приложение одновременно.
module.exports = async (req, res) => {
  const page = String(req.query.page || 'bg203');

  if (!/^[a-z]{1,3}\d{1,6}$/i.test(page)) {
    res.status(400).json({ error: 'Некорректный параметр page' });
    return;
  }

  try {
    const html = await fetchHtml(`${page}.htm`);
    const data = applyFixes(parseSchedule(html), page);
    data.page = page;
    data.fetchedAt = new Date().toISOString();

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
