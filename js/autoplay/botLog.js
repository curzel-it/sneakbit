// Structured event log for the autoplay bot: a ring buffer plus a console
// echo. The stream's debugging lifeline — read live over Chrome CDP on the
// VPS, or pulled by botOverlay for the on-screen ticker. Pure data; no DOM.

const RING_CAPACITY = 200;
const ring = [];
let seq = 0;

// Record one event. `kind` is a short tag ("objective", "travel", "replan",
// "combat", "death", "info"); `detail` is a human string; `data` is optional
// structured context. Returns the stored entry.
export function logEvent(kind, detail, data = null) {
  const entry = { seq: seq++, kind, detail, data };
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.shift();
  // One compact console line so a CDP `Runtime.consoleAPICalled` tail shows
  // the whole story without reaching into the ring.
  console.log(`[autoplay] ${kind}: ${detail}`);
  return entry;
}

// Most-recent `n` entries, newest last (display order).
export function recentEvents(n = 8) {
  return ring.slice(Math.max(0, ring.length - n));
}

export function allEvents() {
  return ring.slice();
}
