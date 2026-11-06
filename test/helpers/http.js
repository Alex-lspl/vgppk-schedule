'use strict';

const auth = require('../../lib/adminAuth');

// Минимальные заглушки запроса и ответа для вызова обработчиков api/* напрямую
function mockRes() {
  const res = { headers: {}, code: 0, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.send = (b) => { res.body = b; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

function withAdminEnv(fn) {
  return async () => {
    process.env.ADMIN_USER = 'tester';
    process.env.ADMIN_PASSWORD = 'long-enough-password-123';
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.SESSION_SECRET;
    try { await fn(); } finally {
      delete process.env.ADMIN_USER;
      delete process.env.ADMIN_PASSWORD;
    }
  };
}

const adminCookie = () => auth.makeSessionCookie().split(';')[0];

module.exports = { mockRes, withAdminEnv, adminCookie };
