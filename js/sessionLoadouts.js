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

import { getEquipped, SLOT_MELEE, SLOT_RANGED, ARMOR_SLOTS } from "./equipment.js";
import { isPvp } from "./gameMode.js";

const loadouts = new Map(); // playerId -> { melee, ranged, armor }

// An armour object with every slot empty. The canonical "no armour" value, so
// resolveLoadout callers can always read armor.helmet/chest/legs.
export function emptyArmor() {
  const armor = {};
  for (const slot of ARMOR_SLOTS) armor[slot] = null;
  return armor;
}

// Coerce an arbitrary armour payload into a full {helmet,chest,legs} map
// of ids-or-null, dropping unknown keys. Tolerates null/undefined.
function normalizeArmor(armor) {
  const out = emptyArmor();
  if (armor && typeof armor === "object") {
    for (const slot of ARMOR_SLOTS) {
      const v = armor[slot];
      out[slot] = v == null ? null : v | 0;
    }
  }
  return out;
}

// In PvP everyone fights with at least a melee weapon: a player who walks
// into the arena without a melee equipped is handed the sword, so a match is
// never a ranged-only stalemate (and the melee button always has something to
// swing). Players who already brought their own melee keep it. Non-PvP play is
// untouched — a missing melee stays null. Sword = objects.name.sword.weapon.
const PVP_DEFAULT_MELEE = 1159;

export function setSessionLoadout(playerId, melee, ranged, armor = null) {
  if (!playerId) return;
  loadouts.set(playerId, {
    melee: melee == null ? null : melee | 0,
    ranged: ranged == null ? null : ranged | 0,
    armor: normalizeArmor(armor),
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
    playerId, melee: e.melee, ranged: e.ranged, armor: e.armor || emptyArmor(),
  }));
}

// Resolve the equipment a given player has on. Prefers the session-map
// entry by playerId (kept in sync via the host/guest loadout-sync
// modules). Falls back to the local equipment store by index so that
// single-player and local-coop callers (no playerId on the player object)
// still get the right answer without a session entry.
export function resolveLoadout(player) {
  if (!player) return { melee: null, ranged: null, armor: emptyArmor() };
  let melee = null;
  let ranged = null;
  let armor = emptyArmor();
  const sid = player.playerId;
  const e = sid ? loadouts.get(sid) : null;
  if (e) {
    melee = e.melee ?? null;
    ranged = e.ranged ?? null;
    armor = e.armor ? normalizeArmor(e.armor) : emptyArmor();
  } else {
    const idx = player.index | 0;
    melee = getEquipped(SLOT_MELEE, idx) ?? null;
    ranged = getEquipped(SLOT_RANGED, idx) ?? null;
    for (const slot of ARMOR_SLOTS) armor[slot] = getEquipped(slot, idx) ?? null;
  }
  if (melee == null && isPvp()) melee = PVP_DEFAULT_MELEE;
  return { melee, ranged, armor };
}

export function _resetSessionLoadoutsForTesting() { loadouts.clear(); }
