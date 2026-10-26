/**
 * Автозаполнение расписания по ответу нейросети.
 *
 * Модуль формирует текст запроса (промпт), который вместе с фотографией расписания
 * отправляется в Gemini, и разбирает полученный JSON в пары расписания. Логика не
 * зависит от DOM и подключается как в браузере (window.Autofill), так и в тестах.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Autofill = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/g, ' ')
      .trim();
  }

  /** Для фамилий с инициалами: «Семичева А. Г.» и «Семичева А.Г.» считаются одинаковыми. */
  function normalizePerson(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function formatDateRu(iso) {
    var p = iso.split('-').map(Number);
    var weekday = (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7;
    return DAY_NAMES[weekday] + ', ' + p[2] + ' ' + MONTHS[p[1] - 1];
  }

  function formatShort(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1];
  }

  /**
   * Находит предмет каталога по названию: сначала точное совпадение, затем
   * единственное вхождение одного названия в другое.
   */
  function matchSubject(name, subjects) {
    var key = normalizeText(name);
    if (!key) return null;
    var list = subjects || [];
    var exact = list.filter(function (s) { return normalizeText(s.subject) === key; });
    if (exact.length) return exact[0];
    var partial = list.filter(function (s) {
      var k = normalizeText(s.subject);
      return k && (k.indexOf(key) === 0 || key.indexOf(k) === 0);
    });
    return partial.length === 1 ? partial[0] : null;
  }

  function matchTeacher(name, teachers) {
    var key = normalizePerson(name);
    if (!key) return null;
    var found = (teachers || []).filter(function (t) { return normalizePerson(t) === key; });
    return found.length ? found[0] : null;
  }

  /**
   * Формирует текст запроса для Gemini.
   *   options.groupName — название группы;
   *   options.mode      — 'week' (даты указаны на фотографии) или 'day' (дата задана заранее);
   *   options.date      — дата дня (ГГГГ-ММ-ДД) для режима 'day';
   *   options.weeks     — доступные недели [{ number, dates: [ГГГГ-ММ-ДД × 7] }];
   *   options.subjects  — предметы группы [{ subject, teachers }].
   */
  function buildPrompt(options) {
    var mode = options.mode === 'day' ? 'day' : 'week';
    var weeks = options.weeks || [];
    var year = (options.date || (weeks[0] && weeks[0].dates[0]) || String(new Date().getFullYear())).slice(0, 4);

    var dateRule;
    if (mode === 'day') {
      dateRule = 'На изображении расписание на один день: ' + formatDateRu(options.date) + '. ' +
        'Верни ровно один элемент в "days" с датой "' + options.date + '".';
    } else {
      var ranges = weeks.map(function (w) {
        return formatShort(w.dates[0]) + '–' + formatShort(w.dates[6]);
      }).join(' или ');
      dateRule = 'На изображении расписание на неделю. Определи дату каждого дня по заголовкам на изображении ' +
        'и запиши её в формате ГГГГ-ММ-ДД (год ' + year + '). ' +
        (ranges ? 'Ожидаемый период: ' + ranges + '. ' : '') +
        'Дни без пар включай в ответ с пустым списком "lessons".';
    }

    var subjectLines = (options.subjects || []).map(function (s) {
      return '- ' + s.subject + (s.teachers && s.teachers.length ? ' — ' + s.teachers.join(', ') : '');
    });

    var lines = [
      'Перенеси расписание занятий колледжа с изображения в JSON.',
      '',
      'Группа: ' + (options.groupName || '—'),
      '',
      'Правила:',
      '1. Ответ — только JSON, без пояснений, без markdown и без блока ```.',
      '2. Одна запись в "lessons" — одна пара для одной подгруппы. Если в одной паре у подгрупп разные предметы, ' +
        'преподаватели или аудитории, сделай две записи с одинаковым "pair" и "subgroup" 1 и 2.',
      '3. "pair" — номер пары из первого столбца (целое число от 1 до 9). Пустые пары пропускай.',
      '4. "subject" — название предмета. Если предмет есть в списке ниже, используй его написание из списка без изменений.',
      '5. "teacher" — преподаватель в формате «Фамилия И.О.» без номера аудитории; если не указан или нечитаем — null.',
      '6. "room" — аудитория как написано на изображении (например "132" или "СЗ 3"); если не указана — null.',
      '7. "subgroup" — 1 или 2, если пара только для одной подгруппы; иначе null.',
      '8. "note" — прочие пометки (замена, дистанционно и т. п.); если их нет — null.',
      '9. Не додумывай данные: нечитаемое значение — null. Не добавляй пары, которых нет на изображении.',
      '10. ' + dateRule,
      '',
    ];
    if (subjectLines.length) {
      lines.push('Предметы группы и их преподаватели:');
      Array.prototype.push.apply(lines, subjectLines);
      lines.push('');
    }
    lines.push(
      'Формат ответа:',
      '{',
      '  "days": [',
      '    {',
      '      "date": "' + (mode === 'day' ? options.date : (weeks[0] ? weeks[0].dates[0] : year + '-01-01')) + '",',
      '      "lessons": [',
      '        { "pair": 1, "subject": "Название предмета", "teacher": "Фамилия И.О.", "room": "132", "subgroup": null, "note": null }',
      '      ]',
      '    }',
      '  ]',
      '}'
    );
    return lines.join('\n');
  }

  function extractJson(text) {
    var source = String(text || '').replace(/```(?:json)?/gi, '').trim();
    var start = source.search(/[{[]/);
    if (start < 0) return null;
    var open = source[start];
    var end = source.lastIndexOf(open === '{' ? '}' : ']');
    if (end <= start) return null;
    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch (e) {
      return null;
    }
  }

  function toNullableText(value) {
    if (value == null) return null;
    var s = String(value).replace(/\s+/g, ' ').trim();
    return s && s.toLowerCase() !== 'null' ? s : null;
  }

  function toSubgroup(value) {
    var n = parseInt(String(value == null ? '' : value).replace(/\D+/g, ''), 10);
    return n === 1 || n === 2 ? n : null;
  }

  /** Приводит запись Gemini к виду пары и подставляет данные из каталога. */
  function normalizeLesson(raw, catalog) {
    if (!raw || typeof raw !== 'object') return null;
    var pair = parseInt(raw.pair, 10);
    var subject = toNullableText(raw.subject);
    if (!(pair >= 1 && pair <= 9) || !subject) return null;

    var entry = matchSubject(subject, catalog && catalog.subjects);
    var teacher = toNullableText(raw.teacher);
    if (teacher) teacher = matchTeacher(teacher, catalog && catalog.teachers) || teacher;
    else if (entry && entry.teachers && entry.teachers.length) teacher = entry.teachers[0];

    return {
      pair: pair,
      subject: entry ? entry.subject : subject,
      teacher: teacher,
      room: toNullableText(raw.room),
      subgroup: toSubgroup(raw.subgroup),
      note: toNullableText(raw.note),
      matched: !!entry,
    };
  }

  /**
   * Разбирает ответ Gemini и сопоставляет дни с неделями редактора.
   *   options.weeks    — [{ weekKey, dates }] (две доступные недели);
   *   options.mode     — 'week' | 'day';
   *   options.date     — дата дня для режима 'day';
   *   options.catalog  — { subjects: [{ subject, teachers }], teachers: [] } для текущей группы.
   * Возвращает { days: [{ weekKey, dayIndex, date, lessons }], warnings: [] } либо { error }.
   */
  function parseResponse(text, options) {
    var json = extractJson(text);
    if (!json) return { error: 'Не удалось найти JSON в ответе. Скопируйте ответ Gemini целиком.' };

    var days = Array.isArray(json) ? json : json.days;
    if (!Array.isArray(days) || !days.length) return { error: 'В ответе нет списка "days".' };

    var warnings = [];
    var result = [];
    var seen = {};

    days.forEach(function (entry, i) {
      var date = String(entry && entry.date || '');
      if (options.mode === 'day' && options.date) {
        if (days.length === 1 && date && date !== options.date) {
          warnings.push('Дата в ответе (' + date + ') заменена на выбранную (' + options.date + ').');
        }
        if (days.length === 1) date = options.date;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        warnings.push('Элемент ' + (i + 1) + ': не указана дата, пропущен.');
        return;
      }

      var weekKey = null;
      var dayIndex = -1;
      (options.weeks || []).forEach(function (w) {
        var idx = w.dates.indexOf(date);
        if (idx >= 0) { weekKey = w.weekKey; dayIndex = idx; }
      });
      if (!weekKey) {
        warnings.push(date + ': дата вне двух доступных недель, день пропущен.');
        return;
      }
      if (seen[date]) {
        warnings.push(date + ': день встречается в ответе повторно, использован первый.');
        return;
      }
      seen[date] = true;

      var lessons = [];
      (Array.isArray(entry.lessons) ? entry.lessons : []).forEach(function (raw, k) {
        var lesson = normalizeLesson(raw, options.catalog);
        if (!lesson) {
          warnings.push(date + ': запись ' + (k + 1) + ' пропущена (нет номера пары или предмета).');
          return;
        }
        if (!lesson.matched) warnings.push(date + ': предмета «' + lesson.subject + '» нет в каталоге группы, оставлен как в ответе.');
        delete lesson.matched;
        lessons.push(lesson);
      });
      lessons.sort(function (a, b) { return a.pair - b.pair; });
      result.push({ weekKey: weekKey, dayIndex: dayIndex, date: date, lessons: lessons });
    });

    if (!result.length) return { error: 'Ни один день из ответа не удалось сопоставить с доступными неделями.', warnings: warnings };
    return { days: result, warnings: warnings };
  }

  return { normalizeText: normalizeText, normalizePerson: normalizePerson, matchSubject: matchSubject, matchTeacher: matchTeacher, buildPrompt: buildPrompt, parseResponse: parseResponse, formatDateRu: formatDateRu };
}));
