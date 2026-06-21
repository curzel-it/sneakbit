// Freeze — a short per-monster status effect applied by ice-buffed bullets
// (iceMode.js). A frozen monster can't take a step (mobs.js skips it) and can't
// deal melee contact damage (combat.js skips it), but it still takes bullet
// damage and dies normally. A frost overlay renders on top of it for the
// duration (entities.draw reads isFrozen + freezeOverlayId).
//
// Host-authoritative: combat.js stamps `_frozenUntil` (an ms-epoch timestamp,
// lazy expiry like the buff timers). Guests never run combat — they receive a
// mirrored `frozen` boolean on the snapshot (snapshotBroadcaster.js), so
// isFrozen() reads either source and works on both sides.
//
// Only monsters of a known footprint can be frozen: the four authored frost
// overlay sprites cover 1×1, 1×2, 2×2 and 2×4 monsters. Anything else has no
// matching overlay and is left immune.

export const FREEZE_DURATION_MS = 250;

// Species of the 1×1, 2-frame frost aura drawn on top of each icy bullet.
export const BULLET_AURA_SPECIES_ID = 260621191;

// Monster footprint "WxH" -> frost overlay species id (static_objects sheet).
const OVERLAY_BY_SIZE = {
  "1x1": 260621201,
  "1x2": 260621202,
  "2x2": 260621203,
  "2x4": 260621204,
};

function nowMs() { return Date.now(); }

// The frost overlay species for this entity's footprint, or null if the size
// has no authored overlay (the entity is then immune to freezing). Derived
// from species width/height with a frame fallback, matching combat/mobs sizing.
export function freezeOverlayId(sp, frame) {
  const w = Math.max(1, (sp?.width || frame?.w || 1) | 0);
  const h = Math.max(1, (sp?.height || frame?.h || 1) | 0);
  return OVERLAY_BY_SIZE[`${w}x${h}`] ?? null;
}

// Apply (or refresh) the freeze on a monster. No-op for footprints without a
// matching overlay, so an odd-sized target is naturally immune. Re-applied
// every frame an icy bullet overlaps, so the timer rides ~FREEZE_DURATION_MS
// past the last contact.
export function freezeEntity(e, sp) {
  if (!e) return;
  if (freezeOverlayId(sp, e.frame) == null) return;
  e._frozenUntil = nowMs() + FREEZE_DURATION_MS;
}

// Is this entity frozen right now? Host reads its own `_frozenUntil` timestamp
// (lazy expiry); guest reads the mirrored `frozen` boolean off the snapshot.
export function isFrozen(e) {
  if (!e) return false;
  if (e.frozen === true) return true;
  return e._frozenUntil != null && nowMs() < e._frozenUntil;
}
