'use strict';

/**
 * Тестовые подмены внешних сервисов: сайта колледжа и GitHub Contents API.
 * Позволяют проверять серверную логику без сети и без установленного cheerio.
 */

const crypto = require('crypto');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

/** Подменяет lib/parse: «страницы» колледжа в тестах — это JSON-строки. */
function stubParser() {
  const parsePath = require.resolve(path.join(REPO_ROOT, 'lib', 'parse.js'));
  require.cache[parsePath] = {
    id: parsePath,
    filename: parsePath,
    loaded: true,
    exports: {
      parseSchedule: (html) => JSON.parse(html),
      parseGroups: (html) => JSON.parse(html).groups,
    },
  };
}

const lesson = (pair, subject, teacher, room, extra = {}) => ({
  pair, subject, teacher, room, subgroup: null, note: null, ...extra,
});

const emptyWeek = (number) => ({
  number,
  days: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((name, index) => ({ index, name, lessons: [] })),
});

function groupSchedule(name, build) {
  const weeks = [emptyWeek(1), emptyWeek(2)];
  build(weeks);
  return { name, title: `Группа: ${name}`, updated: '21.09.2026 18:23', weeks };
}

/**
 * Запускает фейковое окружение. Возвращает объект с состоянием:
 *   college — { "bg203.htm": расписание, "bg.htm": { groups } }
 *   files   — содержимое репозитория GitHub { путь: текст }
 *   restore() — вернуть оригинальный fetch
 */
function installFakes({ college, files = {} }) {
  const original = global.fetch;
  const state = { college, files, shas: {}, writes: [], failWrites: 0 };

  const shaOf = (text) => crypto.createHash('sha1').update(text).digest('hex');
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  global.fetch = async (url, options = {}) => {
    const u = new URL(url);

    if (u.hostname === 'rasp.vgppk.ru') {
      const page = u.pathname.slice(1);
      if (!(page in state.college)) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(state.college[page]), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    if (u.hostname === 'api.github.com') {
      const match = /\/contents\/(.+)$/.exec(u.pathname);
      const file = match && decodeURIComponent(match[1]);
      if (!options.method || options.method === 'GET') {
        if (!(file in state.files)) return json(404, { message: 'Not Found' });
        const text = state.files[file];
        return json(200, { content: Buffer.from(text).toString('base64'), sha: shaOf(text) });
      }
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body);
        const exists = file in state.files;
        if (state.failWrites > 0) {
          state.failWrites -= 1;
          return json(409, { message: 'conflict' });
        }
        if (exists && body.sha !== shaOf(state.files[file])) return json(409, { message: 'sha mismatch' });
        if (!exists && body.sha) return json(422, { message: 'invalid sha' });
        state.files[file] = Buffer.from(body.content, 'base64').toString('utf8');
        state.writes.push({ file, message: body.message });
        return json(200, { content: { sha: shaOf(state.files[file]) } });
      }
    }
    throw new Error(`Непредвиденный запрос в тесте: ${url}`);
  };

  state.restore = () => { global.fetch = original; };
  return state;
}

module.exports = { stubParser, installFakes, lesson, emptyWeek, groupSchedule, REPO_ROOT };
