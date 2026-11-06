// Форма входа на сайт (страница отдаётся из api/gate.js, когда включён вход по паролю).
(function () {
  'use strict';
  var form = document.getElementById('loginForm');
  if (!form) return;
  var login = document.getElementById('login');
  var password = document.getElementById('password');
  var toggle = document.getElementById('pwToggle');
  var submit = document.getElementById('submit');
  var errorBox = document.getElementById('error');

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = !text;
  }

  toggle.addEventListener('click', function () {
    var show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Скрыть' : 'Показать';
    toggle.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!login.value.trim() || !password.value) {
      showError('Введите логин и пароль.');
      return;
    }
    showError('');
    submit.disabled = true;
    submit.textContent = 'Проверяю…';

    fetch('/api/gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: login.value.trim(), password: password.value }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { res: res, body: body }; });
      })
      .then(function (r) {
        if (r.res.ok) {
          location.reload();
          return;
        }
        showError(r.body.error || 'Не удалось войти. Попробуйте ещё раз.');
        password.value = '';
        password.focus();
      })
      .catch(function () {
        showError('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
      })
      .then(function () {
        submit.disabled = false;
        submit.textContent = 'Войти';
      });
  });
})();
