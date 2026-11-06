// Боковое меню админки (показывается на широких экранах, на телефоне и узких окнах — скрыто, там
// остаются карточки вверху страницы). Подключено на трёх страницах: расписание, статистика, настройки.
// Раз в минуту запрашивает краткую сводку (сколько онлайн, не выключен ли сайт) и рассылает её
// событием admin:brief — им же пользуются карточки на странице расписания.
(function () {
  'use strict';

  var path = location.pathname.replace(/\/+$/, '') || '/';
  var current = path === '/admin/stats' ? 'stats' : path === '/admin/settings' ? 'settings' : 'schedule';

  var ICONS = {
    schedule: '<path d="M7 3v3M17 3v3M4.5 9h15M6.5 5h11A2 2 0 0 1 19.5 7v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
    stats: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    site: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
  };
  var icon = function (name) {
    return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  };

  function item(id, href, label, badgeId) {
    return '<a class="sn-item' + (id === current ? ' active' : '') + '" href="' + href + '"' + (id === current ? ' aria-current="page"' : '') + '>' +
      icon(id) + '<span class="sn-label">' + label + '</span>' +
      (badgeId ? '<span class="sn-badge" id="' + badgeId + '" hidden></span>' : '') + '</a>';
  }

  var html =
    '<nav class="sidenav" id="sidenav" aria-label="Разделы админки">' +
      '<div class="sn-brand"><img src="/icon-128.png" alt="" width="38" height="38">' +
        '<div><div class="sn-title">Админка</div><div class="sn-sub">ГБПОУ ВО «ВГППК»</div></div></div>' +
      '<div class="sn-list">' +
        item('schedule', '/admin', 'Расписание') +
        item('stats', '/admin/stats', 'Статистика', 'snOnline') +
        item('settings', '/admin/settings', 'Настройки сайта', 'snSite') +
      '</div>' +
      '<div class="sn-bottom">' +
        '<a class="sn-item" href="/" target="_blank" rel="noopener">' + icon('site') + '<span class="sn-label">Открыть сайт</span></a>' +
        '<button class="sn-item" type="button" id="snLogout">' + icon('logout') + '<span class="sn-label">Выйти</span></button>' +
      '</div>' +
    '</nav>';

  document.body.insertAdjacentHTML('afterbegin', html);
  document.body.classList.add('has-sidenav');

  var nav = window.AdminNav = { last: null };

  function setBadge(id, text, cls) {
    var el = document.getElementById(id);
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'sn-badge' + (cls ? ' ' + cls : '');
  }

  function apply(j) {
    if (!j) return;
    setBadge('snOnline', j.configured && j.online > 0 ? String(j.online) + ' онлайн' : '', 'live');
    if (j.maintenance) setBadge('snSite', 'сайт выкл.', 'warn');
    else if (j.restricted || j.captcha) setBadge('snSite', 'защита', 'on');
    else setBadge('snSite', '', '');
  }

  function poll() {
    if (document.visibilityState !== 'visible') return;
    fetch('/api/admin-stats?json=1&brief=1', { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { location.href = '/admin'; return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (!j) return;
        nav.last = j;
        apply(j);
        document.dispatchEvent(new CustomEvent('admin:brief', { detail: j }));
      })
      .catch(function () { /* сводка — необязательная часть страницы */ });
  }

  document.getElementById('snLogout').addEventListener('click', function () {
    fetch('/api/admin-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function () { location.href = '/admin'; });
  });

  poll();
  setInterval(poll, 60000);
  document.addEventListener('visibilitychange', poll);
})();
