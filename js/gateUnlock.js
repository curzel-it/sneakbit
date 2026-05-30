// Key-consuming unlocks for colored gates. Walking into a closed gate
// while holding a matching key spends the key, marks the gate's lock as
// None (so it stays open across zone reloads), and lets the player pass.
// Mirrors Rust's `lock_override` storage.

import { getSpecies } from "./species.js?v=20260530d";
import {
  canonicaliseLock,
  keySpeciesIdForLock,
  LOCK_NONE,
  LOCK_PERMANENT,
  saveLockOverride,
} from "./locks.js?v=20260530d";
import { getAmmo, removeAmmo } from "./inventory.js?v=20260530d";
import { playSfx } from "./audio.js?v=20260530d";
import { showToast } from "./toast.js?v=20260530d";

export function findGateAt(zone, tx, ty) {
  if (!zone?.entities) return null;
  for (const e of zone.entities) {
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (sp.entity_type !== "Gate" && sp.entity_type !== "InverseGate") continue;
    const f = e.frame; if (!f) continue;
    if (tx < f.x || tx >= f.x + f.w) continue;
    if (ty < f.y || ty >= f.y + f.h) continue;
    return e;
  }
  return null;
}

// Returns true if the gate is now open (either was already open, or was
// keyed and the player held a matching key).
export function tryUnlockGate(gate) {
  if (!gate) return false;
  if (gate._open) return true;
  const lock = canonicaliseLock(gate.lock_type);
  if (lock === LOCK_NONE) {
    gate._open = true;
    gate._frameOffsetX = 1;
    return true;
  }
  if (lock === LOCK_PERMANENT) return false;
  const keyId = keySpeciesIdForLock(lock);
  if (keyId == null) return false;
  if (getAmmo(keyId) <= 0) return false;
  removeAmmo(keyId, 1);
  gate.lock_type = LOCK_NONE;
  gate._open = true;
  gate._frameOffsetX = 1;
  if (gate.id != null) saveLockOverride(gate.id, LOCK_NONE);
  playSfx("keyCollected");
  // Gate unlock changes the host's world for everyone — broadcast so
  // guests see the same notification when the host (or any guest)
  // burns a key.
  showToast(`Unlocked ${lock.toLowerCase()} gate`, "hint", { broadcast: true });
  return true;
}
