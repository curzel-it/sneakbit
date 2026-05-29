// Guest-side: keep playerHealth.records[0].hp in lockstep with the
// host's authoritative HP for this client. The mirror already stores
// per-player hp from snapshot + delta frames, but the local healthHud
// reads getPlayerHp(0) and we don't want to teach it about the mirror.
// Subscribing here means the HUD works for guests with zero changes.

import { setPlayerHp } from "./playerHealth.js?v=20260529d";
import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js?v=20260529d";

let unsubs = [];
let installed = false;

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
}

export const _uninstallGuestSelfHpSyncForTesting = uninstallGuestSelfHpSync;

function onAuth(msg) {
  const selfId = getSelfPlayerId();
  if (!selfId) return;
  const self = (msg?.players || []).find((p) => p.playerId === selfId);
  if (!self || typeof self.hp !== "number") return;
  setPlayerHp(self.hp, 0);
}

export function _isInstalledForTesting() { return installed; }
