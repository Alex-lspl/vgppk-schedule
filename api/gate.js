'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const access = require('../lib/access');
const auth = require('../lib/adminAuth');
const limiter = require('../lib/rateLimit');
const pages = require('../lib/pages');
const captcha = require('../lib/captcha');
const stats = require('../lib/stats');
const survey = require('../lib/survey');

// «Привратник» сайта. Страница сайта лежит не в public/ (оттуда Vercel отдаёт файлы напрямую,
// минуя любые проверки), а в views/, и открывается только через эту функцию:
//   GET  /  (и /index.html)  — страница сайта, заглушка «сайт не работает» или форма входа;
//   POST /api/gate           — вход посетителя по логину и паролю.
const INDEX_PATH = path.join(__dirname, '..', 'views', 'index.html');
let indexHtml = null;
let indexEtag = null;

function loadIndex() {
  if (!indexHtml) {
    indexHtml = fs.readFileSync(INDEX_PATH);
    indexEtag = `"${crypto.createHash('sha1').update(indexHtml).digest('hex').slice(0, 20)}"`;
  }
}

// Студенты выходят в сеть с одного IP колледжа, поэтому лимит щедрее, чем у входа админа
const visitorLimiter = limiter.createLimiter({ maxFailures: 20, windowMs: 15 * 60 * 1000 });
// Отправки опроса: не больше 10 ответов в час с одного IP (в колледже много людей за одним адресом, но
// каждый отвечает один раз, так что запас большой), чтобы нельзя было завалить ответы мусором
const answerLimiter = limiter.createLimiter({ maxFailures: 30, windowMs: 60 * 60 * 1000 });

// Ошибки проверки «не робот» (неверное решение) считаются отдельно от ошибок входа
const captchaLimiter = limiter.createLimiter({ maxFailures: 30, windowMs: 15 * 60 * 1000 });
const FAILURE_DELAY_MS = 600;

// «Показана проверка» считаем не чаще раза в 10 минут с одного IP, чтобы бот, который
// перезагружает страницу в цикле, не расходовал лимит команд базы
const shownRecently = new Map();
function countShown(req, now = Date.now()) {
  const ip = limiter.clientIp(req);
  if (shownRecently.size > 5000) shownRecently.clear();
  if ((shownRecently.get(ip) || 0) > now) return;
  shownRecently.set(ip, now + 10 * 60 * 1000);
  stats.noteSkip('captcha-shown', stats.describeClient(String(req.headers['user-agent'] || ''))).catch(() => {});
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sendHtml(res, status, html, extra = {}) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.status(status).send(html);
}

async function solveCaptcha(req, res, ev, body) {
  // Проверка уже пройдена (или не нужна) — просто пускаем
  if (ev.state !== 'captcha') {
    res.status(200).json({ ok: true });
    return;
  }

  const ip = limiter.clientIp(req);
  const state = captchaLimiter.check(ip);
  if (!state.allowed) {
    res.setHeader('Retry-After', String(state.retryAfterSec));
    res.status(429).json({ error: 'Слишком много попыток. Повторите через несколько минут.' });
    return;
  }

  const result = captcha.verifySolution(req, { token: body.token, nonce: body.nonce, trusted: body.trusted });
  if (!result.ok) {
    captchaLimiter.recordFailure(ip);
    stats.noteSkip('captcha-failed', `${result.reason} | ${stats.describeClient(String(req.headers['user-agent'] || ''))}`).catch(() => {});
    await sleep(FAILURE_DELAY_MS);
    res.status(400).json({ error: 'Проверка не пройдена. Обновите страницу и попробуйте ещё раз.' });
    return;
  }

  captchaLimiter.reset(ip);
  stats.noteSkip('captcha-passed', stats.describeClient(String(req.headers['user-agent'] || ''))).catch(() => {});
  res.setHeader('Set-Cookie', captcha.makeCookie(req, ev.settings.captcha.ttlHours));
  res.status(200).json({ ok: true });
}

const VID_COOKIE = 'vid';
const VID_MAX_AGE = 365 * 24 * 60 * 60;
const VID_RE = /^[A-Za-z0-9-]{8,64}$/;

