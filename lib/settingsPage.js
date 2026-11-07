'use strict';

const { CONTENT_SECURITY_POLICY } = require('./statsPage');

// HTML-оболочка страницы «Настройки сайта». Саму форму рисует public/admin-assets/settings.js,
// данные приходят из /api/admin-stats?json=1&view=settings (нужна сессия админа).
// Отдаётся с той же строгой CSP, что и статистика: без встроенных скриптов и стилей.
function settingsPageHtml() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#151515">
<title>Настройки сайта</title>
<link rel="icon" href="/icon-32.png" type="image/png">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/admin-assets/stats.css">
<link rel="stylesheet" href="/admin-assets/nav.css">
<link rel="stylesheet" href="/admin-assets/settings.css">
</head>
<body>
<div class="app narrow">
  <header class="topbar">
    <div class="brand">
      <img class="brand-logo" src="/icon-128.png" alt="" width="40" height="40">
      <div>
        <h1>Настройки сайта</h1>
        <div class="sub">Работа сайта, доступ и журнал посещений</div>
      </div>
    </div>
    <a class="btn" href="/admin" id="backLink">← В админку</a>
  </header>

  <div id="notice"></div>
  <main id="view"><div class="loader"><div class="spinner"></div><span>Загружаю настройки…</span></div></main>
</div>
<script src="/admin-assets/nav.js"></script>
<script src="/admin-assets/settings.js"></script>
</body>
</html>
`;
}

module.exports = { settingsPageHtml };
