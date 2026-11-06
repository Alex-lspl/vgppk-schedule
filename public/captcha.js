// Страница проверки «Я не робот» (отдаётся из api/gate.js, когда в админке включена проверка).
// По нажатию кнопки браузер решает небольшую задачу — подбирает число, при котором хеш SHA-256
// от задачи начинается с нескольких нулевых бит, — и отправляет решение на сервер.
// Сервер проверяет его и выдаёт cookie; страница перезагружается и открывается расписание.
(function () {
  'use strict';
  var btn = document.getElementById('humanBtn');
  var errorBox = document.getElementById('error');
  var token = document.body.getAttribute('data-challenge');
  if (!btn || !token) return;

  var BITS = 12; // совпадает с DIFFICULTY_BITS в lib/captcha.js
  var MIN_WAIT_MS = 1300; // сервер не принимает решение раньше ~1 секунды после выдачи задачи
  var openedAt = Date.now();
  var enc = new TextEncoder();

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = !text;
  }

  function hasLeadingZeroBits(bytes, bits) {
    var full = Math.floor(bits / 8);
    for (var i = 0; i < full; i++) if (bytes[i] !== 0) return false;
    var rest = bits % 8;
    return rest === 0 || (bytes[full] >> (8 - rest)) === 0;
  }

  function solve() {
    var nonce = 0;
    function step() {
      return crypto.subtle.digest('SHA-256', enc.encode(token + ':' + nonce)).then(function (buf) {
        if (hasLeadingZeroBits(new Uint8Array(buf), BITS)) return nonce;
        nonce += 1;
        return step();
      });
    }
    return step();
  }

  function fail(text) {
    showError(text);
    btn.disabled = false;
    btn.textContent = 'Попробовать ещё раз';
    btn.onclick = function () { location.reload(); }; // новая задача — после перезагрузки
  }

  btn.addEventListener('click', function (e) {
    if (btn.disabled || btn.onclick) return;
    var trusted = e.isTrusted === true; // настоящее нажатие, а не вызов из скрипта
    if (!window.crypto || !crypto.subtle) {
      showError('Этот браузер не поддерживает проверку. Обновите браузер или откройте сайт в другом.');
      return;
    }
    showError('');
    btn.disabled = true;
    btn.textContent = 'Проверяю…';

    var wait = new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, MIN_WAIT_MS - (Date.now() - openedAt)));
    });

    Promise.all([solve(), wait])
      .then(function (r) {
        return fetch('/api/gate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'captcha', token: token, nonce: r[0], trusted: trusted }),
        });
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { res: res, body: body }; });
      })
      .then(function (r) {
        if (r.res.ok) { location.reload(); return; }
        fail(r.body.error || 'Проверка не пройдена. Попробуйте ещё раз.');
      })
      .catch(function () {
        fail('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
      });
  });
})();
