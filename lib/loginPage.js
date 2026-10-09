'use strict';

// Страница логина в админку — на основе макета, который прислал пользователь.
// Лежит в lib/, а не в public/, потому что её показывает тот же обработчик
// (api/admin.js), что решает, показать логин или саму панель.
function loginPageHtml(error) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0, viewport-fit=cover"
  >

  <title>Вход — Админка расписания</title>
  <link rel="icon" href="/icon-32.png" type="image/png">
  <link rel="apple-touch-icon" href="/icon-180.png">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

  <link
    href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;600;700&display=swap"
    rel="stylesheet"
  >

  <style>
    :root {
      --bg: #151515;
      --surface: #26211C;
      --surface-2: #2E2822;
      --line: #3A332B;
      --ink: #F2EDE3;
      --muted: #A79C8E;
      --accent: #D97757;
      --accent-ink: #1B1815;
      --danger: #C2704F;

      --font-body: 'Onest', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      --font-display: 'Unbounded', 'Onest', system-ui, sans-serif;

      color-scheme: dark;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      min-height: 100%;
      background: var(--bg);
      overflow-x: hidden; /* декоративные круги ниже специально уходят за край экрана */
    }

    body {
      min-height: 100svh;

      display: flex;
      align-items: center;
      justify-content: center;

      padding:
        max(24px, env(safe-area-inset-top))
        max(24px, env(safe-area-inset-right))
        max(24px, env(safe-area-inset-bottom))
        max(24px, env(safe-area-inset-left));

      background:
        radial-gradient(
          circle at 5% 0%,
          rgba(217, 119, 87, 0.16) 0,
          rgba(217, 119, 87, 0.08) 12%,
          transparent 27%
        ),
        radial-gradient(
          circle at 100% 100%,
          rgba(217, 119, 87, 0.08) 0,
          transparent 25%
        ),
        var(--bg);

      color: var(--ink);
      font-family: var(--font-body);

      overflow-x: hidden;
      position: relative;
    }

    /* Декоративное свечение */

    body::before {
      content: "";

      position: absolute;

      width: 500px;
      height: 500px;

      left: -330px;
      top: -300px;

      border-radius: 50%;

      background: rgba(217, 119, 87, 0.12);
      filter: blur(20px);

      pointer-events: none;
    }

    /* Декоративная линия */

    body::after {
      content: "";

      position: absolute;

      width: 700px;
      height: 400px;

      right: -180px;
      bottom: -230px;

      border-top: 1px solid rgba(217, 119, 87, 0.65);
      border-radius: 50%;

      transform: rotate(-24deg);

      pointer-events: none;
    }

    /* =========================
       WRAPPER
       ========================= */

    .auth-wrapper {
      width: 100%;
      max-width: 580px;

      position: relative;
      z-index: 1;
    }

    /* =========================
       CARD
       ========================= */

    .auth-card {
      width: 100%;

      padding: 58px 46px 52px;

      background:
        linear-gradient(
          145deg,
          rgba(46, 40, 34, 0.72),
          rgba(38, 33, 28, 0.96)
        );

      border: 1px solid var(--line);
      border-radius: 20px;

      box-shadow:
        0 30px 80px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.025);

      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }

    /* =========================
       LOGO
       ========================= */

    .logo-image {
      display: block;

      width: 64px;
      height: 64px;

      object-fit: contain;
      border-radius: 16px;

      margin: 0 auto 28px;
    }

    /* =========================
       HEADER
       ========================= */

    .auth-title {
      font-family: var(--font-display);

      font-size: clamp(24px, 4vw, 32px);
      line-height: 1.25;
      font-weight: 600;

      text-align: center;
      letter-spacing: -0.03em;

      color: var(--ink);
    }

    .auth-subtitle {
      max-width: 360px;

      margin: 14px auto 38px;

      color: var(--muted);

      font-size: 15px;
      line-height: 1.6;

      text-align: center;
    }

    /* =========================
       FORM
       ========================= */

    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .field {
      position: relative;
      width: 100%;
    }

    .field-icon {
      position: absolute;

      left: 19px;
      top: 50%;

      width: 20px;
      height: 20px;

      transform: translateY(-50%);

      color: var(--muted);

      pointer-events: none;

      transition: color 0.2s ease;
    }

    .field input {
      display: block;

      width: 100%;
      height: 72px;

      padding: 0 54px 0 56px;

      border: 1px solid var(--line);
      border-radius: 14px;

      outline: none;

      background: rgba(46, 40, 34, 0.58);

      color: var(--ink);

      font-family: var(--font-body);
      font-size: 16px;

      -webkit-appearance: none;

      transition:
        border-color 0.2s ease,
        background 0.2s ease,
        box-shadow 0.2s ease;
    }

    .field input::placeholder {
      color: var(--muted);
    }

    .field input:hover {
      background: var(--surface-2);
    }

    .field input:focus {
      border-color: var(--accent);

      background: var(--surface-2);

      box-shadow:
        0 0 0 3px rgba(217, 119, 87, 0.10);
    }

    .field:focus-within .field-icon {
      color: var(--accent);
    }

    /* =========================
       PASSWORD TOGGLE
       ========================= */

    .password-toggle {
      position: absolute;

      right: 15px;
      top: 50%;

      width: 42px;
      height: 42px;

      display: flex;
      align-items: center;
      justify-content: center;

      transform: translateY(-50%);

      border: 0;
      border-radius: 10px;

      background: transparent;

      color: var(--muted);

      cursor: pointer;

      -webkit-tap-highlight-color: transparent;

      transition:
        color 0.2s ease,
        background 0.2s ease;
    }

    .password-toggle:hover {
      color: var(--ink);
      background: rgba(255, 255, 255, 0.03);
    }

    .password-toggle:active {
      background: rgba(255, 255, 255, 0.06);
    }

    /* =========================
       ERROR
       ========================= */

    .error-message {
      display: none;

      padding: 12px 14px;

      border: 1px solid rgba(194, 112, 79, 0.35);
      border-radius: 10px;

      background: rgba(194, 112, 79, 0.08);

      color: #D89579;

      font-size: 13px;
      line-height: 1.4;
    }

    .error-message.visible {
      display: block;
    }

    /* =========================
       BUTTON
       ========================= */

    .submit-button {
      width: 100%;
      height: 68px;

      margin-top: 8px;

      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;

      border: 0;
      border-radius: 14px;

      background: var(--accent);
      color: var(--accent-ink);

      font-family: var(--font-body);
      font-size: 16px;
      font-weight: 700;

      cursor: pointer;

      -webkit-tap-highlight-color: transparent;

      transition:
        transform 0.2s ease,
        background 0.2s ease,
        box-shadow 0.2s ease;
    }

    .submit-button:hover {
      background: #E08361;

      transform: translateY(-1px);

      box-shadow:
        0 10px 30px rgba(217, 119, 87, 0.18);
    }

    .submit-button:active {
      transform: translateY(0);
    }

    .submit-button:disabled {
      opacity: 0.6;
      cursor: default;
      transform: none;
    }

    .submit-button svg {
      transition: transform 0.2s ease;
    }

    .submit-button:hover svg {
      transform: translateX(3px);
    }

    /* =========================
       TABLET
       ========================= */

    @media (max-width: 700px) {

      body {
        padding:
          max(20px, env(safe-area-inset-top))
          max(20px, env(safe-area-inset-right))
          max(20px, env(safe-area-inset-bottom))
          max(20px, env(safe-area-inset-left));
      }

      .auth-card {
        padding: 48px 32px 42px;
      }
    }

    /* =========================
       PHONE
       ========================= */

    @media (max-width: 480px) {

      body {
        min-height: 100svh;

        align-items: center;

        padding:
          max(16px, env(safe-area-inset-top))
          max(16px, env(safe-area-inset-right))
          max(16px, env(safe-area-inset-bottom))
          max(16px, env(safe-area-inset-left));
      }

      /* Убираем декоративные элементы на маленьком экране,
         чтобы они не перегружали интерфейс */

      body::before {
        width: 280px;
        height: 280px;

        left: -190px;
        top: -170px;

        opacity: 0.7;
      }

      body::after {
        width: 430px;
        height: 260px;

        right: -270px;
        bottom: -190px;

        opacity: 0.6;
      }

      .auth-wrapper {
        max-width: 100%;
      }

      .auth-card {
        padding: 36px 20px 28px;

        border-radius: 18px;

        box-shadow:
          0 20px 50px rgba(0, 0, 0, 0.32),
          inset 0 1px 0 rgba(255, 255, 255, 0.025);
      }

      /* Логотип */

      .logo-image {
        width: 56px;
        height: 56px;

        margin-bottom: 22px;
      }

      /* Заголовок */

      .auth-title {
        font-size: 22px;
        line-height: 1.3;
      }

      .auth-subtitle {
        max-width: 300px;

        margin: 12px auto 28px;

        font-size: 14px;
        line-height: 1.55;
      }

      /* Форма */

      .auth-form {
        gap: 12px;
      }

      .field input {
        height: 60px;

        padding-left: 52px;
        padding-right: 52px;

        border-radius: 12px;

        font-size: 16px;
      }

      .field-icon {
        left: 17px;

        width: 19px;
        height: 19px;
      }

      .password-toggle {
        right: 9px;

        width: 42px;
        height: 42px;
      }

      /* Кнопка */

      .submit-button {
        height: 60px;

        margin-top: 8px;

        border-radius: 12px;

        font-size: 15px;
      }
    }

    /* =========================
       VERY SMALL PHONES
       ========================= */

    @media (max-width: 360px) {

      body {
        padding:
          max(12px, env(safe-area-inset-top))
          max(12px, env(safe-area-inset-right))
          max(12px, env(safe-area-inset-bottom))
          max(12px, env(safe-area-inset-left));
      }

      .auth-card {
        padding: 30px 16px 24px;

        border-radius: 16px;
      }

      .logo-image {
        width: 52px;
        height: 52px;

        margin-bottom: 18px;
      }

      .auth-title {
        font-size: 20px;
      }

      .auth-subtitle {
        margin-bottom: 24px;

        font-size: 13px;
      }

      .field input {
        height: 56px;
      }

      .submit-button {
        height: 56px;
      }
    }

    /* =========================
       LOW HEIGHT
       ========================= */

    @media (max-height: 650px) {

      body {
        align-items: flex-start;

        overflow-y: auto;
      }

      .auth-wrapper {
        margin: 20px auto;
      }

      .auth-card {
        padding-top: 30px;
        padding-bottom: 30px;
      }

      .logo-image {
        width: 50px;
        height: 50px;

        margin-bottom: 18px;
      }

      .auth-subtitle {
        margin-bottom: 22px;
      }

      .field input {
        height: 58px;
      }

      .submit-button {
        height: 58px;
      }
    }

    /* =========================
       REDUCED MOTION
       ========================= */

    @media (prefers-reduced-motion: reduce) {

      *,
      *::before,
      *::after {
        scroll-behavior: auto !important;
        transition: none !important;
      }
    }
  </style>
