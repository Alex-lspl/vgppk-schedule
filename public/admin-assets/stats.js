(() => {
  'use strict';

  const FLAG_BASE = 'https://cdn.jsdelivr.net/npm/flag-icons@7.6.0/flags/4x3/';
  const POLL_MS = 30 * 1000;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

  /* ---------- Иконки (линейные, в стиле сайта) ---------- */

  const svg = (paths, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>', 18),
    monitor: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', 15),
    download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 15),
    eye: svg('<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>', 14),
  };
  const deviceIcon = (kind) => (kind === 'ios' || kind === 'android' ? ICONS.phone : ICONS.monitor);

  /* ---------- Состояние ---------- */

  const state = {
    data: null,
    tab: 'overview',
    period: 7,
    revealed: new Set(), // IP, которые админ раскрыл нажатием
    q: '',
    device: '',
    online: '',
    selected: new Set(), // отмеченные для удаления посетители (id)
    purgeMode: 'older',
    purgeDays: 7,
  };

  /* ---------- Страны, флаги, IP ---------- */

  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['ru'], { type: 'region' }); } catch { /* старый браузер */ }

  function countryName(code) {
    if (!code) return 'Неизвестно';
    try { return (regionNames && regionNames.of(code)) || code; } catch { return code; }
  }

  function flag(code) {
    if (!/^[A-Z]{2}$/.test(code || '')) return '<span class="flag-fallback">?</span>';
    return `<img class="flag" src="${FLAG_BASE}${code.toLowerCase()}.svg" alt="" loading="lazy" width="22" height="16" data-code="${code}">`;
  }

  // Если флаг не загрузился (нет сети до CDN) — вместо него показываем код страны
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('flag')) {
      const s = document.createElement('span');
      s.className = 'flag-fallback';
      s.textContent = t.dataset.code || '?';
      t.replaceWith(s);
    }
  }, true);

  // Флаг и название страны; справа — браузер посетителя (если передан), а не код страны
  const countryHtml = (code, browser) => `<span class="country">${flag(code)}<span>${esc(countryName(code))}</span>${browser ? `<span class="cc">${esc(browser)}</span>` : ''}</span>`;

  function maskIp(ip) {
    if (!ip) return '—';
    if (ip.includes(':')) {
      const p = ip.split(':');
      return `${p[0] || '0'}:XX:XX:${p[p.length - 1] || '0'}`;
    }
    const p = ip.split('.');
    return p.length === 4 ? `${p[0]}.XX.XX.${p[3]}` : ip;
  }

  // Пометка «+N»: сколько ещё посетителей (устройств) заходят с этого же IP
  function sameIpHtml(v) {
    return v.sameIp ? `<span class="same-ip" title="Ещё ${v.sameIp} с этим IP-адресом">+${v.sameIp}</span>` : '';
  }

  function ipHtml(ip) {
    if (!ip) return '<span class="muted">—</span>';
    const open = state.revealed.has(ip);
    return `<button type="button" class="ip-btn${open ? ' open' : ''}" data-ip="${esc(ip)}" title="${open ? 'Скрыть' : 'Показать полностью'}">${esc(open ? ip : maskIp(ip))}${ICONS.eye}</button>`;
  }

  /* ---------- Время (всё по Москве) ---------- */

  const p2 = (n) => String(n).padStart(2, '0');
  const msk = (ms) => new Date(ms + 3 * 3600000);
  const hhmm = (ms) => `${p2(msk(ms).getUTCHours())}:${p2(msk(ms).getUTCMinutes())}`;
  const dmy = (ms) => `${p2(msk(ms).getUTCDate())}.${p2(msk(ms).getUTCMonth() + 1)}.${msk(ms).getUTCFullYear()}`;
  const dayNum = (ms) => Math.floor((ms + 3 * 3600000) / 86400000);

  function rel(ms, online) {
    if (online) return 'Сейчас';
    const now = state.data.now;
    const diff = now - ms;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
    const dd = dayNum(now) - dayNum(ms);
    if (dd === 0) return `Сегодня, ${hhmm(ms)}`;
    if (dd === 1) return `Вчера, ${hhmm(ms)}`;
    return `${dmy(ms)} ${hhmm(ms)}`;
  }

  function firstSeen(ms) {
    return dayNum(state.data.now) === dayNum(ms) ? `Впервые сегодня, ${hhmm(ms)}` : `Впервые ${dmy(ms)}`;
  }

  const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  function dayLabel(date) {
    const [y, m, d] = date.split('-').map(Number);
    return state.period === 7 ? WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] : String(d);
  }

  /* ---------- Мелкие блоки ---------- */

  const stat = (label, value, note, cls = '') => `<article class="stat"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div><div class="stat-note">${note}</div></article>`;
  const deviceHtml = (v) => `<span class="device">${deviceIcon(v.kind)}${esc(v.os)}</span>`;
  const groupPills = (groups) => (groups.length ? groups.map((g) => `<span class="group-pill">${esc(g)}</span>`).join('') : '<span class="muted">—</span>');
  const statusPill = (online) => (online ? '<span class="pill"><span class="live-dot"></span>Онлайн</span>' : '<span class="pill off">Не в сети</span>');
  const empty = (text) => `<div class="empty">${text}</div>`;

  /* ---------- Обзор ---------- */

  function chartHtml(d) {
    const rows = d.daily.slice(-state.period);
    const max = Math.max(1, ...rows.map((r) => r.unique));
    const dense = state.period > 7;
    return `<div class="chart${dense ? ' dense' : ''}">${rows.map((r, i) => {
      const h = r.unique ? Math.max(6, Math.round((r.unique / max) * 100)) : 0;
      const lbl = !dense || (rows.length - 1 - i) % 3 === 0;
      return `<div class="chart-col${lbl ? ' lbl' : ''}"><div class="chart-area" data-h="${r.unique ? h + '%' : '3px'}">${r.unique ? `<span class="chart-val">${r.unique}</span>` : ''}<div class="chart-bar${r.unique ? '' : ' zero'}"></div></div><div class="chart-day">${dayLabel(r.date)}</div></div>`;
    }).join('')}</div>`;
  }

  function recentTable(list) {
    if (!list.length) return empty('Пока никто не заходил');
    return `<div class="table-wrap"><table class="rtable recent"><thead><tr><th>Страна</th><th>Устройство</th><th>IP-адрес</th><th>Группа</th><th>Активность</th></tr></thead><tbody>${list.map((v) => `<tr>
      <td data-label="Страна">${countryHtml(v.country, v.browser)}</td>
      <td data-label="Устройство">${deviceHtml(v)}</td>
      <td data-label="IP-адрес">${ipHtml(v.ip)}${sameIpHtml(v)}</td>
      <td data-label="Группа">${v.groups.length ? `<span class="group-pill">${esc(v.groups[0])}</span>` : '<span class="muted">—</span>'}</td>
      <td data-label="Активность">${rel(v.last, v.online)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function onlinePanel(d) {
    const list = d.online.list;
    const body = list.length
      ? `<div class="online-list">${list.map((v) => `<article class="person">
          <div class="person-top"><div class="person-name">${flag(v.country)}<span>Посетитель #${esc(v.short)}</span></div>${statusPill(true)}</div>
          <div class="person-row">${deviceHtml(v)}<span class="muted">${v.groups.length ? 'Группа ' + esc(v.groups[0]) : ''}</span></div>
          <div class="person-row"><span class="muted">IP-адрес</span><span>${ipHtml(v.ip)}${sameIpHtml(v)}</span></div>
          <div class="person-row">${countryHtml(v.country, v.browser)}<span class="muted">${firstSeen(v.first)}</span></div>
        </article>`).join('')}</div>`
      : empty('Сейчас никого нет на сайте');
    return `<section class="panel p-online"><div class="panel-head"><div><div class="panel-title">Сейчас онлайн</div><div class="panel-meta">Был сигнал за последнюю минуту</div></div>${statusPill(d.online.count > 0)}</div>${body}</section>`;
  }

  function geoRows(list, limit) {
    const rows = list.slice(0, limit);
    if (!rows.length) return empty('Данных пока нет');
    const max = Math.max(1, ...rows.map((r) => r.count));
    return `<div class="geo-list">${rows.map((r) => `<div class="geo-row">${countryHtml(r.code)}<div class="geo-track"><div class="geo-fill" data-w="${Math.max(4, Math.round((r.count / max) * 100))}"></div></div><div class="geo-count">${fmt(r.count)}</div></div>`).join('')}</div>`;
  }

  const SKIP_LABELS = {
    admin: 'Ваши заходы (вы в админке)',
    bot: 'Боты',
    origin: 'Запросы с чужого сайта',
    'captcha-shown': 'Показана проверка «Я не робот»',
    'captcha-passed': 'Проверку прошли',
    'captcha-failed': 'Проверку не прошли',
  };

  // Всегда на виду, даже когда отклонять было нечего. Пример (браузер) — во всплывающей подсказке;
  // у ботов он показан сразу, потому что по названию бота видно, кто это.
  function skipsPanel(d) {
    const list = d.skips || [];
    const rows = list.length
      ? list.map((x) => `<div class="skip-row" title="${esc(x.sample || '')}"><div class="skip-top"><span>${esc(SKIP_LABELS[x.reason] || x.reason)}</span><b>${fmt(x.count)}</b></div>${x.reason === 'bot' && x.sample ? `<div class="skip-sample">${esc(x.sample)}</div>` : ''}</div>`).join('')
      : '<div class="skip-empty">За сутки ничего</div>';
    return `<section class="panel" id="skipsPanel"><div class="panel-head"><div><div class="panel-title">Не засчитано</div><div class="panel-meta">За последние 24 часа</div></div></div><div class="skip-list">${rows}</div></section>`;
  }

  function viewOverview(d) {
    const per = d.periods[state.period];
    return `
      <section class="stats">
        ${stat('Сейчас онлайн', `<span class="live-dot${d.online.count ? '' : ' off'}"></span>${fmt(d.online.count)}`, 'Активны в последнюю минуту', 'accent')}
        ${stat('Сегодня', fmt(d.today), 'Уникальных посетителей')}
        ${stat('За неделю', fmt(d.week), 'Уникальных посетителей')}
        ${stat('За 30 дней', fmt(d.month), 'Уникальных посетителей')}
      </section>
      <div class="layout">
        <div>
          <section class="panel p-chart">
            <div class="panel-head"><div><div class="panel-title">Посещаемость</div><div class="panel-meta">Уникальных посетителей по дням</div></div>
              <select class="field" id="periodSelect" aria-label="Период"><option value="7"${state.period === 7 ? ' selected' : ''}>7 дней</option><option value="30"${state.period === 30 ? ' selected' : ''}>30 дней</option></select></div>
            ${chartHtml(d)}
            <div class="mini-grid">
              <div class="mini"><span>Всего заходов</span><strong>${fmt(per.visits)}</strong></div>
              <div class="mini"><span>В среднем за день</span><strong>${fmt(per.avgPerDay)}</strong></div>
              <div class="mini"><span>Новых</span><strong>${per.newPct}%</strong></div>
            </div>
          </section>
          <section class="panel p-recent">
            <div class="panel-head"><div><div class="panel-title">Последние посещения</div><div class="panel-meta">Кто заходил и какую группу смотрел</div></div><button class="btn small" type="button" data-goto="visitors">Все посетители</button></div>
            ${recentTable(d.recent)}
          </section>
        </div>
        <aside>
          ${onlinePanel(d)}
          ${skipsPanel(d)}
          <section class="panel p-countries">
            <div class="panel-head"><div><div class="panel-title">Топ стран</div><div class="panel-meta">За последние 30 дней</div></div><button class="btn small" type="button" data-goto="geo">Подробнее</button></div>
            ${geoRows(d.countries, 5)}
          </section>
        </aside>
      </div>`;
  }

  /* ---------- Посетители ---------- */

  function filteredVisitors() {
    const q = state.q.trim().toLowerCase();
    return state.data.visitors.filter((v) => {
      if (state.device && v.kind !== state.device) return false;
      if (state.online === 'online' && !v.online) return false;
      if (state.online === 'offline' && v.online) return false;
      if (!q) return true;
      const hay = [v.short, v.country, countryName(v.country), v.browser, v.os, ...v.ips, ...v.groups].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function selBar() {
    const n = state.selected.size;
    if (!n) return '';
    return `<div class="selbar"><span>Выбрано: <b>${n}</b></span><span class="selbar-actions"><button class="btn small danger" type="button" id="delSel">Удалить выбранных</button><button class="btn small" type="button" id="clearSel">Снять выбор</button></span></div>`;
  }

  function visitorsTable() {
    const list = filteredVisitors();
    if (!list.length) return empty(state.data.visitors.length ? 'Ничего не найдено' : 'Пока никто не заходил');
    const allOn = list.every((v) => state.selected.has(v.id));
    return `<div class="table-wrap"><table class="rtable"><thead><tr><th class="chk"><input type="checkbox" id="selAll" aria-label="Отметить всех в списке"${allOn ? ' checked' : ''}></th><th>Страна</th><th>Посетитель</th><th>IP-адрес</th><th>Устройство</th><th>Группы</th><th>Первый визит</th><th>Последний визит</th><th>Статус</th></tr></thead><tbody>${list.map((v) => {
      const more = state.revealed.has(v.ip) ? v.ips.filter((x) => x !== v.ip) : [];
      return `<tr${state.selected.has(v.id) ? ' class="selected"' : ''}>
        <td class="chk" data-label=""><input type="checkbox" class="sel" data-id="${esc(v.id)}" aria-label="Отметить посетителя #${esc(v.short)}"${state.selected.has(v.id) ? ' checked' : ''}></td>
        <td data-label="Страна">${countryHtml(v.country, v.browser)}</td>
        <td data-label="Посетитель">#${esc(v.short)}</td>
        <td data-label="IP-адрес"><div>${ipHtml(v.ip)}${sameIpHtml(v)}${more.length ? `<div class="ip-all">Раньше: ${esc(more.join(', '))}</div>` : ''}</div></td>
        <td data-label="Устройство">${deviceHtml(v)}</td>
        <td data-label="Группы"><div>${groupPills(v.groups)}</div></td>
        <td data-label="Первый визит">${dmy(v.first)} ${hhmm(v.first)}</td>
        <td data-label="Последний визит">${rel(v.last, v.online)}</td>
        <td data-label="Статус">${statusPill(v.online)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function viewVisitors() {
    return `<section class="panel">
      <div class="panel-head"><div><div class="panel-title">История посетителей</div><div class="panel-meta">Посетитель определяется по браузеру и IP · хранение ${state.data.retentionDays || 30} дн.</div></div>
        <button class="btn small" type="button" id="exportBtn">${ICONS.download}<span>Экспорт CSV</span></button></div>
      <div class="filters">
        <label class="search-wrap">${ICONS.search}<input class="field" id="qInput" type="search" placeholder="Поиск по IP, стране, браузеру или группе" value="${esc(state.q)}"></label>
        <select class="field" id="deviceFilter" aria-label="Устройство"><option value="">Все устройства</option><option value="pc"${state.device === 'pc' ? ' selected' : ''}>Компьютер</option><option value="ios"${state.device === 'ios' ? ' selected' : ''}>iPhone / iPad</option><option value="android"${state.device === 'android' ? ' selected' : ''}>Android</option></select>
        <select class="field" id="onlineFilter" aria-label="Статус"><option value="">Все посетители</option><option value="online"${state.online === 'online' ? ' selected' : ''}>Онлайн</option><option value="offline"${state.online === 'offline' ? ' selected' : ''}>Не в сети</option></select>
      </div>
      <div id="selbar">${selBar()}</div>
      <div id="vtable">${visitorsTable()}</div>
      <div class="footnote">Отметьте галочками тех, кого нужно убрать из журнала, и нажмите «Удалить выбранных». IP-адрес скрыт — нажмите на него, чтобы показать полностью. Страна определяется по IP приблизительно: через VPN она будет другой.</div>
    </section>`;
  }

  function exportCsv() {
    const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const rows = [['Страна', 'Браузер', 'Посетитель', 'IP', 'Все IP', 'Устройство', 'Группы', 'Первый визит', 'Последний визит', 'Статус']];
    state.data.visitors.forEach((v) => rows.push([
      countryName(v.country), v.browser || '', v.short, v.ip, v.ips.join(' '), v.os, v.groups.join(' '),
      `${dmy(v.first)} ${hhmm(v.first)}`, `${dmy(v.last)} ${hhmm(v.last)}`, v.online ? 'Онлайн' : 'Не в сети',
    ]));
    const csv = '\uFEFF' + rows.map((r) => r.map(q).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `visitors-${dmy(state.data.now).split('.').reverse().join('-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Очистка ---------- */

  function purgeTargets(mode, days) {
    const cutoff = state.data.now - days * 86400000;
    return state.data.visitors.filter((v) => (mode === 'older' ? v.last < cutoff : v.last >= cutoff));
  }

  function viewCleanup(d) {
    return `
      <section class="panel">
        <div class="panel-head"><div><div class="panel-title">Очистка журнала</div>
          <div class="panel-meta">Сейчас в журнале посетителей: ${fmt(d.visitors.length)} · записи хранятся ${d.retentionDays || 30} дн. и удаляются сами (<a class="link" href="/admin/settings">изменить срок</a>)</div></div></div>
        <div class="hint">Удалённые записи вернуть нельзя. Если человек зайдёт на сайт снова, он появится в журнале как новый посетитель.</div>
      </section>

      <section class="panel">
        <div class="panel-title spaced">Удалить за период</div>
        <div class="purge-row">
          <select class="field" id="purgeMode" aria-label="Какие записи удалить">
            <option value="older"${state.purgeMode === 'older' ? ' selected' : ''}>Старше</option>
            <option value="recent"${state.purgeMode === 'recent' ? ' selected' : ''}>Только за последние</option>
          </select>
          <input class="field" id="purgeDays" type="number" min="0" max="3650" step="1" inputmode="numeric" value="${state.purgeDays}" aria-label="Количество дней">
          <span class="purge-unit">дн.</span>
          <button class="btn small danger" type="button" id="purgeBtn">Удалить</button>
        </div>
        <div class="hint">Считается по времени последнего визита. «Старше 7 дн.» удалит тех, кто не заходил больше недели; «Только за последние 7 дн.» — тех, кто заходил за эту неделю.</div>
      </section>

      <section class="panel">
        <div class="panel-title spaced">Удалить выбранных</div>
        <div class="hint">На вкладке «Посетители» отметьте нужных людей галочками (можно сузить список поиском и фильтрами) и нажмите «Удалить выбранных».</div>
        <div class="panel-actions"><button class="btn small" type="button" data-goto="visitors">Перейти к посетителям</button></div>
      </section>

      <section class="panel">
        <div class="panel-title spaced">Очистить всё</div>
        <div class="hint">Удаляются все записи посетителей и счётчик «Не засчитано». Статистика начнётся с нуля.</div>
        <div class="panel-actions"><button class="btn small danger" type="button" id="clearBtn">Очистить весь журнал</button></div>
      </section>`;
  }

  /* ---------- География ---------- */

  function viewGeo(d) {
    const top = d.countries.find((c) => c.code) || null;
    return `
      <section class="stats">
        ${stat('Стран за 30 дней', fmt(d.countriesTotal), 'По IP-адресу')}
        ${stat('Основная страна', top ? `<span class="country">${flag(top.code)}<span>${esc(countryName(top.code))}</span></span>` : '—', 'Больше всего посетителей', 'small')}
        ${stat('Мобильные', d.devices.mobile + '%', 'От всех посетителей')}
        ${stat('Компьютеры', d.devices.pc + '%', 'От всех посетителей')}
      </section>
      <section class="panel">
        <div class="panel-head"><div><div class="panel-title">География посетителей</div><div class="panel-meta">Страна определяется по IP приблизительно</div></div><span class="panel-meta">Последние 30 дней</span></div>
        ${geoRows(d.countries, 50)}
      </section>
      <section class="panel">
        <div class="panel-title spaced">Устройства посетителей</div>
        <div class="mini-grid">
          <div class="mini"><span>${ICONS.monitor} Компьютеры</span><strong>${d.devices.pc}%</strong></div>
          <div class="mini"><span>${ICONS.phone} iPhone / iPad</span><strong>${d.devices.ios}%</strong></div>
          <div class="mini"><span>${ICONS.phone} Android</span><strong>${d.devices.android}%</strong></div>
        </div>
      </section>`;
  }

  /* ---------- Отрисовка и данные ---------- */

  // Страница отдаётся с CSP без встроенных стилей, поэтому размеры столбцов и полосок
  // задаются здесь через CSSOM, а не атрибутом style в разметке.
  function applyDynamicStyles() {
    document.querySelectorAll('[data-h]').forEach((el) => el.style.setProperty('--h', el.dataset.h));
    document.querySelectorAll('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
  }

  function renderView() {
    const d = state.data;
    const view = $('view');
    if (!d || !d.configured) { view.innerHTML = ''; return; }
    view.innerHTML = state.tab === 'visitors' ? viewVisitors() : state.tab === 'geo' ? viewGeo(d) : state.tab === 'cleanup' ? viewCleanup(d) : viewOverview(d);
    applyDynamicStyles();
  }

  function showTab(name) {
    state.tab = name;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    renderView();
    window.scrollTo({ top: 0 });
  }

  function setNotice(html) {
    $('notice').innerHTML = html ? `<div class="notice">${html}</div>` : '';
  }

  function onData(d) {
    state.data = d;
    if (!d.configured) {
      setNotice('<b>Статистика не подключена.</b> Нужно подключить хранилище Upstash Redis к проекту в Vercel (Storage → Upstash → Redis), после этого сделать Redeploy. Подробно — в README, раздел «Статистика посещений».');
      renderView();
      return;
    }
    setNotice('');
    const active = document.activeElement;
    const typing = active && /^(INPUT|SELECT)$/.test(active.tagName) && $('view').contains(active);
    const present = new Set(d.visitors.map((v) => v.id));
    state.selected.forEach((id) => { if (!present.has(id)) state.selected.delete(id); });
    if (state.tab === 'visitors') {
      // Фильтры не пересоздаём, чтобы не сбить ввод — обновляем только таблицу
      if ($('vtable')) { $('vtable').innerHTML = visitorsTable(); $('selbar').innerHTML = selBar(); } else renderView();
    } else if (!typing) {
      renderView();
    }
  }

  async function load() {
    try {
      const res = await fetch('/api/admin-stats?json=1', { cache: 'no-store' });
      if (res.status === 401) { location.href = '/admin'; return; }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Ошибка сервера ${res.status}`);
      onData(json);
    } catch (e) {
      setNotice(`<b>Не удалось загрузить данные.</b> ${esc(e.message)}`);
    }
  }

  /* ---------- Действия: очистка журнала ---------- */

  let flashTimer = null;
  function flash(text, isError) {
    $('flash').innerHTML = text ? `<div class="flash${isError ? ' err' : ''}">${esc(text)}</div>` : '';
    clearTimeout(flashTimer);
    if (text) flashTimer = setTimeout(() => { $('flash').innerHTML = ''; }, 6000);
  }

  async function post(body) {
    const res = await fetch('/api/admin-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) { location.href = '/admin'; return new Promise(() => {}); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Ошибка сервера ${res.status}`);
    return json;
  }

  async function runCleanup(body, doneText) {
    window.Busy.show('Удаляю…');
    try {
      const r = await post(body);
      state.selected.clear();
      flash(`${doneText}: ${r.deleted}.`, false);
      await load();
      renderView();
    } catch (e) {
      flash(e.message, true);
    } finally {
      window.Busy.hide();
    }
  }

  const plural = (n, a, b, c) => {
    const m = n % 100, k = n % 10;
    return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c;
  };
  const people = (n) => `${n} ${plural(n, 'посетителя', 'посетителей', 'посетителей')}`;

  function deleteSelected() {
    const ids = [...state.selected];
    if (!ids.length) return;
    if (!confirm(`Удалить из журнала ${people(ids.length)}? Это нельзя отменить.`)) return;
    runCleanup({ action: 'stats.delete', ids }, 'Удалено записей');
  }

  function purgeByPeriod() {
    const days = Math.max(0, Math.floor(Number(state.purgeDays)));
    if (!Number.isFinite(days)) { flash('Укажите число дней.', true); return; }
    const n = purgeTargets(state.purgeMode, days).length;
    if (!n) { flash('По этому периоду удалять нечего.', false); return; }
    const what = state.purgeMode === 'older' ? `не заходивших ${days} дн. и дольше` : `заходивших за последние ${days} дн.`;
    if (!confirm(`Будет удалено ${people(n)} (${what}). Это нельзя отменить. Продолжить?`)) return;
    runCleanup({ action: 'stats.purge', mode: state.purgeMode, days }, 'Удалено записей');
  }

  function clearEverything() {
    const n = state.data.visitors.length;
    if (!confirm(`Очистить весь журнал? Будет удалено ${people(n)} и счётчики «Не засчитано». Это нельзя отменить.`)) return;
    runCleanup({ action: 'stats.clear' }, 'Журнал очищен, удалено записей');
  }

  /* ---------- События ---------- */

  $('backLink').innerHTML = `${ICONS.back}<span class="btn-text">В админку</span>`;
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { showTab(goto.dataset.goto); return; }

    const ip = e.target.closest('.ip-btn');
    if (ip) {
      const v = ip.dataset.ip;
      if (state.revealed.has(v)) state.revealed.delete(v); else state.revealed.add(v);
      renderView();
      return;
    }

    if (e.target.closest('#exportBtn')) exportCsv();
    if (e.target.closest('#delSel')) deleteSelected();
    if (e.target.closest('#clearSel')) { state.selected.clear(); $('vtable').innerHTML = visitorsTable(); $('selbar').innerHTML = selBar(); }
    if (e.target.closest('#purgeBtn')) purgeByPeriod();
    if (e.target.closest('#clearBtn')) clearEverything();
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'purgeDays') state.purgeDays = e.target.value;
    if (e.target.id === 'qInput') { state.q = e.target.value; $('vtable').innerHTML = visitorsTable(); }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'purgeMode') state.purgeMode = e.target.value;
    if (e.target.id === 'selAll') {
      filteredVisitors().forEach((v) => { if (e.target.checked) state.selected.add(v.id); else state.selected.delete(v.id); });
      $('vtable').innerHTML = visitorsTable();
      $('selbar').innerHTML = selBar();
    }
    if (e.target.classList.contains('sel')) {
      const id = e.target.dataset.id;
      if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
      e.target.closest('tr').classList.toggle('selected', e.target.checked);
      const all = $('selAll');
      if (all) all.checked = filteredVisitors().every((v) => state.selected.has(v.id));
      $('selbar').innerHTML = selBar();
    }
    if (e.target.id === 'periodSelect') { state.period = Number(e.target.value); renderView(); }
    if (e.target.id === 'deviceFilter') { state.device = e.target.value; $('vtable').innerHTML = visitorsTable(); }
    if (e.target.id === 'onlineFilter') { state.online = e.target.value; $('vtable').innerHTML = visitorsTable(); }
  });

  $('view').innerHTML = '<div class="loader"><div class="spinner"></div><span>Загружаю статистику…</span></div>';
  if (location.hash === '#cleanup') showTab('cleanup');
  load();
  setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
})();
