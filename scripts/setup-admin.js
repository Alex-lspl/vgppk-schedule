#!/usr/bin/env node
'use strict';

/**
 * Генерирует значения переменных окружения для входа в админку:
 * хеш пароля и секрет подписи сессий. Пароль вводится в терминале без отображения
 * и нигде не сохраняется; результат выводится только на экран.
 *
 * Использование: npm run admin:setup
 */

const crypto = require('crypto');
const readline = require('readline');
const { hashPassword } = require('../lib/adminAuth');

const MIN_PASSWORD_LENGTH = 12;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (text) => { if (!muted) write(text); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const password = await askHidden('Новый пароль (не короче 12 символов): ');
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Пароль слишком короткий: нужно не менее ${MIN_PASSWORD_LENGTH} символов.`);
    process.exit(1);
  }
  const repeat = await askHidden('Повторите пароль: ');
  if (repeat !== password) {
    console.error('Пароли не совпадают.');
    process.exit(1);
  }

  console.log('\nДобавьте эти переменные в Vercel (Settings → Environment Variables) и выполните повторное развёртывание:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
  console.log(`SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
  console.log('\nПеременная ADMIN_USER задаёт имя администратора.');
}

main();
