'use strict';

const cheerio = require('cheerio');

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAY_RE = /^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)\.?(?:\s+([1-9]))?$/i;
const IGNORED_TEXT = new Set(['день', 'пара', 'дата']);

// Шаблоны ссылок на сайте: j123.htm — журнал (предмет), ba123.htm — аудитория,
// bp123.htm — преподаватель. Буква перед "a"/"p" отличается в разных разделах (b, c, h…).
const RE_SUBJECT = /(^|\/)j\d+\.htm/i;
const RE_ROOM = /(^|\/)[a-z]a\d+\.htm/i;
const RE_TEACHER = /(^|\/)[a-z]p\d+\.htm/i;
const RE_GROUP = /(^|\/)[a-z]g\d+\.htm/i;

const norm = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Разбирает страницу расписания группы в JSON.
 *
 * Парсер не привязан к конкретной вёрстке (table / ul / div): он идёт по документу
 * в порядке чтения и отслеживает «неделя → день → пара» по тексту, а предмет,
 * аудиторию и преподавателя берёт из ссылок.
 */
function parseSchedule(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  // На странице два <h1>: первый — название всего сайта, второй — «Группа: 841».
  // Берём тот, где есть двоеточие; если вдруг такого нет — берём последний <h1>.
  const h1s = $('h1').toArray().map((el) => norm($(el).text()));
  const title = h1s.find((t) => t.includes(':')) || h1s[h1s.length - 1] || '';
  const name = title.includes(':') ? title.split(':').slice(1).join(':').trim() : title;

  const weeks = new Map();
  const ensureWeek = (n) => {
    if (!weeks.has(n)) {
      weeks.set(n, DAY_NAMES.map((d, index) => ({ index, name: d, lessons: [] })));
    }
    return weeks.get(n);
  };

  let week = 1;
  let day = null;
  let pair = null;
  let lesson = null;
  let updated = null;
  let stop = false;
  let daysSeen = 0;

  const join = (a, b) => (a ? `${a}, ${b}` : b);

  function onText(raw) {
    const t = norm(raw);
    if (!t) return;

    const upd = /Обновлено:\s*(\d{2}\.\d{2}\.\d{4})\s*в\s*(\d{1,2}:\d{2})/i.exec(t);
    if (upd) {
      updated = `${upd[1]} ${upd[2]}`;
      stop = true;
      return;
    }

    const wk = /Неделя\s*(\d+)/i.exec(t);
    if (wk) {
      week = Number(wk[1]);
      ensureWeek(week);
      day = null;
      pair = null;
      lesson = null;
      return;
    }

    const d = DAY_RE.exec(t);
    if (d) {
      day = DAY_NAMES.findIndex((n) => n.toLowerCase() === d[1].toLowerCase());
      ensureWeek(week);
      daysSeen += 1;
      pair = d[2] ? Number(d[2]) : null;
      lesson = null;
      return;
    }

    if (day === null) return;

    if (/^[1-9]$/.test(t)) {
      pair = Number(t);
      lesson = null;
      return;
    }

    if (IGNORED_TEXT.has(t.toLowerCase())) return;

    // Любой другой текст внутри пары — пометка (подгруппа, замена и т.п.)
    if (lesson && t.length <= 80) {
      lesson.note = join(lesson.note, t);
    }
  }

  function onLink(node) {
    const href = node.attribs?.href || '';
    const text = norm($(node).text());
    if (!text) return;

    if (RE_SUBJECT.test(href)) {
      if (day === null || pair === null) return;
      lesson = { pair, subject: text, room: null, teacher: null, subgroup: null, note: null };
      ensureWeek(week)[day].lessons.push(lesson);
    } else if (RE_ROOM.test(href)) {
      if (lesson) lesson.room = join(lesson.room, text);
    } else if (RE_TEACHER.test(href)) {
      if (lesson) lesson.teacher = join(lesson.teacher, text);
    }
  }

  function walk(nodes) {
    for (const node of nodes) {
      if (stop) return;
      if (node.type === 'text') onText(node.data);
      else if (node.type === 'tag') {
        if (node.name === 'a') onLink(node);
        else walk(node.children || []);
      }
    }
  }

  const body = $('body')[0];
  walk(body ? body.children : $.root()[0].children);

  if (daysSeen === 0) {
    throw new Error('Не удалось найти расписание на странице: возможно, изменилась вёрстка сайта');
  }

  return {
    name,
    title,
    updated,
    weeks: [...weeks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([number, days]) => ({ number, days })),
  };
}


/**
 * Разбирает страницу преподавателя или аудитории («Текущее расписание», cp123.htm / ca123.htm)
 * в тот же JSON, что и страница группы, добавляя к каждой паре поле group.
 *
 * Отличия от страницы группы:
 *  - группа, аудитория и преподаватель в ячейке стоят ПЕРЕД названием предмета, поэтому ссылки
 *    накапливаются и привязываются к паре, когда встречается ссылка на предмет;
 *  - недели обозначены не заголовком «Неделя N», а суффиксом у дня («Пн-2», «Вт-1»);
 *  - перед днём стоит дата (19.10.2026) — это служебный текст, не примечание.
 */
