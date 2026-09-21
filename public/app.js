(() => {
  'use strict';

  /* =========================================================
     НАСТРОЙКИ — правь здесь
     ========================================================= */
  const CONFIG = {
    // Группа по умолчанию (страница вида bg203.htm на сайте колледжа)
    defaultPage: 'bg203',

    // Как часто обновлять данные, пока страница открыта
    refreshMs: 10 * 60 * 1000,

    // Какая из недель расписания приходится на НЕЧЁТНЫЕ недели года (по ISO-нумерации).
    // Если приложение показывает не ту неделю — поменяй 1 на 2 (или наоборот).
    oddIsoWeekIs: 2,

    // Звонки — см. TIMETABLE ниже.
  };

  /* ========================================================= */


  /* =========================================================
     ЗВОНКИ. Каждая пара — две половины по 45 минут.
     Ключ — номер пары так, как он указан на сайте колледжа.
     В понедельник слот 3 занят кураторским часом, поэтому
     «3 пара» и «4 пара» по звонкам — это слоты 4 и 5 на сайте.
     ========================================================= */
  const FIRST_HALF = {
    1: [['08:30', '09:15'], ['09:20', '10:05']],
    2: [['10:15', '11:00'], ['11:05', '11:50']],
  };

  const MONDAY = {
    slots: {
      ...FIRST_HALF,
      3: [['12:00', '12:45']], // кураторский час
      4: [['13:30', '14:15'], ['14:20', '15:05']],
      5: [['15:15', '16:00'], ['16:05', '16:50']],
    },
    lunch: { after: 3, time: ['12:45', '13:30'] },
  };

  const TUE_FRI = {
    slots: {
      ...FIRST_HALF,
      3: [['12:30', '13:15'], ['13:20', '14:05']],
      4: [['14:15', '15:00'], ['15:05', '15:50']],
    },
    lunch: { after: 2, time: ['11:50', '12:30'] },
  };

  // Пн … Вс. Для субботы звонков нет — время просто не показывается.
  const TIMETABLE = [MONDAY, TUE_FRI, TUE_FRI, TUE_FRI, TUE_FRI, null, null];

  function pairRange(dayIdx, pair) {
    const slots = TIMETABLE[dayIdx]?.slots[pair];
    return slots ? [slots[0][0], slots[slots.length - 1][1]] : null;
  }

  const DAY_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const $ = (id) => document.getElementById(id);
  const els = {
    groupName: $('groupName'),
    groupBtn: $('groupBtn'),
    refreshBtn: $('refreshBtn'),
    status: $('status'),
    weeks: $('weeks'),
    days: $('days'),
    board: $('board'),
    picker: $('picker'),
    pickerSearch: $('pickerSearch'),
    pickerList: $('pickerList'),
    pickerClose: $('pickerClose'),
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  let page = new URLSearchParams(location.search).get('page') || store.get('page') || CONFIG.defaultPage;
  let data = null;
  let viewWeek = null;
  let viewDay = null;
  let lastCheck = null;
  let loading = false;

  /* ---------- Даты ---------- */

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }

  function currentWeekNumber(d) {
    const odd = isoWeek(d) % 2 === 1;
    return odd ? CONFIG.oddIsoWeekIs : 3 - CONFIG.oddIsoWeekIs;
  }

  const mondayOf = (d) => {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  };

  const pad = (n) => String(n).padStart(2, '0');
  const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

  /* ---------- Цвет предмета: один предмет — один цвет ---------- */

  function hueFor(text) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  /* ---------- Состояние «сегодня» ---------- */

  function todayState() {
    const now = new Date();
    const cur = currentWeekNumber(now);
    const idx = (now.getDay() + 6) % 7;
    return { now, cur, idx };
  }

  function weekNumbers() {
    return data ? data.weeks.map((w) => w.number) : [];
  }

  function resetView() {
    const nums = weekNumbers();
    const { cur, idx } = todayState();
    let week = nums.includes(cur) ? cur : nums[0];
    let day = idx;
    if (idx === 6) { // воскресенье — показываем понедельник следующей недели
      day = 0;
      const other = nums.find((n) => n !== week);
      if (other !== undefined) week = other;
    }
    viewWeek = week;
    viewDay = day;
  }

  /* ---------- Отрисовка ---------- */

  function render() {
    if (!data) return;

    els.groupName.textContent = data.name || page;
    document.title = `Расписание ${data.name || ''}`.trim();

    const nums = weekNumbers();
    if (viewWeek === null || !nums.includes(viewWeek)) resetView();

    renderWeeks(nums);
    renderDays();
    renderBoard();
    renderStatus();
  }

  function renderWeeks(nums) {
    if (nums.length < 2) { els.weeks.hidden = true; return; }
    els.weeks.hidden = false;
    els.weeks.innerHTML = nums
      .map((n) => `<button type="button" data-week="${n}" aria-pressed="${n === viewWeek}">Неделя ${n}</button>`)
      .join('');
  }

  function weekDays() {
    const w = data.weeks.find((x) => x.number === viewWeek) || data.weeks[0];
    return w.days;
  }

  function dayDate(i) {
    const { now, cur } = todayState();
    const d = mondayOf(now);
    d.setDate(d.getDate() + i + (viewWeek === cur ? 0 : 7));
    return d;
  }

  function isTodayCell(i) {
    const { cur, idx } = todayState();
    return viewWeek === cur && i === idx;
  }

  function visibleDayIndexes() {
    const days = weekDays();
    return days.map((_, i) => i).filter((i) => i < 6 || days[i].lessons.length > 0);
  }

  function renderDays() {
    const days = weekDays();
    els.days.innerHTML = visibleDayIndexes().map((i) => {
      const d = dayDate(i);
      const cls = ['day-chip', days[i].lessons.length ? 'has' : '', isTodayCell(i) ? 'today' : ''].join(' ').trim();
      return `<button type="button" class="${cls}" data-day="${i}" aria-pressed="${i === viewDay}" aria-label="${DAY_FULL[i]}, ${d.getDate()} ${MONTHS[d.getMonth()]}">
        <span class="dow">${days[i].name}</span><span class="dnum">${d.getDate()}</span></button>`;
    }).join('');

    const active = els.days.querySelector('[aria-pressed="true"]');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function currentPairNow(dayIdx) {
    const { now } = todayState();
    const mins = now.getHours() * 60 + now.getMinutes();
    const slots = TIMETABLE[dayIdx]?.slots || {};
    for (const pair of Object.keys(slots)) {
      const [from, to] = pairRange(dayIdx, pair);
      if (mins >= toMinutes(from) && mins < toMinutes(to)) return Number(pair);
    }
    return null;
  }

  function pluralPairs(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} пара`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} пары`;
    return `${n} пар`;
  }

  function lessonHtml(l, isNow) {
    const room = l.room
      ? `<div class="room${l.room.length > 3 ? ' long' : ''}">${esc(l.room)}</div>`
      : '<div class="room none">—</div>';
    return `<li class="lesson${isNow ? ' now' : ''}" style="--hue:${hueFor(l.subject)}">
      <div>
        <h3>${esc(l.subject)}</h3>
        ${l.teacher ? `<p class="teacher">${esc(l.teacher)}</p>` : ''}
        ${l.note ? `<p class="note">${esc(l.note)}</p>` : ''}
      </div>${room}</li>`;
  }

  function dayHtml(day, i) {
    const d = dayDate(i);
    const byPair = new Map();
    for (const l of day.lessons) {
      if (!byPair.has(l.pair)) byPair.set(l.pair, []);
      byPair.get(l.pair).push(l);
    }
    const pairs = [...byPair.keys()].sort((a, b) => a - b);
    const nowPair = isTodayCell(i) ? currentPairNow(i) : null;
    const lunch = TIMETABLE[i]?.lunch;

    let body;
    let meta = '';
    if (!pairs.length) {
      body = '<p class="empty">В этот день пар нет</p>';
    } else {
      meta = `${pluralPairs(pairs.length)}, с ${pairs[0]} по ${pairs[pairs.length - 1]}`;
      const rows = [];
      pairs.forEach((p, k) => {
        if (k > 0) {
          const prev = pairs[k - 1];
          if (p - prev > 1) {
            rows.push(`<li class="gap"><p>Окно · ${pluralPairs(p - prev - 1)}</p></li>`);
          } else if (lunch && prev <= lunch.after && p > lunch.after) {
            rows.push(`<li class="gap lunch"><p>Обед · ${esc(lunch.time[0])}–${esc(lunch.time[1])}</p></li>`);
          }
        }
        const t = pairRange(i, p);
        const halves = (TIMETABLE[i]?.slots[p] || []).map((h) => `${h[0]}–${h[1]}`).join(', ');
        rows.push(`<li class="slot">
          <div class="pair"${halves ? ` title="${esc(halves)}"` : ''}><b>${p}</b>${t ? `<span>${esc(t[0])}<br>${esc(t[1])}</span>` : ''}</div>
          <ul class="items slots">${byPair.get(p).map((l) => lessonHtml(l, nowPair === p)).join('')}</ul>
        </li>`);
      });
      body = `<ul class="slots">${rows.join('')}</ul>`;
    }

    const cls = ['day', i === viewDay ? 'active' : '', isTodayCell(i) ? 'today' : '',
      (i === 6 && !pairs.length) ? 'hidden-desktop' : ''].join(' ').trim();

    return `<section class="${cls}" data-day="${i}">
      <div class="day-title">
        <h2>${DAY_FULL[i]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</h2>
        ${meta ? `<span class="meta">${meta}</span>` : ''}
      </div>${body}</section>`;
  }

  function renderBoard() {
    const days = weekDays();
    els.board.innerHTML = visibleDayIndexes().map((i) => dayHtml(days[i], i)).join('');
  }

  function renderStatus(err) {
    if (err) {
      els.status.className = 'status error';
      els.status.textContent = data ? `${err} Показываю сохранённое расписание.` : err;
      return;
    }
    els.status.className = 'status';
    if (!data) return;
    const rows = [];
    rows.push(data.updated
      ? `<span>Расписание на сайте колледжа обновлено: <b>${esc(data.updated)}</b></span>`
      : '<span>Время обновления на сайте колледжа неизвестно</span>');
    if (lastCheck) {
      rows.push(`<span>Приложение проверило сайт в <b>${pad(lastCheck.getHours())}:${pad(lastCheck.getMinutes())}</b></span>`);
    } else if (data.fetchedAt) {
      const f = new Date(data.fetchedAt);
      rows.push(`<span>Сохранено на телефоне в <b>${pad(f.getHours())}:${pad(f.getMinutes())}</b>, идёт проверка…</span>`);
    }
    els.status.innerHTML = rows.join('');
  }

  /* ---------- Загрузка ---------- */

  function readCache() {
    const raw = store.get(`sched:${page}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async function load({ manual = false } = {}) {
    if (loading) return;
    loading = true;
    els.refreshBtn.classList.add('loading');
    els.refreshBtn.disabled = true;
    let json = null;
    let problem = null;
    try {
      let res;
      try {
        // t — «ведро времени»: меняет адрес запроса, и сервер не отдаёт устаревший кэш.
        // Ручное обновление — не чаще раза в минуту на всех, автоматическое — раз в 10 минут.
        const bucket = Math.floor(Date.now() / (manual ? 60000 : CONFIG.refreshMs));
        res = await fetch(`/api/schedule?page=${encodeURIComponent(page)}&t=${bucket}${manual ? 'm' : ''}`, { cache: 'no-cache' });
      } catch {
        throw new Error('Нет связи с сервером.');
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ? `${body.error}.` : `Ошибка сервера ${res.status}.`);
      if (!Array.isArray(body.weeks)) throw new Error('Сервер вернул неожиданный ответ.');
      json = body;
    } catch (e) {
      problem = e.message;
    }

    loading = false;
    els.refreshBtn.classList.remove('loading');
    els.refreshBtn.disabled = false;

    if (problem) { renderStatus(problem); return; }

    data = json;
    lastCheck = new Date();
    store.set(`sched:${page}`, JSON.stringify(json));
    render();
  }

  /* ---------- События ---------- */

  els.weeks.addEventListener('click', (e) => {
    const b = e.target.closest('[data-week]');
    if (!b) return;
    viewWeek = Number(b.dataset.week);
    render();
  });

  els.days.addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    viewDay = Number(b.dataset.day);
    renderDays();
    renderBoard();
  });

  els.refreshBtn.addEventListener('click', () => load({ manual: true }));

  setInterval(() => load(), CONFIG.refreshMs);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!lastCheck || Date.now() - lastCheck > CONFIG.refreshMs)) {
      load();
    }
  });

  /* ---------- Выбор группы ---------- */

  let groups = null;

  function renderGroups() {
    const q = els.pickerSearch.value.trim().toLowerCase();
    const list = (groups || []).filter((g) => g.name.toLowerCase().includes(q));
    els.pickerList.innerHTML = list.length
      ? list.map((g) => `<li><button type="button" data-page="${esc(g.page)}"${g.page === page ? ' aria-current="true"' : ''}>${esc(g.name)}</button></li>`).join('')
      : '<li class="msg">Ничего не найдено</li>';
  }

  async function openPicker() {
    els.picker.showModal();
    els.pickerSearch.value = '';
    els.pickerSearch.focus();
    if (groups) { renderGroups(); return; }
    els.pickerList.innerHTML = '<li class="msg">Загружаю список групп…</li>';
    try {
      const res = await fetch('/api/groups');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      groups = json.groups;
      renderGroups();
    } catch {
      els.pickerList.innerHTML = '<li class="msg">Не удалось загрузить список групп. Проверь соединение и попробуй ещё раз.</li>';
    }
  }

  els.groupBtn.addEventListener('click', openPicker);
  els.pickerClose.addEventListener('click', () => els.picker.close());
  els.pickerSearch.addEventListener('input', renderGroups);
  els.picker.addEventListener('click', (e) => { if (e.target === els.picker) els.picker.close(); });

  els.pickerList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    page = b.dataset.page;
    store.set('page', page);
    history.replaceState(null, '', location.pathname);
    els.picker.close();
    data = null;
    viewWeek = null;
    els.board.innerHTML = '';
    els.days.innerHTML = '';
    els.status.textContent = 'Загружаю расписание…';
    const cached = readCache();
    if (cached) { data = cached; render(); }
    load();
  });

  /* ---------- Старт: сначала кэш (мгновенно), потом свежие данные ---------- */

  const cached = readCache();
  if (cached) { data = cached; render(); }
  load();
})();
