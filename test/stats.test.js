const assert = require('assert');
const stats = require('../lib/stats');
const fake = require('./fake-redis.js')();
stats.setClientForTests(fake);
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', UA_AND = 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile';
assert.strictEqual(stats.parseUA(UA_AND).kind, 'android'); assert.strictEqual(stats.parseUA(UA_IOS).kind, 'ios'); assert.strictEqual(stats.parseUA(UA_WIN).kind, 'pc');
assert(stats.isBot('Googlebot/2.1')); assert(stats.isBot('')); assert(!stats.isBot(UA_WIN)); assert(!stats.isBot(UA_IOS));
assert.strictEqual(stats.cleanGroup('841<script>'), '841script'); assert.strictEqual(stats.cleanGroup('  '), null);
assert(stats.visitorId({ vid: 'bad id!', ip: '1.1.1.1', ua: 'x' }).startsWith('ip-'));

(async () => {
  const T0 = Date.UTC(2026, 10, 4, 9, 0, 0); // 4 нояб 12:00 МСК
  // Короткий визит: открыл и ушёл
  await stats.record({ id: 'aaaaaaaa-1111', ip: '95.10.20.42', country: 'RU', ua: UA_WIN, group: '841', type: 'load' }, T0);
  assert.strictEqual(stats.countOnline(await stats.loadVisitors(), T0 + 5000), 1, 'сразу после открытия — онлайн');
  await stats.record({ id: 'aaaaaaaa-1111', type: 'leave' }, T0 + 8000);
  assert.strictEqual(stats.countOnline(await stats.loadVisitors(), T0 + 9000), 0, 'после leave — сразу не онлайн');
  // Второй: iPhone, смотрит 2 группы, сигнал свежий
  await stats.record({ id: 'bbbbbbbb-2222', ip: '178.1.2.13', country: 'DE', ua: UA_IOS, group: '841', type: 'load' }, T0 + 1000);
  await stats.record({ id: 'bbbbbbbb-2222', ip: '178.1.2.13', country: 'DE', ua: UA_IOS, group: '842', type: 'ping' }, T0 + 30000);
  // Третий: Android, вчера
  const Y = T0 - 86400000;
  await stats.record({ id: 'cccccccc-3333', ip: '82.9.9.91', country: 'KZ', ua: UA_AND, group: '841', type: 'load' }, Y);
  // Он же сегодня со сменой IP
  await stats.record({ id: 'cccccccc-3333', ip: '82.9.9.92', country: 'KZ', ua: UA_AND, group: '841', type: 'load' }, T0 + 2000);

  const recs = await stats.loadVisitors();
  assert.strictEqual(recs.length, 3);
  const now = T0 + 40000;
  const s = stats.buildStats(recs, now);
  console.log('online:', s.online.count, '| today:', s.today, '| week:', s.week, '| month:', s.month);
  assert.strictEqual(s.online.count, 2); // bbbb (пинг 10 с назад) и cccc (свежий load)
  assert.strictEqual(s.today, 3); assert.strictEqual(s.week, 3); assert.strictEqual(s.month, 3);
  const yesterday = s.daily[s.daily.length - 2]; assert.strictEqual(yesterday.unique, 1);
  assert.strictEqual(s.periods[7].visits, 4, 'всего загрузок: aaaa 1 + bbbb 1 + cccc 2');
  assert.strictEqual(s.periods[7].newPct, 100);
  assert.deepStrictEqual(s.countries.map((c) => c.code + ':' + c.count).sort(), ['DE:1', 'KZ:1', 'RU:1']);
  assert.strictEqual(s.countriesTotal, 3);
  assert.strictEqual(s.devices.mobile, 67); assert.strictEqual(s.devices.pc, 33);
  const kz = s.visitors.find((v) => v.country === 'KZ'); assert.deepStrictEqual(kz.ips, ['82.9.9.91', '82.9.9.92']); assert.strictEqual(kz.ip, '82.9.9.92');
  const de = s.visitors.find((v) => v.country === 'DE'); assert.deepStrictEqual(de.groups, ['842', '841']);
  // Через 2 минуты никто не онлайн
  assert.strictEqual(stats.buildStats(recs, T0 + 130000).online.count, 0);
  // Команды на один пинг существующего посетителя: get + set
  fake.calls.length = 0; await stats.record({ id: 'bbbbbbbb-2222', ip: '178.1.2.13', ua: UA_IOS, group: '841', type: 'ping' }, T0 + 60000);
  assert.deepStrictEqual(fake.calls, ['get', 'set']);
  // Истёкшая запись вычищается из индекса
  fake.kv.delete('stats:v:aaaaaaaa-1111'); assert.strictEqual((await stats.loadVisitors()).length, 2); assert.strictEqual(fake.z.get('stats:index').size, 2);
  console.log('stats: все проверки пройдены');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
