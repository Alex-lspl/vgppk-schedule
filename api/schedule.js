'use strict';

const { fetchHtml } = require('../lib/fetchPage');
const { parseSchedule } = require('../lib/parse');

// GET /api/schedule?page=bg203
// Ответ кэшируется на CDN Vercel на 10 минут: сайт колледжа опрашивается
// не чаще, чем раз в 10 минут, сколько бы людей ни открыло приложение.
module.exports = async (req, res) => {
  const page = String(req.query.page || 'bg203');

  if (!/^[a-z]{1,3}\d{1,6}$/i.test(page)) {
    res.status(400).json({ error: 'Некорректный параметр page' });
    return;
  }

  try {
    const html = await fetchHtml(`${page}.htm`);
    const data = parseSchedule(html);
    data.page = page;
    data.fetchedAt = new Date().toISOString();

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: e.message });
  }
};
