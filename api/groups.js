'use strict';

const { fetchHtml } = require('../lib/fetchPage');
const { parseGroups } = require('../lib/parse');
const access = require('../lib/access');

// GET /api/groups — список всех групп для выбора в приложении. Кэш — 1 час.
module.exports = async (req, res) => {
  const ev = await access.evaluate(req);
  if (access.blockApi(res, ev)) return;

  try {
    const html = await fetchHtml('bg.htm');
    const groups = parseGroups(html);

    if (ev.gated) {
      res.setHeader('Cache-Control', 'private, max-age=600');
    } else {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.status(200).json({ groups });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: e.message });
  }
};
