// Ice mode — a timed combat buff. While active, every bullet the player fires
// (kunai, other ranged, and the melee/sword cross-bullets) freezes the monsters
// it hits for a short beat (freeze.js). A 3×3 aura renders under the hero's feet
// for the duration (entities.drawPlayer reads isIceActive); collision and
// movement are untouched — this state only feeds the renderer and the bullet
// tagging in shooting/melee.
//
// Triggered by the Ice Potion consumable (consumables.js) and synced across
// online multiplayer with the same playerId-keyed, bidirectional pattern as
// giant mode (giantMode.js):
//   * any peer activating broadcasts so every client renders that avatar's aura;
//   * a guest announces via op:"guest.ice" → the host fans event:"ice" to
//     everyone (the guest already armed itself locally);
//   * the host's own activation broadcasts event:"ice" directly.
//
// Keying on playerId (not player index) is load-bearing: on a guest the host's
// avatar and the guest's own self are BOTH local index 0, so an index-keyed
// store would conflate them. playerId is unique per participant.

import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js";
import { broadcastHostEvent } from "./hostEvents.js";

export const ICE_DURATION_MS = 10_000;
// Species of the 3×3 freezing aura sprite drawn under the hero's feet.
export const ICE_AURA_SPECIES_ID = 11004;

// key -> endsAt (ms epoch). key is the player's network identity (playerId)
// when online, or `local:<index>` offline / in local co-op (indices unique).
const buffs = new Map();

function nowMs() { return Date.now(); }

// Index 0 is always the local self (host self, guest self, or the sole offline
// player). Online it has a stable playerId; offline / local co-op it doesn't.
function keyForIndex(index) {
  if ((index | 0) === 0) {
    const id = getSelfPlayerId();
    if (id) return id;
  }
  return `local:${index | 0}`;
}

function keyForPlayer(player) {
  if (player?.playerId) return player.playerId;
  return `local:${player?.index | 0}`;
}

function arm(key, ms) {
  if (!key) return;
  buffs.set(key, nowMs() + Math.max(0, ms | 0));
  notify();
}

// Change listeners — the HUD timer bar (iceTimerBar.js) subscribes so it can
// wake up and start its countdown the instant a potion is consumed (locally or
// via the network), mirroring giantMode's onGiantChange.
const listeners = new Set();
export function onIceChange(cb) {
  if (typeof cb !== "function") return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify() {
  for (const cb of listeners) { try { cb(); } catch { /* ignore */ } }
}

// Lazy expiry: a key past its endsAt is dropped on read, so no per-frame tick
// is needed — drawPlayer / the bullet tagging re-query every time and the aura
// pops out the instant the timer lapses.
function active(key, at = nowMs()) {
  const endsAt = buffs.get(key);
  if (endsAt == null) return false;
  if (at >= endsAt) { buffs.delete(key); return false; }
  return true;
}

// Render / bullet-tagging query: is this player (local object or network
// mirror) ice-buffed right now? Works for every avatar — local self, local
// co-op partner, and mirrored host/guest copies — because each carries its own
// playerId/index.
export function isIceActive(player) { return active(keyForPlayer(player)); }

// Inventory query for a local player index — gates the consumable's Use button
// so a potion isn't wasted while the buff is already running.
export function isIceActiveIndex(index) { return active(keyForIndex(index)); }

// Remaining buff time (ms) for a local player index, clamped to >= 0 and 0 once
// lapsed/absent. Feeds the HUD timer bar's countdown and the aura's fade-out.
export function getIceRemainingMs(index) {
  const endsAt = buffs.get(keyForIndex(index));
  if (endsAt == null) return 0;
  return Math.max(0, endsAt - nowMs());
}

// Local activation for a player index (the consumable effect). Arms locally,
// then announces to peers so every client renders this avatar's aura.
export function triggerIce(index) {
  arm(keyForIndex(index), ICE_DURATION_MS);
  // Only the local self (index 0) has a network identity to announce. Local
  // co-op partners (index > 0) are offline-only and need no wire traffic.
  if ((index | 0) === 0) announce(ICE_DURATION_MS);
}

function announce(ms) {
  const role = getNetRole();
  if (role === "host") {
    const id = getSelfPlayerId();
    if (id) broadcastHostEvent("ice", { playerId: id, ms });
  } else if (role === "guest") {
    const net = getNet();
    if (net?.isConnected?.()) net.send({ op: "guest.ice", ms });
  }
}

// ---- Network glue --------------------------------------------------------

let unsubs = [];

// Wire the ice-mode net listeners for the current role. Idempotent.
//   * everyone: event:"ice" from the host → arm that playerId locally.
//   * host only: op:"guest.ice" from a guest → arm it + fan event:"ice"
//     to all peers (the guest already armed itself locally).
export function installIceNet(opts = {}) {
  uninstallIceNet();
  const net = opts.net || getNet();
  if (!net) return false;
  unsubs.push(net.on("event", (m) => {
    if (!m || m.kind !== "ice" || !m.playerId) return;
    arm(m.playerId, m.ms ?? ICE_DURATION_MS);
  }));
  if (getNetRole() === "host") {
    unsubs.push(net.on("guest.ice", (m) => {
      if (!m || !m.from) return;
      const ms = m.ms ?? ICE_DURATION_MS;
      arm(m.from, ms);
      broadcastHostEvent("ice", { playerId: m.from, ms });
    }));
  }
  return true;
}

export function uninstallIceNet() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  // Drop session state so a stale buff can't bleed into the next session.
  buffs.clear();
  notify();
}

// Test seams.
export function _clearIceForTesting() { buffs.clear(); notify(); }
export function _armForTesting(key, ms) { arm(key, ms); }
