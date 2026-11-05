'use strict';

/**
 * Хранилище правок из админки — обычный JSON-файл в GitHub-репозитории
 * (по умолчанию data/overrides.json). Админка читает и сохраняет его через
 * GitHub API; сайт при каждом запросе просто читает текущее содержимое.
 * Никакой отдельной базы данных не нужно — история правок видна прямо
 * в истории коммитов репозитория.
 *
 * Нужные переменные окружения (задаются в Vercel → Settings → Environment Variables):
 *   GITHUB_TOKEN          — токен с правом записи в репозиторий (Contents: Read and write)
 *   GITHUB_REPO           — "логин/репозиторий", например "l-SP-Soft-l/vgppk-schedule"
 *   GITHUB_BRANCH          — ветка (необязательно, по умолчанию "main")
 *   GITHUB_OVERRIDES_PATH  — путь к файлу в репозитории (необязательно, по умолчанию "data/overrides.json")
 *
 * Без этих переменных сайт продолжает работать как обычно, просто без админки
 * (все функции здесь молча возвращают «пусто»/бросают понятную ошибку при попытке записи).
 */

const API_BASE = 'https://api.github.com';

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  return {
    token,
    repo,
    branch: process.env.GITHUB_BRANCH || 'main',
    path: process.env.GITHUB_OVERRIDES_PATH || 'data/overrides.json',
  };
}

function isConfigured() {
  return !!config();
}

async function githubRequest(path, options = {}) {
  const cfg = config();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vgppk-schedule-admin',
      ...(options.headers || {}),
    },
  });
}

// Текущее содержимое файла: { data: {...}, sha } — sha null означает, что файла
// ещё нет в репозитории (будет создан при первом сохранении из админки).
async function readFile() {
  const cfg = config();
  if (!cfg) return { data: {}, sha: null };

  const res = await githubRequest(`/repos/${cfg.repo}/contents/${cfg.path}?ref=${encodeURIComponent(cfg.branch)}`);

  if (res.status === 404) return { data: {}, sha: null };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`GitHub ответил ${res.status} при чтении файла правок${body.message ? ': ' + body.message : ''}`);
  }

  const json = await res.json();
  const text = Buffer.from(json.content, 'base64').toString('utf8');
  let data;
  try {
    data = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error('Файл правок на GitHub повреждён — не получилось разобрать JSON');
  }
  return { data, sha: json.sha };
}

async function writeFile(data, sha, message) {
  const cfg = config();
  if (!cfg) throw new Error('GitHub не настроен (нет GITHUB_TOKEN или GITHUB_REPO)');

  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const res = await githubRequest(`/repos/${cfg.repo}/contents/${cfg.path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content, branch: cfg.branch, ...(sha ? { sha } : {}) }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`GitHub ответил ${res.status} при сохранении${body.message ? ': ' + body.message : ''}`);
  }
}

// Правки для одной группы: { weekKey, days } или null, если их ещё не сохраняли.
// Устарели они или нет (сменилась ли уже календарная неделя) — решает вызывающий код.
async function getEntry(page) {
  const { data } = await readFile();
  return data[page] || null;
}

async function saveEntry(page, weekKey, days) {
  const { data, sha } = await readFile();
  data[page] = { weekKey, days };
  await writeFile(data, sha, `Расписание: правки на неделю ${weekKey} (${page})`);
}

async function deleteEntry(page) {
  const { data, sha } = await readFile();
  if (!(page in data)) return false;
  delete data[page];
  await writeFile(data, sha, `Расписание: сброс правок (${page})`);
  return true;
}

module.exports = { isConfigured, getEntry, saveEntry, deleteEntry };
