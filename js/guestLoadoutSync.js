// Guest-side loadout sync. Sends the guest's local equipment to the host
// over guest.loadout (initial + on every local equipment change) and
// applies inbound event:loadout frames from the host into sessionLoadouts
// so the guest's renderer + combat reads see the correct gear on every
// avatar. For loadouts addressed to selfPlayerId, ALSO writes through to
// the guest's local equipment store — so an auto-equip the host pushed
// after a pickup persists past the session.

import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js?v=20260528h";
import {
  getEquipped,
  setEquipped,
  clearEquipped,
  onEquipmentChange,
  SLOT_MELEE,
  SLOT_RANGED,
} from "./equipment.js?v=20260528h";
import {
  setSessionLoadout,
  clearSessionLoadouts,
} from "./sessionLoadouts.js?v=20260528h";

let unsubs = [];
let installed = false;

export function installGuestLoadoutSync(opts = {}) {
  uninstallGuestLoadoutSync();
  if (getNetRole() !== "guest" && !opts.force) return false;
  const net = opts.net || getNet();
  if (!net) return false;
  installed = true;

  sendSelfLoadout(net);

  unsubs.push(onEquipmentChange((_slot, _id, idx) => {
    // Only self-driven local changes — defensive against a future caller
    // writing equipment for a non-self index.
    if (idx !== 0) return;
    sendSelfLoadout(net);
  }));

  unsubs.push(net.on("event", (m) => {
    if (!m || m.kind !== "loadout") return;
    onLoadoutEvent(m);
  }));
  return true;
}

export function uninstallGuestLoadoutSync() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  installed = false;
  clearSessionLoadouts();
}

export const _uninstallGuestLoadoutSyncForTesting = uninstallGuestLoadoutSync;

function sendSelfLoadout(net) {
  if (!net?.isConnected?.()) return;
  const payload = {
    op: "guest.loadout",
    melee: getEquipped(SLOT_MELEE, 0) ?? null,
    ranged: getEquipped(SLOT_RANGED, 0) ?? null,
  };
  net.send(payload);
}

function onLoadoutEvent(m) {
  const playerId = m.playerId;
  if (!playerId) return;
  const melee = m.melee == null ? null : m.melee;
  const ranged = m.ranged == null ? null : m.ranged;
  setSessionLoadout(playerId, melee, ranged);
  // Write-through for self: a host-side auto-equip after a pickup should
  // persist on this client's local save so it survives reconnect / going
  // offline. Compare against current local equipment to avoid the echo
  // (setEquipped fires onEquipmentChange which would re-send guest.loadout
  // unnecessarily — same value comparison short-circuits that loop).
  const selfId = getSelfPlayerId();
  if (playerId !== selfId) return;
  const curMelee = getEquipped(SLOT_MELEE, 0) ?? null;
  const curRanged = getEquipped(SLOT_RANGED, 0) ?? null;
  if (melee !== curMelee) {
    if (melee == null) clearEquipped(SLOT_MELEE, 0);
    else setEquipped(SLOT_MELEE, melee, 0);
  }
  if (ranged !== curRanged) {
    if (ranged == null) clearEquipped(SLOT_RANGED, 0);
    else setEquipped(SLOT_RANGED, ranged, 0);
  }
}

export function _isInstalledForTesting() { return installed; }
