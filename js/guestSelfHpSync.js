// Guest-side: keep playerHealth.records[0].hp in lockstep with the
// host's authoritative HP for this client. The mirror already stores
// per-player hp from snapshot + delta frames, but the local healthHud
// reads getPlayerHp(0) and we don't want to teach it about the mirror.
// Subscribing here means the HUD works for guests with zero changes.

import { setPlayerHp } from "./playerHealth.js?v=20260529a";
import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js?v=20260529a";
import { rumble } from "./rumble.js?v=20260529a";

let unsubs = [];
let installed = false;
// Tracks the last authoritative HP so we can rumble the guest's own pad
// when it drops. The host rumbles its local players directly via
// playerHealth; a guest only learns of its own damage through these
// auth frames, so the detection lives here.
let lastSelfHp = null;

export function installGuestSelfHpSync(opts = {}) {
  uninstallGuestSelfHpSync();
  if (getNetRole() !== "guest" && !opts.force) return false;
  const net = opts.net || getNet();
  if (!net) return false;
  installed = true;
  unsubs.push(net.on("snapshot", onAuth));
  unsubs.push(net.on("delta", onAuth));
  return true;
}

export function uninstallGuestSelfHpSync() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  installed = false;
  lastSelfHp = null;
}

export const _uninstallGuestSelfHpSyncForTesting = uninstallGuestSelfHpSync;

function onAuth(msg) {
  const selfId = getSelfPlayerId();
  if (!selfId) return;
  const self = (msg?.players || []).find((p) => p.playerId === selfId);
  if (!self || typeof self.hp !== "number") return;
  // A drop means the host docked our HP this frame — rumble our own pad
  // (slot 1 on the guest's machine). Respawns/heals raise hp, no rumble.
  if (lastSelfHp !== null && self.hp < lastSelfHp) rumble(1, "hurt");
  lastSelfHp = self.hp;
  setPlayerHp(self.hp, 0);
}

export function _isInstalledForTesting() { return installed; }
