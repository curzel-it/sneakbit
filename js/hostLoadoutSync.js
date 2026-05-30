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

import { broadcastHostEvent } from "./hostEvents.js?v=20260530c";
import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js?v=20260530c";
import {
  getEquipped,
  onEquipmentChange,
  SLOT_MELEE,
  SLOT_RANGED,
} from "./equipment.js?v=20260530c";
import {
  setSessionLoadout,
  getSessionLoadout,
  deleteSessionLoadout,
  clearSessionLoadouts,
  listSessionLoadouts,
} from "./sessionLoadouts.js?v=20260530c";

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
    const prev = getSessionLoadout(selfId) || { melee: null, ranged: null };
    const next = {
      melee: slot === SLOT_MELEE ? speciesId : prev.melee,
      ranged: slot === SLOT_RANGED ? speciesId : prev.ranged,
    };
    setSessionLoadout(selfId, next.melee, next.ranged);
    broadcastHostEvent("loadout", {
      playerId: selfId,
      melee: next.melee,
      ranged: next.ranged,
    });
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
}

export const _uninstallHostLoadoutSyncForTesting = uninstallHostLoadoutSync;

function seedSelfFromLocal() {
  const selfId = getSelfPlayerId();
  if (!selfId) return;
  const melee = getEquipped(SLOT_MELEE, 0) ?? null;
  const ranged = getEquipped(SLOT_RANGED, 0) ?? null;
  setSessionLoadout(selfId, melee, ranged);
}

function onGuestLoadout(m) {
  if (!m || !m.from) return;
  const playerId = m.from;
  const melee = m.melee == null ? null : m.melee;
  const ranged = m.ranged == null ? null : m.ranged;
  setSessionLoadout(playerId, melee, ranged);
  broadcastHostEvent("loadout", { playerId, melee, ranged });
}

function onPeerLeft(m) {
  if (!m || !m.playerId) return;
  deleteSessionLoadout(m.playerId);
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
    });
  }
}

export function _isInstalledForTesting() { return installed; }
