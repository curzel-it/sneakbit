// Per-playerId loadout cache for online co-op. Single source of truth for
// "what is this player wearing right now" across host + guest views. The
// host writes its own entry from local equipment changes, writes guests'
// entries from incoming guest.loadout ops + pickup auto-equip, and fans
// every change out as event:loadout. The guest mirrors what it receives
// here and writes through to its own local equipment storage when the
// payload is about itself, so an auto-equipped pickup persists past the
// session.
//
// Anything that asks "what does this player have equipped" — renderers
// (entities.drawPlayer), combat (melee/shooting), damage reduction
// (playerHealth), the on-screen melee button — should route through
// resolveLoadout(player) here instead of calling getEquipped(SLOT, idx)
// directly. Offline + local-coop callers fall through to getEquipped
// transparently via the no-entry fallback, so the seam is also safe to
// use in single-player paths.

import { getEquipped, SLOT_MELEE, SLOT_RANGED } from "./equipment.js?v=20260530a";

const loadouts = new Map(); // playerId -> { melee, ranged }

export function setSessionLoadout(playerId, melee, ranged) {
  if (!playerId) return;
  loadouts.set(playerId, {
    melee: melee == null ? null : melee | 0,
    ranged: ranged == null ? null : ranged | 0,
  });
}

export function getSessionLoadout(playerId) {
  if (!playerId) return null;
  return loadouts.get(playerId) || null;
}

export function deleteSessionLoadout(playerId) {
  if (!playerId) return;
  loadouts.delete(playerId);
}

export function clearSessionLoadouts() {
  loadouts.clear();
}

export function listSessionLoadouts() {
  return Array.from(loadouts.entries()).map(([playerId, e]) => ({
    playerId, melee: e.melee, ranged: e.ranged,
  }));
}

// Resolve the equipment a given player has on. Prefers the session-map
// entry by playerId (kept in sync via the host/guest loadout-sync
// modules). Falls back to the local equipment store by index so that
// single-player and local-coop callers (no playerId on the player object)
// still get the right answer without a session entry.
export function resolveLoadout(player) {
  if (!player) return { melee: null, ranged: null };
  const sid = player.playerId;
  if (sid) {
    const e = loadouts.get(sid);
    if (e) return { melee: e.melee ?? null, ranged: e.ranged ?? null };
  }
  const idx = player.index | 0;
  return {
    melee: getEquipped(SLOT_MELEE, idx) ?? null,
    ranged: getEquipped(SLOT_RANGED, idx) ?? null,
  };
}

export function _resetSessionLoadoutsForTesting() { loadouts.clear(); }
