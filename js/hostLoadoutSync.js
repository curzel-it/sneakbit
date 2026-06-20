// Host-side loadout sync. Owns the session-loadouts entries the host
// knows about and broadcasts event:loadout whenever any of them change,
// so every guest's render layer (and combat resolution that consults
// sessionLoadouts) tracks the per-player gear without further wiring.
//
// Three input edges:
//   * the host's own onEquipmentChange (their local index 0) → update
//     self entry + broadcast
//   * peer.joined / peer.rejoined → re-broadcast every known entry so
//     the new joiner sees the full picture
//   * incoming guest.loadout op (from a guest's hostLoadoutSync peer
//     module) → update that guest's entry + fan event:loadout to all
//
// Self entry is keyed on selfPlayerId, which the welcome handler in
// onlineBootstrap fills in before the relay routes any guest frames our
// way — so seedSelfFromLocal can rely on it during install.

import { broadcastHostEvent } from "./hostEvents.js";
import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js";
import {
  onEquipmentChange,
  snapshotEquipment,
} from "./equipment.js";
import {
  setSessionLoadout,
  getSessionLoadout,
  deleteSessionLoadout,
  clearSessionLoadouts,
  listSessionLoadouts,
  emptyArmor,
} from "./sessionLoadouts.js";
import {
  setSessionSkin,
  skinFor,
  deleteSessionSkin,
  clearSessionSkins,
} from "./sessionSkins.js";
import { getSelected, onSkinChange } from "./skins.js";

let unsubs = [];
let installed = false;

export function installHostLoadoutSync(opts = {}) {
  uninstallHostLoadoutSync();
  if (getNetRole() !== "host" && !opts.force) return false;
  const net = opts.net || getNet();
  if (!net) return false;
  installed = true;

  seedSelfFromLocal();

  // Local equipment writes for self → push to session map + broadcast.
  // We only react to index-0 writes; non-zero writes mean a pickup
  // handler tried to equip a guest's slot through the local-equipment
  // store, which we no longer broadcast through (pickups.js writes the
  // session entry directly instead).
  unsubs.push(onEquipmentChange((slot, speciesId, idx) => {
    if (idx !== 0) return;
    const selfId = getSelfPlayerId();
    if (!selfId) return;
    // Any slot can change (weapon or armour) — snapshot the whole loadout
    // rather than diff a single field, so armour rides the same frame.
    const next = snapshotEquipment(0);
    setSessionLoadout(selfId, next.melee, next.ranged, next.armor);
    broadcastHostEvent("loadout", {
      playerId: selfId,
      melee: next.melee,
      ranged: next.ranged,
      armor: next.armor,
      skin: skinFor(selfId) ?? getSelected(0),
    });
  }));

  // Host's own skin change → push the skin on a loadout frame (gear
  // unchanged), so every guest re-renders the host's avatar.
  unsubs.push(onSkinChange((idx) => {
    if (idx !== 0) return;
    const selfId = getSelfPlayerId();
    if (!selfId) return;
    const skin = getSelected(0);
    setSessionSkin(selfId, skin);
    const lo = getSessionLoadout(selfId) || { melee: null, ranged: null, armor: emptyArmor() };
    broadcastHostEvent("loadout", { playerId: selfId, melee: lo.melee, ranged: lo.ranged, armor: lo.armor || emptyArmor(), skin });
  }));

  unsubs.push(net.on("peer.joined", broadcastAll));
  unsubs.push(net.on("peer.rejoined", broadcastAll));
  unsubs.push(net.on("peer.left", (m) => onPeerLeft(m)));
  unsubs.push(net.on("guest.loadout", onGuestLoadout));
  return true;
}

export function uninstallHostLoadoutSync() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  installed = false;
  clearSessionLoadouts();
  clearSessionSkins();
}

export const _uninstallHostLoadoutSyncForTesting = uninstallHostLoadoutSync;

function seedSelfFromLocal() {
  const selfId = getSelfPlayerId();
  if (!selfId) return;
  const { melee, ranged, armor } = snapshotEquipment(0);
  setSessionLoadout(selfId, melee, ranged, armor);
  setSessionSkin(selfId, getSelected(0));
}

function onGuestLoadout(m) {
  if (!m || !m.from) return;
  const playerId = m.from;
  const melee = m.melee == null ? null : m.melee;
  const ranged = m.ranged == null ? null : m.ranged;
  const armor = m.armor || emptyArmor();
  const skin = m.skin == null ? null : m.skin;
  setSessionLoadout(playerId, melee, ranged, armor);
  setSessionSkin(playerId, skin);
  broadcastHostEvent("loadout", { playerId, melee, ranged, armor, skin });
}

function onPeerLeft(m) {
  if (!m || !m.playerId) return;
  deleteSessionLoadout(m.playerId);
  deleteSessionSkin(m.playerId);
}

function broadcastAll() {
  // Re-affirm self entry from local equipment in case it changed before
  // a guest could see the first event (shouldn't normally happen, but
  // cheap insurance — keeps the map in lockstep with localStorage).
  seedSelfFromLocal();
  for (const e of listSessionLoadouts()) {
    broadcastHostEvent("loadout", {
      playerId: e.playerId,
      melee: e.melee,
      ranged: e.ranged,
      armor: e.armor || emptyArmor(),
      skin: skinFor(e.playerId),
    });
  }
}

export function _isInstalledForTesting() { return installed; }
