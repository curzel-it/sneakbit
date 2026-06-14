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

import { getEquipped, getEquippedId, SLOT_MELEE, SLOT_RANGED } from "./equipment.js";
import { isPvp, isTowerDefenseMode } from "./gameMode.js";

const loadouts = new Map(); // playerId -> { melee, ranged }

// Tower Defense hero archetypes, by 0-based squad slot. These are fixed for
// the run and resolved purely in memory — TD never reads or writes the saved
// equipment, so a run can't pollute the real game's loadout. Each slot is a
// distinct hero (its 0-based index also picks the sprite column, P1..P4) with
// a real weapon, so recruits play differently rather than being kunai clones:
//   0 Ninja      — kunai launcher 1160 (ranged, fast  → rooted shooter)
//   1 Barbarian  — sword 1159          (melee         → charger)
//   2 Bombardier — cannon 1167         (ranged, heavy → rooted shooter)
//   3 Knight     — darkblade 1179      (melee         → charger)
// allyAI keys archetype off the loadout (melee && !ranged === charger), so the
// two ranged slots hold and shoot while the two melee slots charge. Weapons are
// chosen to read differently under infinite TD ammo: the Ninja's kunai is a
// fast 0.15s patter, the Bombardier's cannon a slow 0.5s heavy shell (the
// AR-15's 0.005s rate would be a firehose without an ammo cap). The display
// names live next to the squad logic in towerDefense.js (HERO_NAMES) and must
// stay aligned with this table.
const TD_HERO_LOADOUTS = [
  { melee: null, ranged: 1160 },  // Ninja      — kunai launcher
  { melee: 1159, ranged: null },  // Barbarian  — sword
  { melee: null, ranged: 1167 },  // Bombardier — cannon
  { melee: 1179, ranged: null },  // Knight      — darkblade
];

function tdHeroLoadout(index) {
  return TD_HERO_LOADOUTS[index | 0] || TD_HERO_LOADOUTS[0];
}

// In PvP everyone fights with at least a melee weapon: a player who walks
// into the arena without a melee equipped is handed the sword, so a match is
// never a ranged-only stalemate (and the melee button always has something to
// swing). Players who already brought their own melee keep it. Non-PvP play is
// untouched — a missing melee stays null. Sword = objects.name.sword.weapon.
const PVP_DEFAULT_MELEE = 1159;

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
  // Tower Defense: each slot starts on its fixed archetype, but the shop can
  // re-arm a hero — a bought weapon is written to the (transient) TD equipment
  // and overrides the archetype here, per slot. getEquippedId returns the RAW
  // stored id (null when the slot is untouched), so a melee-only archetype
  // keeps ranged: null until the player actually buys a ranged weapon — unlike
  // getEquipped, whose kunai-launcher default would mask that.
  if (isTowerDefenseMode()) {
    const idx = player.index | 0;
    const base = tdHeroLoadout(idx);
    const melee = getEquippedId(SLOT_MELEE, idx);
    const ranged = getEquippedId(SLOT_RANGED, idx);
    return { melee: melee ?? base.melee, ranged: ranged ?? base.ranged };
  }
  let melee = null;
  let ranged = null;
  const sid = player.playerId;
  const e = sid ? loadouts.get(sid) : null;
  if (e) {
    melee = e.melee ?? null;
    ranged = e.ranged ?? null;
  } else {
    const idx = player.index | 0;
    melee = getEquipped(SLOT_MELEE, idx) ?? null;
    ranged = getEquipped(SLOT_RANGED, idx) ?? null;
  }
  if (melee == null && isPvp()) melee = PVP_DEFAULT_MELEE;
  return { melee, ranged };
}

export function _resetSessionLoadoutsForTesting() { loadouts.clear(); }
