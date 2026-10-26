'use strict';

/**
 * Запускает все тесты из каталога test/ встроенным тест-раннером Node.js.
 * Список файлов собирается явно, чтобы запуск не зависел от версии Node.js и оболочки.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
