(() => {
  'use strict';

  /* =========================================================
     Настройки
     ========================================================= */
  const CONFIG = {
    // Группа по умолчанию (страница вида bg203.htm на сайте колледжа)

    // Как часто приложение проверяет сайт колледжа, пока страница открыта.
    // Значения должны совпадать с lib/refreshWindow.js, иначе интервалы опроса
    // и время жизни серверного кэша разойдутся.
    peakStartHourMsk: 6, // с 6:00 МСК…
    peakEndHourMsk: 17, // …до 17:00 МСК — учебные часы, проверяем чаще
    peakRefreshMs: 30 * 60 * 1000, // раз в 30 минут
    offPeakRefreshMs: 2 * 60 * 60 * 1000, // в остальное время — раз в 2 часа

    // Номер недели расписания, которая приходится на нечётные недели года (ISO-нумерация).
    // Значение должно совпадать с ODD_ISO_WEEK_IS в lib/weekCycle.js.
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
    statusBtn: $('statusBtn'),
    statusText: $('statusText'),
    weeks: $('weeks'),
    subgroups: $('subgroups'),
    days: $('days'),
    board: $('board'),
    homeView: $('homeView'),
    scheduleView: $('scheduleView'),
    homeBack: $('homeBack'),
    homeBackName: $('homeBackName'),
    homeSearch: $('homeSearch'),
    homeClear: $('homeClear'),
    homeCount: $('homeCount'),
    tiles: $('tiles'),
    homeEmpty: $('homeEmpty'),
    tgLink: $('tgLink'),
    tgCopy: $('tgCopy'),
    tgNote: $('tgNote'),
    infoDialog: $('infoDialog'),
    infoBody: $('infoBody'),
    infoClose: $('infoClose'),
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // Группа: из адреса (?page=…) или запомненная на этом устройстве. Если её нет — человек
  // впервые на сайте, и вместо расписания показывается главная с выбором группы.
  let page = new URLSearchParams(location.search).get('page') || store.get('page') || '';
  let view = 'schedule'; // 'home' | 'schedule'
  let data = null;
  let mySub = Number(store.get('sub')) || null; // null = показывать всех
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

  /* ---------- Цвет предмета ----------
     Один предмет — один цвет. Сначала подбираем по ключевым словам,
     если ничего не подошло — стабильно выбираем из палитры по хешу названия. */

  const SUBJECT_RULES = [
    [/граф/i, '#D97757'],                                    // графдизайн
    [/разраб|проектир|интерфейс|оптимиз/i, '#94A37C'],       // разработка
    [/язык/i, '#C9A25E'],                                    // иностранный язык
    [/безопас/i, '#A6808F'],                                 // безопасность
    [/прав|философ|куратор/i, '#B06A5E'],                    // право / философия
    [/физ/i, '#9C8877'],                                     // физра / прочее
  ];

  const SUBJECT_FALLBACK = ['#D97757', '#94A37C', '#C9A25E', '#A6808F', '#B06A5E', '#9C8877'];

  function hueFor(text) {
    const s = String(text || '');
    for (const [re, color] of SUBJECT_RULES) {
      if (re.test(s)) return color;
    }
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 997;
    return SUBJECT_FALLBACK[h % SUBJECT_FALLBACK.length];
  }

  /* ---------- Состояние «сегодня» ---------- */

  // Текущий момент времени как «настенные часы» в Москве, независимо от часового
  // пояса устройства: epoch-время абсолютно и от часового пояса не зависит, поэтому
  // просто сдвигаем его на +3 часа и читаем UTC-компоненты — это и есть время в Москве.
  // Дальше с этим объектом можно работать как с обычной локальной датой
  // (getHours, getDay, getDate...) — все они уже вернут московские значения.
  function mskNow() {
    const s = new Date(Date.now() + 3 * 3600000);
    return new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds());
  }

  function todayState() {
    const now = mskNow();
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
    renderSubgroups();
    renderDays();
    renderBoard();
    renderStatus();
  }

  /* ---------- Подгруппы ---------- */

  function allSubgroups() {
    const set = new Set();
    if (data) {
      for (const w of data.weeks) for (const d of w.days) for (const l of d.lessons) {
        if (l.subgroup) set.add(l.subgroup);
      }
    }
    return [...set].sort((a, b) => a - b);
  }

  // Подгруппа, которую реально применяем (сохранённая могла исчезнуть из расписания)
  function activeSub() {
    return mySub && allSubgroups().includes(mySub) ? mySub : null;
  }

  function lessonsOf(day) {
    const sub = activeSub();
    return day.lessons.filter((l) => !l.subgroup || !sub || l.subgroup === sub);
  }

  function renderSubgroups() {
    const subs = allSubgroups();
    if (!subs.length) { els.subgroups.hidden = true; return; }
    const sub = activeSub();
    els.subgroups.hidden = false;
    els.subgroups.innerHTML =
      `<button type="button" data-sub="" aria-pressed="${sub === null}">Все</button>` +
      subs.map((n) => `<button type="button" data-sub="${n}" aria-pressed="${sub === n}">${n} подгр.</button>`).join('');
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

  function daysOfWeek(weekNumber) {
    const w = data.weeks.find((x) => x.number === weekNumber);
    return w ? w.days : [];
  }

  function dayDateFor(weekNumber, i) {
    const { now, cur } = todayState();
    const d = mondayOf(now);
    d.setDate(d.getDate() + i + (weekNumber === cur ? 0 : 7));
    return d;
  }

  function isTodayCellFor(weekNumber, i) {
    const { cur, idx } = todayState();
    return weekNumber === cur && i === idx;
  }

  function visibleDayIndexesFor(weekNumber) {
    const days = daysOfWeek(weekNumber);
    return days.map((_, i) => i).filter((i) => i < 6 || lessonsOf(days[i]).length > 0);
  }

  function dayDate(i) { return dayDateFor(viewWeek, i); }
  function isTodayCell(i) { return isTodayCellFor(viewWeek, i); }
  function visibleDayIndexes() { return visibleDayIndexesFor(viewWeek); }

  // Полоса дней на телефоне — один сплошной скролл: сначала дни текущей недели,
  // затем (без дополнительных нажатий) дни следующей, с лёгким разделителем между ними.
  // На широких экранах эта полоса всё равно скрыта (см. CSS), так что здесь не нужно
  // отдельной ветки для десктопа.
  function renderDays() {
    const nums = weekNumbers();
    const { cur } = todayState();
    const other = nums.find((n) => n !== cur);
    const order = [cur, other].filter((n) => nums.includes(n));

    let html = '';
    order.forEach((weekNumber, orderIdx) => {
      const days = daysOfWeek(weekNumber);
      if (!days.length) return;
      if (orderIdx > 0) {
        html += `<span class="day-sep" aria-hidden="true"><span>Неделя ${weekNumber}</span></span>`;
      }
      html += visibleDayIndexesFor(weekNumber).map((i) => {
        const d = dayDateFor(weekNumber, i);
        const cls = ['day-chip', lessonsOf(days[i]).length ? 'has' : '', isTodayCellFor(weekNumber, i) ? 'today' : ''].join(' ').trim();
        const pressed = weekNumber === viewWeek && i === viewDay;
        return `<button type="button" class="${cls}" data-week="${weekNumber}" data-day="${i}" aria-pressed="${pressed}" aria-label="${DAY_FULL[i]}, ${d.getDate()} ${MONTHS[d.getMonth()]}">
          <span class="dow">${days[i].name}</span><span class="dnum">${d.getDate()}</span></button>`;
      }).join('');
    });

    els.days.innerHTML = html;

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

  function isLunchNow(dayIdx) {
    const lunch = TIMETABLE[dayIdx]?.lunch;
    if (!lunch) return false;
    const { now } = todayState();
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= toMinutes(lunch.time[0]) && mins < toMinutes(lunch.time[1]);
  }

  function pluralPairs(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} пара`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} пары`;
    return `${n} пар`;
  }

  /* ---------- Отметка об изменении пары ---------- */

  const CHANGE_TTL_MS = 24 * 3600000;

  // Отметка показывается 24 часа с момента изменения. Срок проверяется и на клиенте,
  // потому что ответ сервера может прийти из кэша браузера или CDN.
  function isFreshChange(l) {
    if (!l.changedAt || (l.changeSource !== 'auto' && l.changeSource !== 'manual')) return false;
    const age = Date.now() - Date.parse(l.changedAt);
    return age >= 0 && age < CHANGE_TTL_MS;
  }

  // Тот же значок, что и у строки состояния вверху страницы.
  const INFO_ICON = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="8.2"/><path d="M10 9.2v5" stroke-linecap="round"/><circle cx="10" cy="6.3" r="0.9" fill="currentColor" stroke="none"/></svg>';

  function changeMarkHtml(l) {
    if (!isFreshChange(l)) return '';
    return `<button type="button" class="chg" data-at="${esc(l.changedAt)}" data-src="${l.changeSource}" aria-expanded="false" aria-label="Пара изменена. Показать подробности">${INFO_ICON}</button>`;
  }

  // Время изменения по Москве: «Сегодня, 14:32», «Вчера, 09:05» или «25 октября, 14:32».
  function formatChangeTime(iso) {
    const shift = (ms) => new Date(ms + 3 * 3600000);
    const at = shift(Date.parse(iso));
    const now = shift(Date.now());
    const dayNumber = (d) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
    const diff = dayNumber(now) - dayNumber(at);
    const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
    if (diff === 0) return `Сегодня, ${time} МСК`;
    if (diff === 1) return `Вчера, ${time} МСК`;
    return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}, ${time} МСК`;
  }

  function lessonHtml(l, isNow) {
    const room = l.room
      ? `<div class="room${l.room.length > 3 ? ' long' : ''}">${esc(l.room)}</div>`
      : '<div class="room none">—</div>';
    return `<li class="lesson${isNow ? ' now' : ''}" style="--subj:${hueFor(l.subject)}">
      <div>
        <h3>${esc(l.subject)}</h3>
        ${l.teacher ? `<p class="teacher">${esc(l.teacher)}</p>` : ''}
        ${l.subgroup && !activeSub() ? `<p class="sub-row"><span class="sub">${l.subgroup} подгруппа</span></p>` : ''}
        ${l.note ? `<p class="note">${esc(l.note)}</p>` : ''}
      </div><div class="room-cell">${changeMarkHtml(l)}${room}</div></li>`;
  }

  function dayHtml(day, i) {
    const d = dayDate(i);
    const byPair = new Map();
    for (const l of lessonsOf(day)) {
      if (!byPair.has(l.pair)) byPair.set(l.pair, []);
      byPair.get(l.pair).push(l);
    }
    const pairs = [...byPair.keys()].sort((a, b) => a - b);
    const isToday = isTodayCell(i);
    const nowPair = isToday ? currentPairNow(i) : null;
    const lunch = TIMETABLE[i]?.lunch;
    const lunchNow = isToday && isLunchNow(i);

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
            rows.push(`<li class="gap lunch${lunchNow ? ' now' : ''}"><p>Обед · ${esc(lunch.time[0])}–${esc(lunch.time[1])}</p></li>`);
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
    closeChangeTip();
    els.board.innerHTML = visibleDayIndexes().map((i) => dayHtml(days[i], i)).join('');
  }

  /* ---------- Подсказка у отметки изменения ---------- */

  const changeTip = document.createElement('div');
  changeTip.className = 'chg-tip';
  changeTip.setAttribute('role', 'tooltip');
  changeTip.hidden = true;
  document.body.appendChild(changeTip);
  let changeTipOwner = null;

  function closeChangeTip() {
    changeTip.hidden = true;
    if (changeTipOwner) changeTipOwner.setAttribute('aria-expanded', 'false');
    changeTipOwner = null;
  }

  function openChangeTip(button) {
    const auto = button.dataset.src === 'auto';
    changeTip.innerHTML =
      `<b>${auto ? 'Изменено автоматически' : 'Изменено вручную'}</b>` +
      `<span>${esc(formatChangeTime(button.dataset.at))}</span>`;
    changeTip.hidden = false;

    const rect = button.getBoundingClientRect();
    const tipRect = changeTip.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - tipRect.width / 2), window.innerWidth - tipRect.width - margin);
    const below = rect.bottom + margin + tipRect.height <= window.innerHeight;
    changeTip.style.left = `${left}px`;
    changeTip.style.top = `${below ? rect.bottom + margin : Math.max(margin, rect.top - tipRect.height - margin)}px`;

    changeTipOwner = button;
    button.setAttribute('aria-expanded', 'true');
  }

  els.board.addEventListener('click', (e) => {
    const button = e.target.closest('.chg');
    if (!button) return;
    const wasOpen = changeTipOwner === button;
    closeChangeTip();
    if (!wasOpen) openChangeTip(button);
  });

  document.addEventListener('click', (e) => {
    if (changeTipOwner && !e.target.closest('.chg') && !changeTip.contains(e.target)) closeChangeTip();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChangeTip(); });
  window.addEventListener('scroll', closeChangeTip, { passive: true });
  window.addEventListener('resize', closeChangeTip);

  // Строка статуса умещается в одну строку (при нехватке места обрезается многоточием),
  // а полное объяснение — в диалоге по нажатию (см. renderInfoDialog).
  let lastProblem = null;

  function renderStatus(err) {
    lastProblem = err || null;
    els.statusBtn.classList.toggle('error', !!err);

    if (err) {
      els.statusText.textContent = data ? `${err} Показываю сохранённое.` : err;
      return;
    }
    if (!data) return;

    const parts = [];
    parts.push(data.updated ? `Обновлено ${data.updated}` : 'Дата обновления на сайте неизвестна');
    if (lastCheck) {
      parts.push(`проверено в ${pad(lastCheck.getHours())}:${pad(lastCheck.getMinutes())}`);
    } else if (data.fetchedAt) {
      const f = new Date(data.fetchedAt);
      parts.push(`сохранено в ${pad(f.getHours())}:${pad(f.getMinutes())}`);
    }
    els.statusText.textContent = parts.join(' · ');
  }

  function renderInfoDialog() {
    const rows = [];
    if (lastProblem) {
      rows.push(`<p><b>Не получилось проверить сайт колледжа.</b> ${esc(lastProblem)}</p>`);
    }
    rows.push(`<p><b>«Обновлено»</b> — дата и время, когда колледж в последний раз менял расписание на своём сайте. Это время задаёт сам сайт колледжа, и оно не зависит от приложения: если колледж давно не трогал расписание, дата не изменится, даже если приложение проверяло сайт только что.</p>`);
    if (lastCheck) {
      rows.push(`<p><b>«Проверено»</b> — когда приложение в последний раз заходило на сайт колледжа и сверяло данные: сегодня в ${pad(lastCheck.getHours())}:${pad(lastCheck.getMinutes())}.</p>`);
    }
    rows.push(`<p>Приложение само проверяет сайт по расписанию — чаще в учебные часы, реже ночью. Кнопка «Обновить» рядом с номером группы проверяет сайт прямо сейчас, в обход расписания.</p>`);
    rows.push(`<p><b>Значок слева от аудитории</b> означает, что пару изменили за последние 24 часа. Нажмите на него, чтобы увидеть время изменения и способ: автоматически (расписание обновил колледж) или вручную.</p>`);
    els.infoBody.innerHTML = rows.join('');
  }

  /* ---------- Загрузка ---------- */

  // Московское время не переводится, поэтому МСК = UTC+3 круглый год.
  function autoRefreshMs() {
    const mskHour = (new Date().getUTCHours() + 3) % 24;
    const peak = mskHour >= CONFIG.peakStartHourMsk && mskHour < CONFIG.peakEndHourMsk;
    return peak ? CONFIG.peakRefreshMs : CONFIG.offPeakRefreshMs;
  }

  function readCache() {
    const raw = store.get(`sched:${page}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // Версия приложения берётся из package.json развёрнутого репозитория (поле version)
  // и приходит в ответе /api/schedule; последнее значение хранится для работы без сети.
  function showVersion(version) {
    const el = $('appVersion');
    el.textContent = `v${version}`;
    el.hidden = false;
  }

  const savedVersion = store.get('appVersion');
  if (savedVersion) showVersion(savedVersion);

  // Сервер ответил, что сайт теперь выключен (503) или закрыт паролем (401). Перезагружаем
  // страницу — сервер сам покажет заглушку или форму входа. Не чаще раза в 20 секунд, чтобы
  // при рассинхроне серверов не получилась бесконечная перезагрузка.
  function gateStopped(res, body) {
    if (res.status !== 401 && !(res.status === 503 && body && body.maintenance)) return false;
    let last = 0;
    try { last = Number(sessionStorage.getItem('gateReload')) || 0; } catch { /* нет доступа к хранилищу */ }
    if (Date.now() - last > 20000) {
      try { sessionStorage.setItem('gateReload', String(Date.now())); } catch { /* не страшно */ }
      location.reload();
      return true;
    }
    return false;
  }

  async function load({ manual = false } = {}) {
    if (loading || !page || view !== 'schedule') return;
    loading = true;
    els.refreshBtn.classList.add('loading');
    els.refreshBtn.disabled = true;
    let json = null;
    let problem = null;
    try {
      let res;
      try {
        // t — «ведро времени»: меняет адрес запроса, и сервер не отдаёт устаревший кэш.
        // Ручное обновление — не чаще раза в минуту на всех, автоматическое — раз в 30 минут
        // или раз в 2 часа в зависимости от времени суток (см. autoRefreshMs).
        const bucket = Math.floor(Date.now() / (manual ? 60000 : autoRefreshMs()));
        res = await fetch(`/api/schedule?page=${encodeURIComponent(page)}&t=${bucket}${manual ? 'm' : ''}`, { cache: 'no-cache' });
      } catch {
        throw new Error('Нет связи с сервером.');
      }
      const body = await res.json().catch(() => ({}));
      if (gateStopped(res, body)) { loading = false; return; }
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
    if (json.appVersion) {
      store.set('appVersion', json.appVersion);
      showVersion(json.appVersion);
    }
    store.set(`sched:${page}`, JSON.stringify(json));
    render();
  }

  /* ---------- События ---------- */

  els.subgroups.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sub]');
    if (!b) return;
    mySub = Number(b.dataset.sub) || null;
    store.set('sub', mySub || '');
    render();
  });

  els.weeks.addEventListener('click', (e) => {
    const b = e.target.closest('[data-week]');
    if (!b) return;
    viewWeek = Number(b.dataset.week);
    render();
  });

  els.days.addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    const week = Number(b.dataset.week);
    const weekChanged = week !== viewWeek;
    viewWeek = week;
    viewDay = Number(b.dataset.day);
    if (weekChanged) renderWeeks(weekNumbers());
    renderDays();
    renderBoard();
  });

  els.refreshBtn.addEventListener('click', () => load({ manual: true }));

  // Не setInterval с одним фиксированным числом: интервал должен подстраиваться
  // при переходе через границу учебных часов, поэтому таймер сам себя переназначает.
  let autoRefreshTimer = null;
  function scheduleAutoRefresh() {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = setTimeout(async () => {
      await load();
      scheduleAutoRefresh();
    }, autoRefreshMs());
  }
  scheduleAutoRefresh();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!lastCheck || Date.now() - lastCheck > autoRefreshMs())) {
      load();
      scheduleAutoRefresh();
    }
  });

  /* ---------- Главная: выбор группы ---------- */

  const GROUPS_KEY = 'groups';
  const byName = (x, y) => x.name.localeCompare(y.name, 'ru', { numeric: true });

  function readGroupsCache() {
    try {
      const list = JSON.parse(store.get(GROUPS_KEY));
      return Array.isArray(list) ? list : null;
    } catch { return null; }
  }

  let groups = readGroupsCache(); // показываем сохранённый список сразу, свежий подтягиваем фоном
  let groupsState = groups ? 'ready' : 'loading'; // loading | ready | error

  function filteredGroups() {
    const q = els.homeSearch.value.trim().toLowerCase();
    return (groups || []).filter((g) => g.name.toLowerCase().includes(q));
  }

  function renderTiles() {
    const q = els.homeSearch.value.trim();
    els.homeClear.hidden = !q;
    const list = filteredGroups();
    els.homeCount.textContent = groups ? list.length : '…';
    els.tiles.innerHTML = list.map((g) => (
      `<button class="tile" type="button" data-page="${esc(g.page)}"${g.page === page ? ' aria-current="true"' : ''}>${esc(g.name)}</button>`
    )).join('');

    let msg = '';
    if (!groups && groupsState === 'error') {
      msg = 'Не удалось загрузить список групп. Проверьте соединение.<br><button type="button" data-retry>Повторить</button>';
    } else if (!groups) {
      msg = 'Загружаю список групп…';
    } else if (!list.length) {
      msg = 'Группы с таким номером не найдены.';
    }
    els.homeEmpty.innerHTML = msg;
    els.homeEmpty.hidden = !msg;
  }

  async function loadGroups() {
    groupsState = groups ? 'ready' : 'loading';
    renderTiles();
    try {
      const res = await fetch('/api/groups');
      const json = await res.json();
      if (gateStopped(res, json)) return;
      if (!res.ok || !Array.isArray(json.groups)) throw new Error(json.error || 'bad response');
      groups = json.groups.slice().sort(byName);
      store.set(GROUPS_KEY, JSON.stringify(groups));
      groupsState = 'ready';
    } catch {
      if (!groups) groupsState = 'error'; // есть сохранённый список — молча пользуемся им
    }
    renderTiles();
  }

  function showView(name) {
    view = name;
    els.homeView.hidden = name !== 'home';
    els.scheduleView.hidden = name !== 'schedule';
    window.scrollTo(0, 0);
  }

  // Главная открывается как отдельный «экран» истории: кнопка «Назад» на телефоне
  // возвращает к расписанию, а не уводит с сайта.
  function openHome() {
    if (view === 'home') return;
    if (page) history.pushState({ home: true }, '', location.pathname);
    els.homeSearch.value = '';
    els.homeBack.hidden = !page;
    els.homeBackName.textContent = (data && data.name) || '';
    showView('home');
    loadGroups();
    // На телефоне сразу выезжающая клавиатура мешает выбрать из списка — фокус только на компьютере
    if (!matchMedia('(pointer: coarse)').matches) els.homeSearch.focus();
  }

  function openSchedule() {
    showView('schedule');
    if (!data) { const c = readCache(); if (c) { data = c; render(); } }
    load();
  }

  function chooseGroup(p) {
    if (p !== page) {
      page = p;
      data = null;
      viewWeek = null;
      els.board.innerHTML = '';
      els.days.innerHTML = '';
      els.statusText.textContent = 'Загружаю расписание…';
    }
    store.set('page', page); // запоминаем выбор на этом устройстве
    if (location.search) history.replaceState(history.state, '', location.pathname);
    if (history.state && history.state.home) {
      history.back(); // popstate вернёт на экран расписания и загрузит его
    } else {
      openSchedule();
    }
    sendSignal('ping'); // сообщить статистике новую группу (имя придёт после загрузки)
  }

  els.groupBtn.addEventListener('click', openHome);
  els.homeBack.addEventListener('click', () => { if (history.state && history.state.home) history.back(); else openSchedule(); });
  els.homeSearch.addEventListener('input', renderTiles);
  els.homeSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = filteredGroups()[0];
    if (first && els.homeSearch.value.trim()) chooseGroup(first.page);
  });
  els.homeClear.addEventListener('click', () => { els.homeSearch.value = ''; els.homeSearch.focus(); renderTiles(); });
  els.tiles.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) chooseGroup(b.dataset.page);
  });
  els.homeEmpty.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) loadGroups(); });

  window.addEventListener('popstate', () => {
    if (history.state && history.state.home) {
      els.homeBack.hidden = !page;
      els.homeBackName.textContent = (data && data.name) || '';
      showView('home');
      renderTiles();
      loadGroups();
    } else if (page) {
      openSchedule();
    }
  });

  /* ---------- Подвал: Telegram ---------- */

  // Ссылка https://t.me открывает приложение, если оно есть, а если нет — веб-версию в браузере.
  // Если не открылось совсем (нет Telegram, блокировка), рядом есть кнопка «скопировать».
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* нет доступа к буферу — пробуем старый способ */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  let tgNoteTimer = null;
  els.tgCopy.addEventListener('click', async () => {
    const ok = await copyText('@l_SP_Soft_l');
    els.tgNote.textContent = ok ? 'Скопировано' : 'Не удалось скопировать — введите @l_SP_Soft_l вручную';
    clearTimeout(tgNoteTimer);
    tgNoteTimer = setTimeout(() => { els.tgNote.textContent = ''; }, 2500);
  });

  /* ---------- Пояснение про время обновления ---------- */

  els.statusBtn.addEventListener('click', () => {
    renderInfoDialog();
    els.infoDialog.showModal();
  });
  els.infoClose.addEventListener('click', () => els.infoDialog.close());
  els.infoDialog.addEventListener('click', (e) => { if (e.target === els.infoDialog) els.infoDialog.close(); });

  /* ---------- Статистика посещений ----------
     Анонимный сигнал «я тут» для админской статистики (/admin/stats).
     Отправляется только пока страницей реально пользуются: после 5 минут без
     действий или при сворачивании вкладки сигналы прекращаются, а при уходе
     уходит сигнал «ушёл» — поэтому короткие заходы тоже видны, а забытая
     открытой вкладка не нагружает сервер. */

  const HEARTBEAT_MS = 30 * 1000;
  const IDLE_STOP_MS = 5 * 60 * 1000;
  let lastActivity = Date.now();
  let idle = false;

  function visitorId() {
    let id = store.get('vid');
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      const raw = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      id = raw.replace(/[^A-Za-z0-9-]/g, '');
      store.set('vid', id);
    }
    return id;
  }

  function sendSignal(type) {
    try {
      const body = JSON.stringify({
        vid: visitorId(),
        type,
        group: (data && data.name) || '',
        // Помогают отличить телефон/планшет от компьютера, когда User-Agent их выдаёт за ПК
        touch: navigator.maxTouchPoints || 0,
        w: Math.min(screen.width || 0, screen.height || 0),
      });
      if (type === 'leave' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/visit', new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      } else {
        fetch('/api/visit', { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true }).catch(() => {});
      }
    } catch { /* статистика не должна ломать сайт */ }
  }

  function onActivity() {
    lastActivity = Date.now();
    if (idle) { idle = false; sendSignal('ping'); }
  }
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));

  setInterval(() => {
    if (document.visibilityState !== 'visible' || idle) return;
    if (Date.now() - lastActivity > IDLE_STOP_MS) { idle = true; sendSignal('leave'); return; }
    sendSignal('ping');
  }, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sendSignal('leave');
    } else {
      lastActivity = Date.now();
      idle = false;
      sendSignal('ping');
    }
  });
  window.addEventListener('pagehide', () => sendSignal('leave'));

  /* ---------- Старт ----------
     Группа уже выбрана на этом устройстве — сразу расписание: сначала из кэша (мгновенно),
     потом свежие данные. Не выбрана — главная со списком групп. */

  // Сигнал «открыл страницу» уходит сразу, не дожидаясь загрузки расписания: на телефоне она
  // может идти долго, а свёрнутую вкладку браузер замораживает, и сигнал бы потерялся.
  // Название группы уйдёт со следующим сигналом, когда расписание загрузится.
  sendSignal('load');

  // После перезагрузки браузер помнит служебное состояние истории «экран выбора» — сбрасываем его
  if (history.state && history.state.home) history.replaceState(null, '', location.pathname);

  if (page) {
    showView('schedule');
    const cached = readCache();
    if (cached) { data = cached; render(); }
    load().finally(() => sendSignal('ping'));
  } else {
    showView('home');
    renderTiles();
    loadGroups();
  }
})();
