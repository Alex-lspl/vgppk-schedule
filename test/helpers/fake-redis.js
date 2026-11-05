// Поддельный Redis, повторяющий поведение Upstash-клиента (в т.ч. авто-разбор JSON в get/mget)
module.exports = function makeFake() {
  const kv = new Map(); const z = new Map(); const calls = [];
  const auto = (v) => { if (typeof v !== 'string') return v; try { const o = JSON.parse(v); return (o && typeof o === 'object') ? o : v; } catch { return v; } };
  return {
    calls, kv, z,
    async get(k) { calls.push('get'); return kv.has(k) ? auto(kv.get(k)) : null; },
    async set(k, v, o) { calls.push('set'); kv.set(k, v); return 'OK'; },
    async zadd(k, { score, member }) { calls.push('zadd'); if (!z.has(k)) z.set(k, new Map()); z.get(k).set(member, score); return 1; },
    async zrange(k, a, b) { calls.push('zrange'); return z.has(k) ? [...z.get(k).entries()].sort((x, y) => x[1] - y[1]).map((e) => e[0]) : []; },
    async mget(...keys) { calls.push('mget'); return keys.map((k) => (kv.has(k) ? auto(kv.get(k)) : null)); },
    async zrem(k, ...m) { calls.push('zrem'); m.forEach((x) => z.get(k) && z.get(k).delete(x)); return m.length; },
  };
};
