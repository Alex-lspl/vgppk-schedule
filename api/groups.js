'use strict';

const { fetchHtml } = require('../lib/fetchPage');
const { parseGroups, parseList } = require('../lib/parse');
const access = require('../lib/access');

// GET /api/groups                  — список групп для выбора в приложении (основное расписание);
// GET /api/groups?type=teachers    — преподаватели (cp.htm), ?type=rooms — аудитории (ca.htm).
// Кэш — 1 час.
const LISTS = {
  teachers: { path: 'cp.htm', prefix: 'cp' },
  rooms: { path: 'ca.htm', prefix: 'ca' },
};

module.exports = async (req, res) => {
  const ev = await access.evaluate(req);
  if (access.blockApi(res, ev)) return;

  try {
    const list = LISTS[String(req.query && req.query.type || '')];
    let groups;
    if (list) groups = parseList(await fetchHtml(list.path), list.prefix);
    else groups = parseGroups(await fetchHtml('bg.htm'));

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
