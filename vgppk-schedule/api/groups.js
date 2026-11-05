'use strict';

const { fetchHtml } = require('../lib/fetchPage');
const { parseGroups } = require('../lib/parse');

// GET /api/groups — список всех групп для выбора в приложении. Кэш — 1 час.
module.exports = async (req, res) => {
  try {
    const html = await fetchHtml('bg.htm');
    const groups = parseGroups(html);

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ groups });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: e.message });
  }
};
