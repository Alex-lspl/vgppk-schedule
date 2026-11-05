'use strict';

/**
 * Хранилище данных админки — JSON-файлы в GitHub-репозитории, доступные через
 * GitHub Contents API. Отдельная база данных не нужна, а история изменений
 * видна в истории коммитов.
 *
 * Файлы (каталог задаётся GITHUB_DATA_DIR, по умолчанию «data»):
 *   overrides.json — ручные правки расписания;
 *   changes.json   — снимки расписания колледжа для обнаружения изменений;
 *   catalog.json   — каталог групп, предметов и преподавателей.
 *
 * Переменные окружения:
 *   GITHUB_TOKEN     — токен с правом Contents: Read and write на этот репозиторий
 *   GITHUB_REPO      — «владелец/репозиторий»
 *   GITHUB_BRANCH    — ветка с данными (по умолчанию main). Рекомендуется выделенная
 *                      ветка, для которой отключено развёртывание (см. vercel.json).
 *   GITHUB_DATA_DIR  — каталог с файлами данных (по умолчанию data)
 *
 * Если переменные не заданы, сайт работает без админки: чтение возвращает пустые
 * данные, запись завершается понятной ошибкой.
 */

const API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_WRITE_ATTEMPTS = 3;

const FILE_NAMES = {
  overrides: 'overrides.json',
  changes: 'changes.json',
  catalog: 'catalog.json',
};

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  return {
    token,
    repo,
    branch: process.env.GITHUB_BRANCH || 'main',
    dir: (process.env.GITHUB_DATA_DIR || 'data').replace(/^\/+|\/+$/g, ''),
  };
}

function isConfigured() {
  return !!config();
}

function filePath(name) {
  const cfg = config();
  return `${cfg ? cfg.dir : 'data'}/${FILE_NAMES[name]}`;
}

async function githubRequest(path, options = {}) {
  const cfg = config();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vgppk-schedule-admin',
      ...(options.headers || {}),
    },
  });
}

/** Читает JSON-файл данных. sha === null означает, что файла в репозитории ещё нет. */
async function readJson(name) {
  const cfg = config();
  if (!cfg) return { data: {}, sha: null };

  const path = filePath(name);
  const res = await githubRequest(`/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`);

  if (res.status === 404) return { data: {}, sha: null };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`GitHub ответил ${res.status} при чтении ${path}${body.message ? ': ' + body.message : ''}`);
  }

  const json = await res.json();
  const text = Buffer.from(json.content || '', 'base64').toString('utf8');
  try {
    return { data: text.trim() ? JSON.parse(text) : {}, sha: json.sha };
  } catch {
    throw new Error(`Файл ${path} в репозитории повреждён: не удалось разобрать JSON`);
  }
}

class ConflictError extends Error {}

async function writeJson(name, data, sha, message, { compact = false } = {}) {
  const cfg = config();
  if (!cfg) throw new Error('Хранилище не настроено (не заданы GITHUB_TOKEN и GITHUB_REPO)');

  const path = filePath(name);
  const text = compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);
  const res = await githubRequest(`/repos/${cfg.repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(text).toString('base64'),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (res.status === 409 || res.status === 422) throw new ConflictError(`Конфликт версий ${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`GitHub ответил ${res.status} при сохранении ${path}${body.message ? ': ' + body.message : ''}`);
  }
}

/**
 * Читает файл, применяет к данным функцию `mutate` и записывает результат.
 * Если файл успели изменить параллельно, цикл повторяется с актуальной версией.
 * Когда `mutate` возвращает false, запись пропускается.
 */
async function updateJson(name, mutate, message, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data, sha } = await readJson(name);
    const changed = await mutate(data);
    if (changed === false) return false;
    try {
      await writeJson(name, data, sha, message, options);
      return true;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

module.exports = { isConfigured, readJson, updateJson, filePath, FILE_NAMES };