</head>

<body>

  <main class="auth-wrapper">

    <section class="auth-card">

      <img class="logo-image" src="/icon-128.png" alt="Логотип" width="64" height="64">

      <h1 class="auth-title">
        Админка расписания
      </h1>

      <p class="auth-subtitle">
        Войдите, чтобы отредактировать расписание на эту неделю
      </p>


      <form class="auth-form" id="loginForm">

        <!-- ЛОГИН -->

        <div class="field">

          <svg
            class="field-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="3.5"/>
            <path d="M5 20c.8-3.4 3.1-5 7-5s6.2 1.6 7 5"/>
          </svg>

          <input
            type="text"
            name="login"
            id="login"
            placeholder="Логин"
            autocomplete="username"
            required
          >

        </div>


        <!-- ПАРОЛЬ -->

        <div class="field">

          <svg
            class="field-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="10" width="14" height="10" rx="2"/>
            <path d="M8 10V7a4 4 0 0 1 8 0v3"/>
            <circle cx="12" cy="15" r="1"/>
          </svg>

          <input
            type="password"
            name="password"
            id="password"
            placeholder="Пароль"
            autocomplete="current-password"
            required
          >

          <button
            type="button"
            class="password-toggle"
            id="passwordToggle"
            aria-label="Показать пароль"
          >
            <svg
              width="21"
              height="21"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/>
              <circle cx="12" cy="12" r="2.5"/>
            </svg>
          </button>

        </div>


        <!-- ОШИБКА -->

        <div class="error-message${error ? ' visible' : ''}" id="errorMessage">${error ? escapeHtml(error) : 'Неверный логин или пароль'}</div>


        <!-- КНОПКА -->

        <button
          type="submit"
          class="submit-button"
          id="submitButton"
        >
          <span>Войти</span>

          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h13"/>
            <path d="m13 6 6 6-6 6"/>
          </svg>
        </button>

      </form>

    </section>

  </main>


  <script>
    const password = document.getElementById('password');
    const passwordToggle = document.getElementById('passwordToggle');
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const submitButton = document.getElementById('submitButton');

    /* Показать / скрыть пароль */

    passwordToggle.addEventListener('click', () => {
      const isPassword = password.type === 'password';

      password.type = isPassword ? 'text' : 'password';

      passwordToggle.setAttribute(
        'aria-label',
        isPassword ? 'Скрыть пароль' : 'Показать пароль'
      );
    });


    /* Отправка формы */

    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      errorMessage.classList.remove('visible');
      submitButton.disabled = true;

      const login = document.getElementById('login').value;
      const passwordValue = password.value;

      try {
        const res = await fetch('/api/admin-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login, password: passwordValue })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Неверный логин или пароль');
        location.href = '/admin';
      } catch (e) {
        errorMessage.textContent = e.message;
        errorMessage.classList.add('visible');
        submitButton.disabled = false;
      }
    });
  </script>

</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { loginPageHtml };
