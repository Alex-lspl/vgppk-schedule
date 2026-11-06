// Поддельный Redis, повторяющий поведение Upstash-клиента (в т.ч. авто-разбор JSON в get/mget)
module.exports = function makeFake() {
  const kv = new Map(); const z = new Map(); const h = new Map(); const calls = []; const ttl = new Map();
  const auto = (v) => { if (typeof v !== 'string') return v; try { const o = JSON.parse(v); return (o && typeof o === 'object') ? o : v; } catch { return v; } };
  return {
    calls, kv, z, h, ttl,
    async get(k) { calls.push('get'); return kv.has(k) ? auto(kv.get(k)) : null; },
    async set(k, v, o) { calls.push('set'); kv.set(k, v); ttl.set(k, o && o.ex); return 'OK'; },
    async zadd(k, { score, member }) { calls.push('zadd'); if (!z.has(k)) z.set(k, new Map()); z.get(k).set(member, score); return 1; },
    async zrange(k, a, b) { calls.push('zrange'); return z.has(k) ? [...z.get(k).entries()].sort((x, y) => x[1] - y[1]).map((e) => e[0]) : []; },
    async mget(...keys) { calls.push('mget'); return keys.map((k) => (kv.has(k) ? auto(kv.get(k)) : null)); },
    async hincrby(k, f, n) { calls.push('hincrby'); if (!h.has(k)) h.set(k, {}); h.get(k)[f] = (Number(h.get(k)[f]) || 0) + n; return h.get(k)[f]; },
    async hset(k, obj) { calls.push('hset'); if (!h.has(k)) h.set(k, {}); Object.assign(h.get(k), obj); return Object.keys(obj).length; },
    async hgetall(k) { calls.push('hgetall'); return h.has(k) ? { ...h.get(k) } : null; },
    async expire() { calls.push('expire'); return 1; },
    async del(...keys) { calls.push('del'); let n = 0; for (const k of keys) { if (kv.delete(k)) n++; if (z.delete(k)) n++; if (h.delete(k)) n++; } return n; },
    async zrem(k, ...m) { calls.push('zrem'); m.forEach((x) => z.get(k) && z.get(k).delete(x)); return m.length; },
  };
};
