'use strict';

// Служебные страницы сайта: «Страница не найдена», «Сайт временно не работает» и вход по паролю.
// Все три используют один набор стилей (public/pages.css) и ничего не выполняют в браузере,
// кроме формы входа (public/gate.js): политика безопасности сайта запрещает встроенные скрипты.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shell({ title, body, script = '' }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#151515">
  <meta name="robots" content="noindex, nofollow">
  <title>${esc(title)}</title>
  <link rel="icon" href="/icon-32.png" type="image/png">
  <link rel="apple-touch-icon" href="/icon-180.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600&family=Unbounded:wght@500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/pages.css">
</head>
<body>
  <div class="shell">
    <header class="head">
      <img class="logo" src="/icon-128.png" alt="" width="50" height="50">
      <div>
        <div class="brand">Расписание занятий</div>
        <div class="sub">ГБПОУ ВО «ВГППК»</div>
      </div>
    </header>
${body}
    <footer class="foot">
      <a href="https://t.me/l_SP_Soft_l" target="_blank" rel="noopener noreferrer">Telegram: @l_SP_Soft_l</a>
    </footer>
  </div>
${script}</body>
</html>
`;
}

function notFoundHtml() {
  return shell({
    title: 'Страница не найдена — Расписание ВГППК',
    body: `    <main class="card">
      <div class="code" aria-hidden="true">404</div>
      <h1>Страница не найдена</h1>
      <p>Такой страницы нет. Возможно, ссылка устарела или в адресе опечатка.</p>
      <div class="actions"><a class="btn primary" href="/">На главную</a></div>
    </main>`,
  });
}

function maintenanceHtml(message) {
  return shell({
    title: 'Сайт временно не работает — Расписание ВГППК',
    body: `    <main class="card">
      <div class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.1-.5-.5-2.1z"/></svg>
      </div>
      <h1>Сайт временно не работает</h1>
      <p class="message">${esc(message)}</p>
      <div class="actions"><a class="btn primary" href="/">Обновить страницу</a></div>
    </main>`,
  });
}

function loginHtml() {
  return shell({
    title: 'Вход — Расписание ВГППК',
    body: `    <main class="card">
      <div class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>
      </div>
      <h1>Вход на сайт</h1>
      <p>Доступ к расписанию ограничен. Введите логин и пароль, которые вам выдали.</p>
      <form class="form" id="loginForm" novalidate>
        <label class="field"><span>Логин</span>
          <input id="login" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        </label>
        <label class="field"><span>Пароль</span>
          <span class="pw">
            <input id="password" name="password" type="password" autocomplete="current-password" required>
            <button class="pw-toggle" id="pwToggle" type="button" aria-label="Показать пароль">Показать</button>
          </span>
        </label>
        <div class="error" id="error" role="alert" hidden></div>
        <button class="btn primary wide" id="submit" type="submit">Войти</button>
      </form>
      <p class="hint">Вход запоминается на этом устройстве на 7 дней.</p>
    </main>`,
    script: '  <script src="/gate.js"></script>\n',
  });
}

module.exports = { notFoundHtml, maintenanceHtml, loginHtml, esc };
