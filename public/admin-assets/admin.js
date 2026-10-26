/**
 * Интерфейс админки расписания.
 *
 * Редактор работает с двумя неделями (текущей и следующей) выбранной группы.
 * Изменения накапливаются в памяти и отправляются одним запросом по кнопке «Сохранить».
 * Данные и подсказки приходят из API (/api/admin-data, /api/admin-catalog), которое
 * требует действующую сессию.
 */
(function () {
  'use strict';

  var DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  var DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MARK_TTL_MS = 24 * 3600000;
  var DEFAULT_PAGE = 'bg203';
  var SUGGESTION_LIMIT = 40;

  var Autofill = window.Autofill;

  var state = {
    catalog: null,
    catalogError: null,
    page: null,
    groupName: '',
    data: null,
    weeks: [],
    activeWeek: 0,
    activeDay: 0,
    dirty: false,
    busy: false,
    nextUid: 1,
  };

  /* ---------- Вспомогательные функции ---------- */

  function qs(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* хранилище недоступно */ }
    return null;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatDate(iso) {
    var p = iso.split('-');
    return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1];
  }

  function formatShort(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1];
  }

  function formatMoment(iso) {
    var d = new Date(iso);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function api(path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, options || {})).then(function (res) {
      if (res.status === 401) {
        location.reload();
        return new Promise(function () {});
      }
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || ('Ошибка ' + res.status));
        return body;
      });
    });
  }

  function postJson(path, payload) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /* ---------- Модель пар ---------- */

  function newLesson(source) {
    var l = source || {};
    return {
      uid: state.nextUid++,
      pair: l.pair || '',
      subject: l.subject || '',
      teacher: l.teacher || '',
      room: l.room || '',
      subgroup: l.subgroup ? String(l.subgroup) : '',
      note: l.note || '',
      changedAt: l.changedAt || null,
      changeSource: l.changeSource || null,
      teacherAuto: false,
    };
  }

  function signature(l) {
    return [l.pair, l.subject, l.teacher, l.room, l.subgroup, l.note]
      .map(function (v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); })
      .join('|');
  }

  function sameLessons(a, b) {
    if (a.length !== b.length) return false;
    var x = a.map(signature).sort();
    var y = b.map(signature).sort();
    return x.every(function (s, i) { return s === y[i]; });
  }

  function dayIsEdited(week, i) {
    var day = week.days[i];
    return day.override && !sameLessons(day.lessons, week.base[i]);
  }

  function weekIsEdited(week) {
    return week.days.some(function (_, i) { return dayIsEdited(week, i); });
  }

  function activeMark(l) {
    if (!l.changedAt || !l.changeSource) return null;
    var age = Date.now() - Date.parse(l.changedAt);
    return age >= 0 && age < MARK_TTL_MS ? l : null;
  }

  function currentWeek() { return state.weeks[state.activeWeek]; }
  function currentDay() { return currentWeek().days[state.activeDay]; }

  function findLesson(card) {
    var uid = Number(card.getAttribute('data-uid'));
    return currentDay().lessons.filter(function (l) { return l.uid === uid; })[0] || null;
  }

  function buildWeeks(data) {
    return data.weeks.map(function (w) {
      var base = [];
      var days = [];
      for (var i = 0; i < 7; i += 1) {
        var source = w.days[i] ? w.days[i].lessons : [];
        base.push(source.map(function (l) { return newLesson(l); }));
        var stored = w.overrideDays && w.overrideDays[i];
        days.push(stored
          ? { override: true, lessons: stored.map(function (l) { return newLesson(l); }) }
          : { override: false, lessons: source.map(function (l) { return newLesson(l); }) });
      }
      return { weekKey: w.weekKey, number: w.number, current: w.current, dates: w.dates, base: base, days: days };
    });
  }

  /* ---------- Каталог ---------- */

  function groupSubjects() {
    return (state.catalog && state.catalog.subjects && state.catalog.subjects[state.page]) || [];
  }

  function allTeachers() {
    return (state.catalog && state.catalog.teachers) || [];
  }

  function groupsByTeacher(teacher) {
    var key = Autofill.normalizePerson(teacher);
    var out = [];
    if (!state.catalog) return out;
    state.catalog.groups.forEach(function (g) {
      var list = state.catalog.subjects[g.page] || [];
      var teaches = list.some(function (s) {
        return s.teachers.some(function (t) { return Autofill.normalizePerson(t) === key; });
      });
      if (teaches) out.push(g);
    });
    return out;
  }

  /* ---------- Выпадающие списки с поиском ---------- */

  var combo = { input: null, items: [], active: -1 };

  function filterOptions(all, query) {
    var q = Autofill.normalizeText(query);
    if (!q) return all.slice(0, SUGGESTION_LIMIT);
    var starts = [];
    var contains = [];
    all.forEach(function (o) {
      var label = Autofill.normalizeText(o.label);
      if (label.indexOf(q) === 0) starts.push(o);
      else if (label.indexOf(q) > 0) contains.push(o);
    });
    return starts.concat(contains).slice(0, SUGGESTION_LIMIT);
  }

  function optionsFor(input) {
    var kind = input.getAttribute('data-cb');
    var query = input.value;

    if (kind === 'group') {
      var groups = (state.catalog && state.catalog.groups) || [];
      return filterOptions(groups.map(function (g) { return { label: g.name, value: g.page }; }), query);
    }

    if (kind === 'subject') {
      return filterOptions(groupSubjects().map(function (s) {
        return { label: s.subject, value: s.subject, hint: s.teachers[0] || '' };
      }), query);
    }

    if (kind === 'teacher' || kind === 'teacherSearch') {
      var preferred = [];
      if (kind === 'teacher') {
        var card = input.closest('.card');
        var lesson = card && findLesson(card);
        var entry = lesson && Autofill.matchSubject(lesson.subject, groupSubjects());
        preferred = entry ? entry.teachers : [];
      }
      var rest = allTeachers().filter(function (t) { return preferred.indexOf(t) < 0; });
      var list = preferred.concat(rest).map(function (t) {
        return { label: t, value: t, hint: preferred.indexOf(t) >= 0 ? 'по предмету' : '' };
      });
      return filterOptions(list, query);
    }
    return [];
  }

  function listboxOf(input) {
    return input.parentElement.querySelector('.listbox');
  }

  function renderCombo() {
    if (!combo.input) return;
    var list = listboxOf(combo.input);
    if (!list) return;
    if (!combo.items.length) {
      list.innerHTML = '<li class="empty">Ничего не найдено — можно ввести вручную</li>';
    } else {
      list.innerHTML = combo.items.map(function (o, i) {
        return '<li role="option" data-i="' + i + '"' + (i === combo.active ? ' class="active"' : '') + '>' +
          '<span>' + esc(o.label) + '</span>' + (o.hint ? '<span class="hint">' + esc(o.hint) + '</span>' : '') + '</li>';
      }).join('');
    }
    list.hidden = false;
    var active = list.querySelector('.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function openCombo(input) {
    combo.input = input;
    combo.items = optionsFor(input);
    combo.active = -1;
    renderCombo();
  }

  function closeCombo() {
    if (combo.input) {
      var list = listboxOf(combo.input);
      if (list) list.hidden = true;
    }
    combo.input = null;
    combo.items = [];
    combo.active = -1;
  }

  function pickCombo(index) {
    var input = combo.input;
    var option = combo.items[index];
    if (!input || !option) return;
    var kind = input.getAttribute('data-cb');
    closeCombo();

    if (kind === 'group') {
      input.value = option.label;
      selectGroup(option.value);
    } else if (kind === 'teacherSearch') {
      input.value = option.value;
      showTeacherGroups(option.value);
    } else {
      input.value = option.value;
      applyFieldValue(input, option.value, true);
    }
  }

  function bindCombos(root) {
    root.addEventListener('focusin', function (e) {
      if (!e.target.matches || !e.target.matches('input[data-cb]')) return;
      if (e.target.id === 'groupInput') e.target.select();
      openCombo(e.target);
    });

    root.addEventListener('input', function (e) {
      if (e.target.matches && e.target.matches('input[data-cb]')) openCombo(e.target);
    });

    root.addEventListener('keydown', function (e) {
      if (!combo.input || e.target !== combo.input) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var step = e.key === 'ArrowDown' ? 1 : -1;
        var count = combo.items.length;
        if (count) combo.active = (combo.active + step + count) % count;
        renderCombo();
      } else if (e.key === 'Enter' && combo.active >= 0) {
        e.preventDefault();
        pickCombo(combo.active);
      } else if (e.key === 'Escape') {
        closeCombo();
      }
    });

    root.addEventListener('mousedown', function (e) {
      var li = e.target.closest && e.target.closest('.listbox li[data-i]');
      if (!li) return;
      e.preventDefault();
      pickCombo(Number(li.getAttribute('data-i')));
    });

    root.addEventListener('click', function (e) {
      var li = e.target.closest && e.target.closest('.listbox li[data-i]');
      if (li) pickCombo(Number(li.getAttribute('data-i')));
    });

    root.addEventListener('focusin', function (e) {
      if (!window.matchMedia('(max-width: 720px)').matches) return;
      if (!e.target.matches || !e.target.matches('input[data-cb]')) return;
      var target = e.target;
      setTimeout(function () { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 250);
    });

    root.addEventListener('focusout', function (e) {
      if (e.target.matches && e.target.matches('input[data-cb]')) {
        setTimeout(function () { if (combo.input === e.target) closeCombo(); }, 120);
      }
    });
  }

  /* ---------- Разметка ---------- */

  function renderShell() {
    qs('app').innerHTML =
      '<header class="bar">' +
        '<img class="logo" src="/icon-128.png" alt="">' +
        '<div class="bar-title"><h1>Админка расписания</h1><p class="muted" id="meta">Загрузка…</p></div>' +
        '<button type="button" class="btn" id="logoutBtn">Выйти</button>' +
      '</header>' +
      '<section class="toolbar">' +
        '<div class="field grow"><span class="lbl">Группа</span>' +
          '<div class="cb"><input type="text" id="groupInput" data-cb="group" autocomplete="off" aria-label="Группа" placeholder="Начните вводить номер группы"><ul class="listbox" role="listbox" hidden></ul></div>' +
        '</div>' +
        '<div class="field grow"><span class="lbl">Найти преподавателя</span>' +
          '<div class="cb"><input type="text" id="teacherSearch" data-cb="teacherSearch" autocomplete="off" aria-label="Поиск преподавателя" placeholder="Фамилия преподавателя"><ul class="listbox" role="listbox" hidden></ul></div>' +
        '</div>' +
        '<button type="button" class="btn" id="reloadBtn">Обновить с сайта</button>' +
      '</section>' +
      '<div id="teacherGroups"></div>' +
      '<div id="banner"></div>' +
      '<nav class="weeks" id="weeks" aria-label="Неделя"></nav>' +
      '<nav class="days" id="dayStrip" aria-label="День недели"></nav>' +
      '<section class="editor" id="editor"></section>' +
      '<details class="panel desktop-only" id="autofill">' +
        '<summary>Автозаполнение через Gemini</summary>' +
        '<div class="panel-body">' +
          '<ol>' +
            '<li>Выберите, что на фотографии: вся неделя (даты видны на фото) или один день.</li>' +
            '<li>Скопируйте промпт и отправьте его в Gemini вместе с фотографией расписания.</li>' +
            '<li>Вставьте ответ Gemini ниже и нажмите «Применить» — расписание появится в редакторе.</li>' +
            '<li>Проверьте результат и нажмите «Сохранить».</li>' +
          '</ol>' +
          '<div class="modes">' +
            '<label><input type="radio" name="afMode" value="week" checked> Вся неделя</label>' +
            '<label><input type="radio" name="afMode" value="day"> Один день</label>' +
            '<select id="afDate" aria-label="Дата дня" hidden></select>' +
          '</div>' +
          '<div class="field"><span class="lbl">Промпт для Gemini</span><textarea id="afPrompt" readonly aria-label="Промпт для Gemini"></textarea></div>' +
          '<div class="row"><button type="button" class="btn" id="afCopy">Скопировать промпт</button><span class="msg" id="afCopyMsg"></span></div>' +
          '<div class="field"><span class="lbl">Ответ Gemini (JSON)</span><textarea id="afInput" aria-label="Ответ Gemini" placeholder="Вставьте сюда JSON из ответа Gemini"></textarea></div>' +
          '<div class="row"><button type="button" class="btn primary" id="afApply">Применить к редактору</button></div>' +
          '<div id="afReport"></div>' +
        '</div>' +
      '</details>' +
      '<p class="footnote">Правки действуют на текущую и следующую недели и сбрасываются автоматически, когда неделя заканчивается.</p>' +
      '<datalist id="roomList"></datalist>' +
      '<div class="savebar"><div class="inner">' +
        '<button type="button" class="btn primary" id="saveBtn">Сохранить</button>' +
        '<span class="msg" id="statusMsg" role="status"></span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn danger small desktop-only" id="resetBtn">Сбросить все правки группы</button>' +
      '</div></div>';
  }

  function setStatus(text, kind) {
    var el = qs('statusMsg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function renderBanner() {
    var parts = [];
    if (state.data && !state.data.storageConfigured) {
      parts.push('Хранилище GitHub не настроено — изменения сохранить не получится. Подробности в README, раздел «Развёртывание».');
    }
    if (state.catalogError) {
      parts.push('Каталог предметов недоступен (' + esc(state.catalogError) + '). Подсказки отключены, поля можно заполнять вручную.');
    }
    qs('banner').innerHTML = parts.map(function (t) { return '<div class="banner">' + t + '</div>'; }).join('');
  }

  function renderMeta() {
    if (!state.data) return;
    var text = 'Группа ' + state.groupName;
    if (state.data.updated) text += ' · на сайте колледжа обновлено ' + state.data.updated;
    qs('meta').textContent = text;
    qs('groupInput').value = state.groupName;
  }

  function renderWeeks() {
    qs('weeks').innerHTML = state.weeks.map(function (w, i) {
      var range = formatShort(w.dates[0]) + '–' + formatShort(w.dates[6]);
      return '<button type="button" data-week="' + i + '" aria-pressed="' + (i === state.activeWeek) + '"' +
        (weekIsEdited(w) ? ' class="edited"' : '') + '>' +
        '<b>Неделя ' + w.number + '</b><span>' + range + (w.current ? ' · текущая' : ' · следующая') + '</span></button>';
    }).join('');
  }

  function renderDayStrip() {
    var week = currentWeek();
    var html = '';
    for (var i = 0; i < 7; i += 1) {
      if (i === 6 && !week.base[6].length && !week.days[6].lessons.length) continue;
      var cls = dayIsEdited(week, i) ? ' class="edited"' : '';
      html += '<button type="button" data-day="' + i + '"' + cls + ' aria-pressed="' + (i === state.activeDay) + '">' +
        '<span class="dow">' + DAY_SHORT[i] + '</span><span class="dnum">' + week.dates[i].slice(8) + '</span></button>';
    }
    qs('dayStrip').innerHTML = html;
  }

  function markText(l) {
    var source = l.changeSource === 'auto' ? 'автоматически' : 'вручную';
    return 'Метка на сайте · ' + source + ', ' + formatMoment(l.changedAt);
  }

  function cardHtml(l) {
    var mark = activeMark(l);
    var subgroupOptions = [['', 'Вся группа'], ['1', '1 подгр.'], ['2', '2 подгр.']].map(function (o) {
      return '<option value="' + o[0] + '"' + (String(l.subgroup) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');

    return '<article class="card" data-uid="' + l.uid + '">' +
      '<div class="card-top">' +
        '<label class="pair">№ пары <input type="number" min="1" max="9" data-field="pair" value="' + esc(l.pair) + '" aria-label="Номер пары"></label>' +
        (mark ? '<span class="mark">' + esc(markText(mark)) + '</span>' : '<span class="spacer"></span>') +
        '<button type="button" class="icon-btn" data-action="remove" aria-label="Удалить пару" title="Удалить пару">✕</button>' +
      '</div>' +
      '<div class="field"><span class="lbl">Предмет</span><div class="cb">' +
        '<input type="text" data-field="subject" data-cb="subject" autocomplete="off" aria-label="Предмет" value="' + esc(l.subject) + '" placeholder="Начните вводить название">' +
        '<ul class="listbox" role="listbox" hidden></ul></div></div>' +
      '<div class="field"><span class="lbl">Преподаватель</span><div class="cb">' +
        '<input type="text" data-field="teacher" data-cb="teacher" autocomplete="off" aria-label="Преподаватель" value="' + esc(l.teacher) + '" placeholder="Подставится по предмету">' +
        '<ul class="listbox" role="listbox" hidden></ul></div></div>' +
      '<div class="card-row">' +
        '<div class="field"><span class="lbl">Аудитория</span><input type="text" list="roomList" data-field="room" aria-label="Аудитория" value="' + esc(l.room) + '"></div>' +
        '<div class="field"><span class="lbl">Подгруппа</span><select data-field="subgroup" aria-label="Подгруппа">' + subgroupOptions + '</select></div>' +
      '</div>' +
      '<div class="field"><span class="lbl">Заметка</span><input type="text" data-field="note" aria-label="Заметка" value="' + esc(l.note) + '"></div>' +
    '</article>';
  }

  function renderEditor() {
    var week = currentWeek();
    var day = currentDay();
    var i = state.activeDay;
    var edited = dayIsEdited(week, i);
    var lessons = day.lessons.slice().sort(function (a, b) { return (Number(a.pair) || 99) - (Number(b.pair) || 99); });

    qs('editor').innerHTML =
      '<div class="day-head">' +
        '<div class="titles"><h2>' + DAY_NAMES[i] + ', ' + formatDate(week.dates[i]) + '</h2>' +
        '<span class="badge' + (edited ? ' edited' : '') + '" id="dayBadge">' + (edited ? 'Изменено вручную' : 'Как на сайте колледжа') + '</span></div>' +
        '<button type="button" class="btn small" data-action="resetDay"' + (edited ? '' : ' disabled') + ' id="resetDayBtn">Вернуть как на сайте</button>' +
      '</div>' +
      (lessons.length ? '<div class="cards">' + lessons.map(cardHtml).join('') + '</div>' : '<div class="empty">В этот день пар нет</div>') +
      '<button type="button" class="btn add" data-action="add">+ Добавить пару</button>';
  }

  function renderRooms() {
    var rooms = (state.catalog && state.catalog.rooms && state.catalog.rooms[state.page]) || [];
    qs('roomList').innerHTML = rooms.map(function (r) { return '<option value="' + esc(r) + '"></option>'; }).join('');
  }

  /** Обновляет индикаторы без перерисовки карточек, чтобы не терять фокус при вводе. */
  function updateChrome() {
    var week = currentWeek();
    var edited = dayIsEdited(week, state.activeDay);
    var badge = qs('dayBadge');
    if (badge) {
      badge.textContent = edited ? 'Изменено вручную' : 'Как на сайте колледжа';
      badge.className = 'badge' + (edited ? ' edited' : '');
    }
    var resetBtn = qs('resetDayBtn');
    if (resetBtn) resetBtn.disabled = !edited;

    var chips = qs('dayStrip').querySelectorAll('button[data-day]');
    Array.prototype.forEach.call(chips, function (b) {
      b.classList.toggle('edited', dayIsEdited(week, Number(b.getAttribute('data-day'))));
    });
    var tabs = qs('weeks').querySelectorAll('button[data-week]');
    Array.prototype.forEach.call(tabs, function (b) {
      b.classList.toggle('edited', weekIsEdited(state.weeks[Number(b.getAttribute('data-week'))]));
    });
    qs('saveBtn').disabled = state.busy || !state.dirty || !(state.data && state.data.storageConfigured);
  }

  function renderAll() {
    renderMeta();
    renderBanner();
    renderWeeks();
    renderDayStrip();
    renderEditor();
    renderRooms();
    refreshAutofill();
    updateChrome();
  }

  /* ---------- Редактирование ---------- */

  function touch() {
    currentDay().override = true;
    state.dirty = true;
    updateChrome();
  }

  /** Записывает значение поля в модель; fromPick — значение выбрано из списка. */
  function applyFieldValue(input, value, fromPick) {
    var card = input.closest('.card');
    var lesson = card && findLesson(card);
    var field = input.getAttribute('data-field');
    if (!lesson || !field) return;

    lesson[field] = value;

    if (field === 'teacher') lesson.teacherAuto = false;

    if (field === 'subject') {
      var entry = Autofill.matchSubject(value, groupSubjects());
      var exact = entry && Autofill.normalizeText(entry.subject) === Autofill.normalizeText(value);
      if (exact && (fromPick || !lesson.teacher || lesson.teacherAuto) && entry.teachers.length) {
        if (!lesson.teacher || lesson.teacherAuto) {
          lesson.teacher = entry.teachers[0];
          lesson.teacherAuto = true;
          card.querySelector('[data-field="teacher"]').value = lesson.teacher;
        }
      }
    }
    touch();
  }

  function addLesson() {
    var day = currentDay();
    var pairs = day.lessons.map(function (l) { return Number(l.pair) || 0; });
    var next = Math.min(9, (pairs.length ? Math.max.apply(null, pairs) : 0) + 1);
    var lesson = newLesson({ pair: next });
    day.lessons.push(lesson);
    touch();
    renderEditor();
    var card = qs('editor').querySelector('[data-uid="' + lesson.uid + '"] [data-field="subject"]');
    if (card) card.focus();
  }

  function removeLesson(card) {
    var uid = Number(card.getAttribute('data-uid'));
    var day = currentDay();
    day.lessons = day.lessons.filter(function (l) { return l.uid !== uid; });
    touch();
    renderEditor();
  }

  function resetDay() {
    var week = currentWeek();
    var i = state.activeDay;
    week.days[i] = { override: false, lessons: week.base[i].map(function (l) { return newLesson(l); }) };
    state.dirty = true;
    renderEditor();
    updateChrome();
  }

  function bindEditor() {
    var editor = qs('editor');

    editor.addEventListener('input', function (e) {
      var input = e.target;
      if (!input.getAttribute || !input.getAttribute('data-field')) return;
      applyFieldValue(input, input.value, false);
    });

    editor.addEventListener('change', function (e) {
      var input = e.target;
      if (input.getAttribute && input.getAttribute('data-field') === 'subject') applyFieldValue(input, input.value, false);
    });

    editor.addEventListener('click', function (e) {
      var button = e.target.closest && e.target.closest('[data-action]');
      if (!button) return;
      var action = button.getAttribute('data-action');
      if (action === 'add') addLesson();
      else if (action === 'remove') removeLesson(button.closest('.card'));
      else if (action === 'resetDay') resetDay();
    });
  }

  /* ---------- Навигация ---------- */

  function defaultView() {
    var now = new Date();
    var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    for (var w = 0; w < state.weeks.length; w += 1) {
      var idx = state.weeks[w].dates.indexOf(today);
      if (idx < 0) continue;
      if (idx === 6 && state.weeks[w + 1]) return { week: w + 1, day: 0 };
      return { week: w, day: idx };
    }
    return { week: 0, day: 0 };
  }

  function confirmDiscard() {
    return !state.dirty || window.confirm('Есть несохранённые изменения. Продолжить без сохранения?');
  }

  function loadData(page, options) {
    var keepView = options && options.keepView;
    setStatus('Загрузка…');
    return api('/api/admin-data?page=' + encodeURIComponent(page)).then(function (data) {
      state.page = page;
      state.data = data;
      state.groupName = data.name || page;
      state.weeks = buildWeeks(data);
      state.dirty = false;
      store('admin:page', page);
      if (!keepView) {
        var view = defaultView();
        state.activeWeek = view.week;
        state.activeDay = view.day;
      }
      renderAll();
      setStatus('');
    }).catch(function (e) {
      setStatus(e.message, 'err');
    });
  }

  function selectGroup(page) {
    if (page === state.page) return;
    if (!confirmDiscard()) { qs('groupInput').value = state.groupName; return; }
    loadData(page);
  }

  function showTeacherGroups(teacher) {
    var groups = groupsByTeacher(teacher);
    qs('teacherGroups').innerHTML = groups.length
      ? '<p class="muted">' + esc(teacher) + ' ведёт занятия у групп:</p><div class="chips">' +
        groups.map(function (g) { return '<button type="button" class="chip" data-group="' + esc(g.page) + '">' + esc(g.name) + '</button>'; }).join('') + '</div>'
      : '<p class="muted">Для преподавателя ' + esc(teacher) + ' групп не найдено.</p>';
  }

  /* ---------- Сохранение ---------- */

  function collectPayload() {
    var weeks = {};
    var problem = null;

    state.weeks.forEach(function (w, wi) {
      var days = {};
      w.days.forEach(function (d, i) {
        if (!dayIsEdited(w, i)) return;
        var lessons = [];
        d.lessons.forEach(function (l) {
          var pair = Number(l.pair);
          var subject = String(l.subject || '').trim();
          if (!subject && !l.pair) return;
          if (!subject || !(pair >= 1 && pair <= 9)) {
            if (!problem) problem = { week: wi, day: i };
            return;
          }
          lessons.push({
            pair: pair,
            subject: subject,
            teacher: String(l.teacher || '').trim() || null,
            room: String(l.room || '').trim() || null,
            subgroup: l.subgroup ? Number(l.subgroup) : null,
            note: String(l.note || '').trim() || null,
          });
        });
        days[i] = lessons;
      });
      weeks[w.weekKey] = { days: days };
    });
    return { weeks: weeks, problem: problem };
  }

  function save() {
    var collected = collectPayload();
    if (collected.problem) {
      state.activeWeek = collected.problem.week;
      state.activeDay = collected.problem.day;
      renderWeeks();
      renderDayStrip();
      renderEditor();
      setStatus('У каждой пары должны быть номер (1–9) и предмет.', 'err');
      return;
    }

    state.busy = true;
    updateChrome();
    setStatus('Сохраняю…');
    postJson('/api/admin-save', { page: state.page, weeks: collected.weeks }).then(function () {
      state.busy = false;
      return loadData(state.page, { keepView: true }).then(function () {
        setStatus('Сохранено. Сайт покажет изменения после обновления кэша (до 30 минут) или по кнопке «Обновить».', 'ok');
      });
    }).catch(function (e) {
      state.busy = false;
      updateChrome();
      setStatus(e.message, 'err');
    });
  }

  function resetAll() {
    if (!window.confirm('Удалить все ручные правки группы ' + state.groupName + '?')) return;
    setStatus('Сбрасываю…');
    postJson('/api/admin-reset', { page: state.page }).then(function () {
      return loadData(state.page, { keepView: true });
    }).then(function () {
      setStatus('Правки сброшены.', 'ok');
    }).catch(function (e) {
      setStatus(e.message, 'err');
    });
  }

  /* ---------- Автозаполнение ---------- */

  function afMode() {
    var checked = document.querySelector('input[name="afMode"]:checked');
    return checked ? checked.value : 'week';
  }

  function renderAfDates() {
    var select = qs('afDate');
    var selected = select.value;
    var options = [];
    state.weeks.forEach(function (w) {
      for (var i = 0; i < 6; i += 1) {
        options.push('<option value="' + w.dates[i] + '">' + DAY_SHORT[i] + ' ' + formatShort(w.dates[i]) + ' · неделя ' + w.number + '</option>');
      }
    });
    select.innerHTML = options.join('');
    var current = currentWeek() && currentWeek().dates[state.activeDay];
    select.value = selected && select.querySelector('option[value="' + selected + '"]') ? selected : (current || '');
  }

  function weeksForAutofill() {
    return state.weeks.map(function (w) { return { weekKey: w.weekKey, number: w.number, dates: w.dates }; });
  }

  function refreshAutofill() {
    if (!qs('afPrompt')) return;
    renderAfDates();
    qs('afDate').hidden = afMode() !== 'day';
    qs('afPrompt').value = Autofill.buildPrompt({
      groupName: state.groupName,
      mode: afMode(),
      date: qs('afDate').value,
      weeks: weeksForAutofill(),
      subjects: groupSubjects(),
    });
  }

  function copyPrompt() {
    var area = qs('afPrompt');
    var done = function (ok) {
      var msg = qs('afCopyMsg');
      msg.textContent = ok ? 'Скопировано' : 'Не удалось скопировать — выделите текст и скопируйте вручную';
      msg.className = 'msg ' + (ok ? 'ok' : 'err');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(area.value).then(function () { done(true); }, function () { done(false); });
      return;
    }
    area.select();
    try { done(document.execCommand('copy')); } catch (e) { done(false); }
  }

  function applyGemini() {
    var report = qs('afReport');
    var result = Autofill.parseResponse(qs('afInput').value, {
      weeks: weeksForAutofill(),
      mode: afMode(),
      date: qs('afDate').value,
      catalog: { subjects: groupSubjects(), teachers: allTeachers() },
    });

    if (result.error) {
      report.innerHTML = '<div class="report"><span class="msg err">' + esc(result.error) + '</span>' +
        (result.warnings && result.warnings.length ? '<ul>' + result.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
      return;
    }

    result.days.forEach(function (day) {
      var week = state.weeks.filter(function (w) { return w.weekKey === day.weekKey; })[0];
      week.days[day.dayIndex] = { override: true, lessons: day.lessons.map(function (l) { return newLesson(l); }) };
    });

    var first = result.days[0];
    state.activeWeek = state.weeks.map(function (w) { return w.weekKey; }).indexOf(first.weekKey);
    state.activeDay = first.dayIndex;
    state.dirty = true;
    renderAll();

    var items = result.warnings.slice(0, 12).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    report.innerHTML = '<div class="report"><span class="msg ok">Применено дней: ' + result.days.length +
      '. Изменения ещё не сохранены — проверьте их в редакторе и нажмите «Сохранить».</span>' +
      (items ? '<ul>' + items + '</ul>' : '') + '</div>';
  }

  function bindAutofill() {
    qs('autofill').addEventListener('change', function (e) {
      if (e.target.name === 'afMode' || e.target.id === 'afDate') refreshAutofill();
    });
    qs('afCopy').addEventListener('click', copyPrompt);
    qs('afApply').addEventListener('click', applyGemini);
  }

  /* ---------- Запуск ---------- */

  function bindStatic() {
    bindCombos(qs('app'));
    bindEditor();
    bindAutofill();

    qs('weeks').addEventListener('click', function (e) {
      var b = e.target.closest('[data-week]');
      if (!b) return;
      state.activeWeek = Number(b.getAttribute('data-week'));
      renderWeeks();
      renderDayStrip();
      renderEditor();
      refreshAutofill();
      updateChrome();
    });

    qs('dayStrip').addEventListener('click', function (e) {
      var b = e.target.closest('[data-day]');
      if (!b) return;
      state.activeDay = Number(b.getAttribute('data-day'));
      renderDayStrip();
      renderEditor();
      updateChrome();
    });

    qs('teacherGroups').addEventListener('click', function (e) {
      var b = e.target.closest('[data-group]');
      if (b) selectGroup(b.getAttribute('data-group'));
    });

    qs('reloadBtn').addEventListener('click', function () {
      if (confirmDiscard()) loadData(state.page, { keepView: true });
    });
    qs('saveBtn').addEventListener('click', save);
    qs('resetBtn').addEventListener('click', resetAll);
    qs('logoutBtn').addEventListener('click', function () {
      postJson('/api/admin-logout', {}).then(function () { location.reload(); });
    });

    window.addEventListener('beforeunload', function (e) {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function loadCatalog() {
    return api('/api/admin-catalog').then(function (catalog) {
      state.catalog = catalog;
      state.catalogError = null;
    }).catch(function (e) {
      state.catalogError = e.message;
      return api('/api/groups').then(function (body) {
        state.catalog = { groups: body.groups || [], teachers: [], subjects: {}, rooms: {} };
      }).catch(function () { /* список групп недоступен */ });
    });
  }

  function init() {
    renderShell();
    bindStatic();
    setStatus('Загрузка каталога…');
    var page = store('admin:page') || DEFAULT_PAGE;
    var catalogReady = loadCatalog();
    loadData(page).then(function () { return catalogReady; }).then(function () {
      if (!state.data) return;
      renderBanner();
      renderRooms();
      refreshAutofill();
    });
  }

  init();
}());
