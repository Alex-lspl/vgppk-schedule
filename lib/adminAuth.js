'use strict';

// Логин и пароль от админки. Чтобы сменить — поменяй значения здесь и залей файл заново.
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'administrator sp42';

const REALM = 'Админка расписания';

function checkAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return user === ADMIN_USER && pass === ADMIN_PASS;
}

// Вызывается первой строкой в каждом обработчике под /admin: если вернула false,
// обработчик должен сразу завершиться (заголовок с просьбой логина уже отправлен).
function requireAuth(req, res) {
  if (checkAuth(req)) return true;
  res.setHeader('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  res.status(401).send('Нужен логин и пароль администратора.');
  return false;
}

module.exports = { checkAuth, requireAuth, ADMIN_USER, ADMIN_PASS };
