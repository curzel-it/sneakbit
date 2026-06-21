// Speed mode — a timed movement buff. While active the hero takes tile-steps
// SPEED_MULTIPLIER× faster (player.stepDuration divides by the multiplier), so
// it covers more ground per second without changing the tile-locked model.
//
// Triggered by the Silver Potion consumable (consumables.js). Unlike giant mode
// this is LOCAL-ONLY and never networked: changing step cadence is unsafe for
// online peers (the host throttles a guest to ~1 step/snap, so a sped-up guest
// would rubber-band — the same reason creative-mode's speed multiplier is
// single-player-only). The consumable's canUse gate blocks it online, so the
// buff is only ever armed in single-player or local co-op, where per-index
// timing is harmless. See [[creative-mode-singleplayer-only]].
//
// Keyed by `local:<index>` so a local co-op partner (index 1) buffs
// independently of the host self (index 0).

export const SPEED_DURATION_MS = 15_000;
export const SPEED_MULTIPLIER = 3;

// key -> endsAt (ms epoch).
const buffs = new Map();

function nowMs() { return Date.now(); }

function keyForIndex(index) { return `local:${index | 0}`; }
function keyForPlayer(player) { return `local:${player?.index | 0}`; }

function arm(key, ms) {
  if (!key) return;
  buffs.set(key, nowMs() + Math.max(0, ms | 0));
  notify();
}

// Change listeners — the HUD timer bar (speedTimerBar.js) subscribes so it can
// wake up and start its countdown the instant the potion is drunk, mirroring
// onGiantChange.
const listeners = new Set();
export function onSpeedChange(cb) {
  if (typeof cb !== "function") return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify() {
  for (const cb of listeners) { try { cb(); } catch { /* ignore */ } }
}

// Lazy expiry: a key past its endsAt is dropped on read, so no per-frame tick
// is needed — stepDuration re-queries every step and movement pops back to
// normal the instant the timer lapses.
function active(key, at = nowMs()) {
  const endsAt = buffs.get(key);
  if (endsAt == null) return false;
  if (at >= endsAt) { buffs.delete(key); return false; }
  return true;
}

// Movement-path query: the step-duration multiplier for this player right now
// (SPEED_MULTIPLIER while buffed, else 1). Consumed by player.stepDuration.
export function speedMultiplier(player) {
  return active(keyForPlayer(player)) ? SPEED_MULTIPLIER : 1;
}

// Inventory query for a local player index — gates the consumable's Use button
// so a potion isn't wasted while already sped up.
export function isSpeedActiveIndex(index) { return active(keyForIndex(index)); }

// Remaining buff time (ms) for a local player index, clamped to >= 0 and 0 once
// lapsed/absent. Feeds the HUD timer bar's countdown.
export function getSpeedRemainingMs(index) {
  const endsAt = buffs.get(keyForIndex(index));
  if (endsAt == null) return 0;
  return Math.max(0, endsAt - nowMs());
}

// Local activation for a player index (the consumable effect).
export function triggerSpeed(index) {
  arm(keyForIndex(index), SPEED_DURATION_MS);
}

// Test seams.
export function _clearSpeedForTesting() { buffs.clear(); notify(); }
export function _armForTesting(index, ms) { arm(keyForIndex(index), ms); }
