// Guest-side loadout sync. Sends the guest's local equipment to the host
// over guest.loadout (initial + on every local equipment change) and
// applies inbound event:loadout frames from the host into sessionLoadouts
// so the guest's renderer + combat reads see the correct gear on every
// avatar. For loadouts addressed to selfPlayerId, ALSO writes through to
// the guest's local equipment store — so an auto-equip the host pushed
// after a pickup persists past the session.

import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js";
import {
  getEquipped,
  setEquipped,
  clearEquipped,
  onEquipmentChange,
  snapshotEquipment,
  SLOT_MELEE,
  SLOT_RANGED,
  ARMOR_SLOTS,
} from "./equipment.js";
import {
  setSessionLoadout,
  clearSessionLoadouts,
  emptyArmor,
} from "./sessionLoadouts.js";
import { setSessionSkin, clearSessionSkins } from "./sessionSkins.js";
import { getSelected, onSkinChange } from "./skins.js";
import { giftStarterWeaponIfNeeded } from "./starterGift.js";

let unsubs = [];
let installed = false;

export function installGuestLoadoutSync(opts = {}) {
  uninstallGuestLoadoutSync();
  if (getNetRole() !== "guest" && !opts.force) return false;
  const net = opts.net || getNet();
  if (!net) return false;
  installed = true;

  // A guest arriving with under 5 kunai and no melee would be defenceless in
  // the host's world — hand them a sword before the first loadout goes out, so
  // the gifted melee rides the initial guest.loadout to the host. Runs before
  // the onEquipmentChange listener below is wired, so it doesn't echo an extra
  // send; idempotent, so a reconnecting guest who already holds the sword is
  // left alone.
  giftStarterWeaponIfNeeded(0);

  sendSelfLoadout(net);

  unsubs.push(onEquipmentChange((_slot, _id, idx) => {
    // Only self-driven local changes — defensive against a future caller
    // writing equipment for a non-self index.
    if (idx !== 0) return;
    sendSelfLoadout(net);
  }));

  // The chosen skin rides the same loadout frame, so a skin change shows
  // on the host + other peers exactly like an equipment change.
  unsubs.push(onSkinChange((idx) => {
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
  clearSessionSkins();
}

export const _uninstallGuestLoadoutSyncForTesting = uninstallGuestLoadoutSync;

function sendSelfLoadout(net) {
  if (!net?.isConnected?.()) return;
  const { melee, ranged, armor } = snapshotEquipment(0);
  net.send({
    op: "guest.loadout",
    melee,
    ranged,
    armor,
    skin: getSelected(0),
  });
}

function onLoadoutEvent(m) {
  const playerId = m.playerId;
  if (!playerId) return;
  const melee = m.melee == null ? null : m.melee;
  const ranged = m.ranged == null ? null : m.ranged;
  const armor = m.armor || emptyArmor();
  setSessionLoadout(playerId, melee, ranged, armor);
  // Skin is render-only — mirror it so every avatar draws the right column.
  // No write-through for self: this client already owns its selection locally.
  setSessionSkin(playerId, m.skin == null ? null : m.skin);
  // Write-through for self: a host-side auto-equip after a pickup should
  // persist on this client's local save so it survives reconnect / going
  // offline. Compare against current local equipment to avoid the echo
  // (setEquipped fires onEquipmentChange which would re-send guest.loadout
  // unnecessarily — same value comparison short-circuits that loop). Covers
  // every slot: weapons and the three armour pieces.
  const selfId = getSelfPlayerId();
  if (playerId !== selfId) return;
  const incoming = { [SLOT_MELEE]: melee, [SLOT_RANGED]: ranged, ...armor };
  for (const slot of [SLOT_MELEE, SLOT_RANGED, ...ARMOR_SLOTS]) {
    const want = incoming[slot] ?? null;
    const cur = getEquipped(slot, 0) ?? null;
    if (want === cur) continue;
    if (want == null) clearEquipped(slot, 0);
    else setEquipped(slot, want, 0);
  }
}

export function _isInstalledForTesting() { return installed; }