function parseEntitySchedule(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const h1s = $('h1').toArray().map((el) => norm($(el).text()));
  const title = h1s.find((t) => t.includes(':')) || h1s[h1s.length - 1] || '';
  const name = title.includes(':') ? title.split(':').slice(1).join(':').trim() : title;
  const label = (title.split(':')[0] || '').toLowerCase();
  const kind = label.startsWith('препод') ? 'teacher' : label.startsWith('аудитор') ? 'room' : label.startsWith('групп') ? 'group' : null;

  const weeks = new Map();
  const ensureWeek = (n) => {
    if (!weeks.has(n)) weeks.set(n, DAY_NAMES.map((d, index) => ({ index, name: d, lessons: [] })));
    return weeks.get(n);
  };

  let week = 1;
  let day = null;
  let pair = null;
  let lesson = null;
  let updated = null;
  let stop = false;
  let daysSeen = 0;
  let pending = { groups: null, rooms: null, teachers: null, notes: null };

  const join = (a, b) => (a ? `${a}, ${b}` : b);
  const resetPending = () => { pending = { groups: null, rooms: null, teachers: null, notes: null }; };
  const hasPending = () => !!(pending.groups || pending.rooms || pending.teachers);
  const DAY_TOKEN = /^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)(?:\s*-\s*(\d))?\.?(?:\s+([1-9]))?$/i;

  function onText(raw) {
    let t = norm(raw);
    if (!t) return;

    const upd = /Обновлено:\s*(\d{2}\.\d{2}\.\d{4})\s*в\s*(\d{1,2}:\d{2})/i.exec(t);
    if (upd) {
      updated = `${upd[1]} ${upd[2]}`;
      stop = true;
      return;
    }

    // Дата перед днём (19.10.2026) — служебный текст
    t = t.replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, '').trim();
    if (!t) return;

    const wk = /Неделя\s*(\d+)/i.exec(t);
    if (wk) {
      week = Number(wk[1]);
      ensureWeek(week);
      day = null; pair = null; lesson = null; resetPending();
      return;
    }

    const d = DAY_TOKEN.exec(t);
    if (d) {
      day = DAY_NAMES.findIndex((n) => n.toLowerCase() === d[1].toLowerCase());
      if (d[2]) week = Number(d[2]);
      ensureWeek(week);
      daysSeen += 1;
      pair = d[3] ? Number(d[3]) : null;
      lesson = null;
      resetPending();
      return;
    }

    if (day === null) return;

    if (/^[1-9]$/.test(t)) {
      pair = Number(t);
      lesson = null;
      resetPending();
      return;
    }

    if (IGNORED_TEXT.has(t.toLowerCase()) || t.length > 80) return;

    // Любой другой текст — пометка: к следующему предмету, если уже были ссылки, иначе к текущему
    if (hasPending()) pending.notes = join(pending.notes, t);
    else if (lesson) lesson.note = join(lesson.note, t);
  }

  function onLink(node) {
    const href = node.attribs?.href || '';
    const text = norm($(node).text());
    if (!text) return;

    if (RE_SUBJECT.test(href)) {
      if (day === null || pair === null) return;
      lesson = {
        pair,
        subject: text,
        room: pending.rooms,
        teacher: pending.teachers,
        group: pending.groups,
        subgroup: null,
        note: pending.notes,
      };
      ensureWeek(week)[day].lessons.push(lesson);
      resetPending();
    } else if (RE_GROUP.test(href)) {
      pending.groups = join(pending.groups, text);
    } else if (RE_ROOM.test(href)) {
      pending.rooms = join(pending.rooms, text);
    } else if (RE_TEACHER.test(href)) {
      pending.teachers = join(pending.teachers, text);
    }
  }

  function walk(nodes) {
    for (const node of nodes) {
      if (stop) return;
      if (node.type === 'text') onText(node.data);
      else if (node.type === 'tag') {
        if (node.name === 'a') onLink(node);
        else walk(node.children || []);
      }
    }
  }

  const body = $('body')[0];
  walk(body ? body.children : $.root()[0].children);

  if (daysSeen === 0) {
    throw new Error('Не удалось найти расписание на странице: возможно, изменилась вёрстка сайта');
  }

  return {
    name,
    title,
    kind,
    updated,
    weeks: [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([number, days]) => ({ number, days })),
  };
}

/**
 * Список со страницы «По группам / преподавателям / аудиториям» (cg.htm, cp.htm, ca.htm, bg.htm…).
 * prefix — две буквы раздела, например 'cp'.
 */
function parseList(html, prefix) {
  const re = new RegExp(`(?:^|/)(${prefix}\\d+)\\.htm$`, 'i');
  const $ = cheerio.load(html);
  const seen = new Map();
  $('a[href]').each((_, el) => {
    const m = re.exec($(el).attr('href') || '');
    const label = norm($(el).text());
    if (m && label && !seen.has(m[1])) seen.set(m[1], label);
  });
  return [...seen.entries()]
    .map(([page, name]) => ({ page, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
}

/** Список групп со страницы «По группам» (bg.htm). */
function parseGroups(html) {
  const $ = cheerio.load(html);
  const seen = new Map();
  $('a[href]').each((_, el) => {
    const m = /(?:^|\/)(bg\d+)\.htm$/i.exec($(el).attr('href') || '');
    const label = norm($(el).text());
    if (m && label && !seen.has(m[1])) seen.set(m[1], label);
  });
  return [...seen.entries()]
    .map(([page, label]) => ({ page, name: label }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
}

module.exports = { parseSchedule, parseEntitySchedule, parseGroups, parseList };