async function answerSurvey(req, res, ev, body) {
  // Уже отвечал (или опрос выключен) — просто пускаем
  if (ev.state !== 'survey') {
    res.status(200).json({ ok: true });
    return;
  }

  const ip = limiter.clientIp(req);
  const state = answerLimiter.check(ip);
  if (!state.allowed) {
    res.setHeader('Retry-After', String(state.retryAfterSec));
    res.status(429).json({ error: 'Слишком много ответов с этого адреса. Попробуйте позже.' });
    return;
  }

  const { survey: cfg } = ev.settings;
  const checked = survey.validateAnswer(body.answer, cfg.minChars);
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  answerLimiter.recordFailure(ip); // считаем каждую отправку

  // Код посетителя: если его ещё нет, заводим здесь — сайт потом продолжит с тем же кодом,
  // и ответ можно будет сопоставить с записью в списке посетителей
  const cookieHeader = String(req.headers.cookie || '');
  const fromCookie = (cookieHeader.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${VID_COOKIE}=`)) || '').slice(VID_COOKIE.length + 1);
  const vid = VID_RE.test(fromCookie) ? fromCookie : crypto.randomUUID();

  await survey.saveAnswer({
    text: checked.text,
    question: cfg.title,
    vid,
    country: String(req.headers['x-vercel-ip-country'] || '').toUpperCase(),
    ua: String(req.headers['user-agent'] || ''),
  });

  const cookies = [survey.makeCookie(cfg.ver, cfg.repeatDays)];
  if (vid !== fromCookie) cookies.push(`${VID_COOKIE}=${vid}; Path=/; Max-Age=${VID_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
  res.setHeader('Set-Cookie', cookies);
  res.status(200).json({ ok: true });
}

async function login(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.isSameOrigin(req)) {
    res.status(403).json({ error: 'Запрос отклонён: неверный источник.' });
    return;
  }

  const ev = await access.evaluate(req);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.action === 'captcha') {
    await solveCaptcha(req, res, ev, body);
    return;
  }
  if (body.action === 'survey') {
    await answerSurvey(req, res, ev, body);
    return;
  }
  if (ev.state === 'maintenance') {
    res.status(503).json({ error: 'Сайт временно не работает.', maintenance: true });
    return;
  }
  if (ev.state === 'captcha') {
    res.status(403).json({ error: 'Сначала нужно пройти проверку.', captcha: true });
    return;
  }
  if (ev.state === 'survey') {
    res.status(403).json({ error: 'Сначала нужно ответить на вопрос.', survey: true });
    return;
  }
  if (ev.state === 'open') {
    res.status(200).json({ ok: true }); // вход не требуется (или человек уже вошёл)
    return;
  }

  const ip = limiter.clientIp(req);
  const state = visitorLimiter.check(ip);
  if (!state.allowed) {
    res.setHeader('Retry-After', String(state.retryAfterSec));
    res.status(429).json({ error: 'Слишком много попыток. Повторите через несколько минут.' });
    return;
  }

  const loginName = String(body.login || '').slice(0, 200);
  const password = String(body.password || '').slice(0, 500);

  if (!access.checkVisitorCredentials(loginName, password, ev.settings)) {
    visitorLimiter.recordFailure(ip);
    await sleep(FAILURE_DELAY_MS);
    res.status(401).json({ error: 'Неверный логин или пароль.' });
    return;
  }

  visitorLimiter.reset(ip);
  res.setHeader('Set-Cookie', access.makeCookie(ev.settings.access.ver));
  res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  // Метка «ответ дала проверка доступа»: по ней страница настроек убеждается, что сайт
  // не отдаётся напрямую из public/ в обход проверки (например, из-за забытого старого файла)
  res.setHeader('X-Gate', '1');

  if (req.method === 'POST') {
    await login(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, POST');
    res.status(405).end();
    return;
  }

  const ev = await access.evaluate(req);

  if (ev.state === 'maintenance') {
    sendHtml(res, 503, pages.maintenanceHtml(ev.settings.maintenance.message), { 'Retry-After': '300' });
    return;
  }
  if (ev.state === 'captcha') {
    countShown(req);
    sendHtml(res, 200, pages.captchaHtml(captcha.issueChallenge(req)));
    return;
  }
  if (ev.state === 'login') {
    sendHtml(res, 200, pages.loginHtml());
    return;
  }
  if (ev.state === 'survey') {
    sendHtml(res, 200, pages.surveyHtml(ev.settings.survey));
    return;
  }

  loadIndex();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // private: страницу не должны хранить общие кэши (CDN) — иначе проверка доступа обходилась бы
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', indexEtag);
  if (req.headers['if-none-match'] === indexEtag) {
    res.status(304).end();
    return;
  }
  res.status(200).send(indexHtml);
};
