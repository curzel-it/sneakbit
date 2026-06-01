// Tiny in-memory sliding-window rate limiter for the auth endpoints —
// brute-force / enumeration defense, modeled on the relay's per-IP /metrics
// limiter. Keyed by an arbitrary string (an IP, or "ip:email"); each key
// keeps the timestamps of its recent hits and a key is allowed while it has
// fewer than `max` hits in the trailing `windowMs`.
//
// Memory is O(active keys × hits/window). Empty/expired keys are pruned
// lazily on access, with a periodic sweep when the map grows large.

const SWEEP_THRESHOLD = 5000;

export function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> number[] (ascending timestamps)

  function sweep(now) {
    const cutoff = now - windowMs;
    for (const [key, arr] of hits) {
      const recent = arr.filter((t) => t > cutoff);
      if (recent.length) hits.set(key, recent);
      else hits.delete(key);
    }
  }

  return {
    // Records a hit and returns true if the key is still within budget,
    // false if this hit puts it over the limit.
    check(key, now = Date.now()) {
      if (hits.size > SWEEP_THRESHOLD) sweep(now);
      const cutoff = now - windowMs;
      const arr = hits.get(key) || [];
      const recent = arr.filter((t) => t > cutoff);
      recent.push(now);
      hits.set(key, recent);
      return recent.length <= max;
    },
    // Test seam.
    _clear() { hits.clear(); },
  };
}
