'use strict';

// HTML-оболочка страницы статистики. Стили и скрипт лежат в public/admin-assets — в них нет
// данных, а сами данные приходят только из /api/admin-stats?json=1, который требует сессию.
// Страница отдаётся с CSP без встроенных скриптов и стилей (см. api/admin-stats.js).

// Как у админки, но дополнительно разрешены флаги стран с публичного CDN.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://cdn.jsdelivr.net",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function statsPageHtml() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#151515">
<title>Статистика посещений</title>
<link rel="icon" href="/icon-32.png" type="image/png">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/admin-assets/stats.css">
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">
      <img class="brand-logo" src="/icon-128.png" alt="" width="40" height="40">
      <div>
        <h1>Статистика посещений</h1>
        <div class="sub">Обновляется автоматически</div>
      </div>
    </div>
    <a class="btn" href="/admin" id="backLink"></a>
  </header>

  <nav class="tabs" aria-label="Разделы статистики">
    <button class="tab active" type="button" data-tab="overview">Обзор</button>
    <button class="tab" type="button" data-tab="visitors">Посетители</button>
    <button class="tab" type="button" data-tab="geo">География</button>
    <button class="tab" type="button" data-tab="cleanup">Очистка</button>
  </nav>

  <div id="notice"></div>
  <div id="flash" role="status" aria-live="polite"></div>
  <main id="view"></main>
</div>
<script src="/admin-assets/stats.js"></script>
</body>
</html>
`;
}

module.exports = { statsPageHtml, CONTENT_SECURITY_POLICY };
