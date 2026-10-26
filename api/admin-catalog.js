'use strict';

const { requireSessionApi } = require('../lib/adminAuth');
const { getCatalog } = require('../lib/catalog');
const { fetchHtml } = require('../lib/fetchPage');
const { parseGroups, parseSchedule } = require('../lib/parse');

// GET /api/admin-catalog[?refresh=1]
// Каталог групп, предметов и преподавателей. Обновляется не чаще раза в сутки;
// параметр refresh допускает принудительное обновление не чаще раза в час.
module.exports = async (req, res) => {
  if (!requireSessionApi(req, res)) return;

  try {
    const catalog = await getCatalog(
      { fetchHtml, parseGroups, parseSchedule },
      { force: req.query.refresh === '1' },
    );
    res.status(200).json(catalog);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
