'use strict';

const { hasValidSession, requireSessionApi } = require('../lib/adminAuth');
const { statsPageHtml, CONTENT_SECURITY_POLICY } = require('../lib/statsPage');
const { settingsPageHtml } = require('../lib/settingsPage');
const stats = require('../lib/stats');
const settings = require('../lib/settings');

// Одна функция обслуживает три раздела админки (так мы укладываемся в лимит числа функций):
//   GET  /admin/stats                    — страница статистики;
//   GET  /admin/settings                 — страница настроек сайта (перенаправляется сюда как ?view=settings);
//   GET  /api/admin-stats?json=1         — данные статистики (&brief=1 — только короткая сводка для карточки);
//   GET  /api/admin-stats?json=1&view=settings — текущие настройки;
//   POST /api/admin-stats {action, …}    — изменения: очистка журнала и сохранение настроек.
// Всё, кроме страниц, требует действующей сессии админа; без неё страницы ведут на вход.

function sendPage(req, res, html) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!hasValidSession(req)) {
    res.setHeader('Location', '/admin');
    res.status(302).end();
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.status(200).send(html);
}

async function getSettingsJson(res) {
  const s = await settings.load({ fresh: true });
  res.status(200).json({ configured: stats.isConfigured(), ...settings.publicView(s) });
}

async function getStatsJson(req, res) {
  const s = await settings.load();
  if (!stats.isConfigured()) {
    res.status(200).json({ configured: false });
    return;
  }
  const records = await stats.loadVisitors();
  if (req.query.brief === '1') {
    res.status(200).json({
      configured: true,
      online: stats.countOnline(records),
      maintenance: s.maintenance.enabled,
      restricted: s.access.enabled,
    });
    return;
  }
  const skips = await stats.loadSkips().catch(() => []);
  res.status(200).json({ configured: true, ...stats.buildStats(records), skips, retentionDays: s.logs.retentionDays });
}

async function handlePost(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  if (body.action && String(body.action).startsWith('stats.') && !stats.isConfigured()) {
    res.status(409).json({ error: 'Статистика не подключена: нет хранилища Upstash Redis.' });
    return;
  }

  switch (body.action) {
    case 'stats.delete': {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
      res.status(200).json({ ok: true, deleted: await stats.deleteVisitors(ids) });
      return;
    }
    case 'stats.purge': {
      const days = Number(body.days);
      if (!['older', 'recent'].includes(body.mode) || !Number.isFinite(days) || days < 0 || days > 3650) {
        res.status(400).json({ error: 'Укажите период: «старше» или «за последние» и число дней.' });
        return;
      }
      res.status(200).json({ ok: true, deleted: await stats.purge({ mode: body.mode, days }) });
      return;
    }
    case 'stats.clear': {
      res.status(200).json({ ok: true, deleted: await stats.clearAll() });
      return;
    }
    case 'settings.save': {
      const before = await settings.load({ fresh: true });
      const saved = await settings.update(body.settings);
      // Срок хранения сократили — старые записи удаляем сразу, а не ждём, пока истечёт их срок
      let purged = 0;
      if (saved.logs.retentionDays < before.logs.retentionDays && stats.isConfigured()) {
        purged = await stats.purge({ mode: 'older', days: saved.logs.retentionDays });
      }
      res.status(200).json({ ok: true, purged, ...settings.publicView(saved) });
      return;
    }
    case 'settings.revoke': {
      const saved = await settings.revokeVisitorSessions();
      res.status(200).json({ ok: true, ...settings.publicView(saved) });
      return;
    }
    default:
      res.status(400).json({ error: 'Неизвестное действие.' });
  }
}

module.exports = async (req, res) => {
  const isSettings = req.query && req.query.view === 'settings';
  const wantsJson = !!(req.query && req.query.json === '1');

  try {
    if (req.method === 'POST') {
      if (!requireSessionApi(req, res)) return;
      await handlePost(req, res);
      return;
    }

    if (!wantsJson) {
      sendPage(req, res, isSettings ? settingsPageHtml() : statsPageHtml());
      return;
    }

    if (!requireSessionApi(req, res)) return;
    if (isSettings) await getSettingsJson(res);
    else await getStatsJson(req, res);
  } catch (e) {
    if (e instanceof settings.ValidationError) {
      res.status(400).json({ error: e.message });
      return;
    }
    console.error('admin-stats failed:', e.message);
    res.status(502).json({ error: 'Не удалось выполнить запрос к хранилищу.' });
  }
};
