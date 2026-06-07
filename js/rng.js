// Seeded pseudo-random generator. Shared infrastructure for any feature that
// needs *deterministic* randomness — most importantly procedural placement,
// which must produce byte-identical results on every co-op peer (the worlds
// would diverge otherwise). Never use Math.random for anything two peers must
// agree on; seed one of these off a stable value (e.g. the zone id) instead.

// mulberry32: a tiny, fast, well-distributed 32-bit PRNG. Returns a function
// yielding floats in [0, 1). Deterministic for a given seed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derive a stable seed from a zone id. The golden-ratio multiply disperses
// adjacent ids (1002, 1003, …) into very different seeds so neighbouring
// zones don't get visually similar layouts.
export function zoneSeed(zoneId) {
  return Math.imul(zoneId >>> 0, 0x9e3779b1) >>> 0;
}
