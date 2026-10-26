'use strict';

/**
 * Оболочка страницы админки. Стили и скрипты лежат в public/admin-assets и не содержат
 * данных: все данные приходят через API, которое требует действующую сессию.
 * Сама страница отдаётся только после проверки сессии (см. api/admin.js).
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function adminPageHtml() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>Админка расписания</title>
<link rel="icon" href="/icon-32.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600&family=Unbounded:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/admin-assets/admin.css">
</head>
<body>
<div id="app" class="app">
  <noscript>Для работы админки нужен JavaScript.</noscript>
</div>
<script src="/admin-assets/autofill.js"></script>
<script src="/admin-assets/admin.js"></script>
</body>
</html>
`;
}

module.exports = { adminPageHtml, CONTENT_SECURITY_POLICY };
