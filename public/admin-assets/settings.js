// Страница «Настройки сайта» (/admin/settings). Данные — /api/admin-stats?json=1&view=settings,
// сохранение — POST /api/admin-stats. Только для вошедшего администратора.
(function () {
  'use strict';

  var API = '/api/admin-stats';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var cfg = null;
  var status = { text: '', error: false };

  function request(method, body) {
    var opts = { method: method, cache: 'no-store' };
    var url = API + '?json=1&view=settings';
    if (method === 'POST') {
      url = API;
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) { location.href = '/admin'; return new Promise(function () {}); }
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error(json.error || 'Ошибка сервера ' + res.status);
        return json;
      });
    });
  }

  function badge(on, text) {
    return '<span class="badge' + (on ? ' on' : '') + '">' + (on ? text : 'выключено') + '</span>';
  }

  function render() {
    var off = !cfg.configured;
    var dis = off ? ' disabled' : '';
    $('notice').innerHTML = off
      ? '<div class="notice"><b>Хранилище не подключено.</b> Настройки хранятся в Upstash Redis (тот же, что нужен для статистики): Vercel → Storage → Upstash → Redis → Connect Project, затем Redeploy. Подробно — в README.</div>'
      : '';

    $('view').innerHTML =
      '<section class="panel">' +
        '<div class="panel-head"><div><div class="panel-title">Сайт временно не работает' + badge(cfg.maintenance.enabled, 'включено') + '</div>' +
        '<div class="panel-meta">Для технических работ и обновлений</div></div></div>' +
        '<label class="switch"><input type="checkbox" id="mEnabled"' + (cfg.maintenance.enabled ? ' checked' : '') + dis + '>' +
          '<span class="track"></span>' +
          '<span class="label">Показывать посетителям страницу «Сайт временно не работает»' +
            '<small>Вы, пока вошли в админку, видите сайт как обычно — так можно проверить его до включения для всех.</small></span></label>' +
        '<div class="group" id="mGroup">' +
          '<div class="row"><label for="mMessage">Текст на странице</label>' +
            '<textarea class="field" id="mMessage" maxlength="500"' + dis + '>' + esc(cfg.maintenance.message) + '</textarea>' +
            '<div class="count" id="mCount"></div></div>' +
        '</div>' +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-head"><div><div class="panel-title">Доступ по паролю' + badge(cfg.access.enabled, 'включено') + '</div>' +
        '<div class="panel-meta">Один общий логин и пароль для посетителей</div></div></div>' +
        '<label class="switch"><input type="checkbox" id="aEnabled"' + (cfg.access.enabled ? ' checked' : '') + dis + '>' +
          '<span class="track"></span>' +
          '<span class="label">Пускать на сайт только по логину и паролю' +
            '<small>Без входа посетитель видит только форму входа. После входа человек остаётся авторизованным на 7 дней. Вас это не касается: вход в админку открывает и сайт.</small></span></label>' +
        '<div class="group" id="aGroup">' +
          '<div class="cols">' +
            '<div class="row"><label for="aUser">Логин</label><input class="field" id="aUser" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="40" value="' + esc(cfg.access.user) + '"' + dis + '></div>' +
            '<div class="row"><label for="aPass">Пароль</label><input class="field" id="aPass" type="password" autocomplete="new-password" maxlength="100" placeholder="' + (cfg.access.hasPassword ? 'Оставьте пустым, чтобы не менять' : 'Не короче 6 символов') + '"' + dis + '></div>' +
          '</div>' +
          '<div class="hint">Логин — от 3 до 40 символов (буквы, цифры, . _ - @). Пароль хранится только в виде хеша, посмотреть его потом нельзя — можно лишь задать новый. ' +
            'Смена логина или пароля автоматически выводит всех посетителей из системы.</div>' +
          '<div><button class="btn small danger" type="button" id="revokeBtn"' + dis + '>Выйти у всех посетителей</button></div>' +
        '</div>' +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-head"><div><div class="panel-title">Журнал посещений</div>' +
        '<div class="panel-meta">Сколько хранить записи о посетителях</div></div></div>' +
        '<div class="row num"><label for="lDays">Хранить, дней</label>' +
          '<input class="field" id="lDays" type="number" min="1" max="90" step="1" inputmode="numeric" value="' + esc(cfg.logs.retentionDays) + '"' + dis + '></div>' +
        '<div class="hint spaced">От 1 до 90 дней. Старше этого срока записи удаляются сами; если срок уменьшить, лишнее удалится сразу при сохранении. ' +
          'Удалить выбранных посетителей, записи за период или всё разом можно на странице <a href="/admin/stats#cleanup">статистики → Очистка</a>.</div>' +
      '</section>' +

      '<div class="actions"><button class="btn primary" type="button" id="saveBtn"' + dis + '>Сохранить</button>' +
        '<span class="status' + (status.error ? ' err' : '') + '" id="status" role="status">' + esc(status.text) + '</span></div>';

    syncGroups();
    updateCount();
  }

  function syncGroups() {
    if (!$('mEnabled')) return;
    $('mGroup').classList.toggle('off', !$('mEnabled').checked);
    $('aGroup').classList.toggle('off', !$('aEnabled').checked);
  }

  function updateCount() {
    if ($('mMessage')) $('mCount').textContent = $('mMessage').value.length + ' / 500';
  }

  function setStatus(text, error) {
    status = { text: text, error: !!error };
    if ($('status')) {
      $('status').textContent = text;
      $('status').classList.toggle('err', !!error);
    }
  }

  function save() {
    var turningOffSite = $('mEnabled').checked && !cfg.maintenance.enabled;
    if (turningOffSite && !confirm('Включить режим «Сайт временно не работает»? Посетители перестанут видеть расписание.')) return;

    $('saveBtn').disabled = true;
    setStatus('Сохраняю…', false);
    request('POST', {
      action: 'settings.save',
      settings: {
        maintenance: { enabled: $('mEnabled').checked, message: $('mMessage').value },
        access: { enabled: $('aEnabled').checked, user: $('aUser').value, password: $('aPass').value },
        logs: { retentionDays: Number($('lDays').value) },
      },
    }).then(function (json) {
      var purged = json.purged ? ' Удалено старых записей журнала: ' + json.purged + '.' : '';
      cfg = { configured: true, maintenance: json.maintenance, access: json.access, logs: json.logs };
      status = { text: 'Сохранено. Изменения заработают в течение 15 секунд.' + purged, error: false };
      render();
    }).catch(function (e) {
      setStatus(e.message, true);
      $('saveBtn').disabled = false;
    });
  }

  function revoke() {
    if (!confirm('Выйти у всех посетителей? Им придётся ввести логин и пароль заново.')) return;
    request('POST', { action: 'settings.revoke' }).then(function () {
      setStatus('Готово: все посетители выйдут при следующем обращении к сайту (до 15 секунд).', false);
    }).catch(function (e) { setStatus(e.message, true); });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#saveBtn')) save();
    if (e.target.closest('#revokeBtn')) revoke();
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'mEnabled' || e.target.id === 'aEnabled') syncGroups();
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'mMessage') updateCount();
  });

  // Самопроверка: главная страница должна отдаваться через проверку доступа (заголовок X-Gate).
  // Если её отдаёт напрямую статический файл public/index.html (остался от старой версии),
  // заглушка и вход по паролю не работали бы — предупреждаем об этом.
  function checkGate() {
    ['/', '/index.html'].forEach(function (url) {
      fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.headers || typeof res.headers.get !== 'function' || res.headers.get('x-gate')) return;
        var box = $('gateWarn');
        if (box) return;
        $('notice').insertAdjacentHTML('beforeend',
          '<div class="notice" id="gateWarn"><b>Проверка доступа обходится.</b> Сайт отдаётся напрямую файлом <code>public/index.html</code>, ' +
          'поэтому заглушка и вход по паролю не сработают. Удалите этот файл из репозитория на GitHub (новая версия лежит в <code>views/index.html</code>) и сделайте Redeploy.</div>');
      }).catch(function () { /* проверка необязательная */ });
    });
  }

  request('GET').then(function (json) {
    cfg = json;
    render();
    checkGate();
  }).catch(function (e) {
    $('view').innerHTML = '<div class="notice"><b>Не удалось загрузить настройки.</b> ' + esc(e.message) + '</div>';
  });
})();
