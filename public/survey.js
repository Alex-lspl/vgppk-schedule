// Обязательный опрос (отдаётся из api/gate.js, когда в админке включён вопрос).
// Кнопка «Продолжить» неактивна, пока ответ короче минимума; сервер проверяет длину ещё раз.
(function () {
  'use strict';
  var form = document.getElementById('surveyForm');
  if (!form) return;
  var min = Number(document.body.getAttribute('data-min')) || 1;
  var field = document.getElementById('answer');
  var count = document.getElementById('count');
  var submit = document.getElementById('submit');
  var errorBox = document.getElementById('error');

  function plural(n, a, b, c) {
    var m = n % 100, k = n % 10;
    return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c;
  }

  // Длина считается так же, как на сервере: без пробелов по краям и без повторных пробелов
  function length() { return field.value.replace(/\s+/g, ' ').trim().length; }

  function update() {
    var left = min - length();
    var ok = left <= 0;
    submit.disabled = !ok;
    count.classList.toggle('ok', ok);
    count.textContent = ok ? '' : 'Ещё ' + left + ' ' + plural(left, 'символ', 'символа', 'символов');
    if (!ok && length() === 0) count.textContent = 'Минимум ' + min + ' ' + plural(min, 'символ', 'символа', 'символов');
  }

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = !text;
  }

  field.addEventListener('input', function () { showError(''); update(); });
  update();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submit.disabled) return;
    showError('');
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner"></span><span>Отправляю…</span>';

    fetch('/api/gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'survey', answer: field.value }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { res: res, body: body }; });
      })
      .then(function (r) {
        if (r.res.ok) { location.reload(); return; }
        showError(r.body.error || 'Не удалось отправить. Попробуйте ещё раз.');
      })
      .catch(function () {
        showError('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
      })
      .then(function () {
        submit.innerHTML = 'Продолжить';
        update();
      });
  });
})();
