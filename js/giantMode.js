// Giant mode — a timed, purely cosmetic transformation. While active the hero
// renders at 3×4 tiles instead of 1×2 (entities.drawPlayer reads isGiant), but
// collision and tile-occupancy are untouched: the giant walks exactly where a
// normal-sized hero could, since the renderer is the only consumer of this
// state.
//
// Triggered by the Giant Pill consumable (consumables.js) and synced across
// online multiplayer with the same playerId-keyed, bidirectional pattern as
// skins/loadout (sessionSkins + event:loadout):
//   * any peer activating broadcasts so every client renders that avatar giant;
//   * a guest announces via op:"guest.giant" → the host fans event:"giant" to
//     everyone (the guest already armed itself locally);
//   * the host's own activation broadcasts event:"giant" directly.
//
// Keying on playerId (not player index) is load-bearing: on a guest the host's
// avatar and the guest's own self are BOTH local index 0, so an index-keyed
// store would conflate them. playerId is unique per participant.

import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js";
import { broadcastHostEvent } from "./hostEvents.js";

export const GIANT_DURATION_MS = 20_000;

// key -> endsAt (ms epoch). key is the player's network identity (playerId)
// when online, or `local:<index>` offline / in local co-op (indices unique).
const giants = new Map();

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
  giants.set(key, nowMs() + Math.max(0, ms | 0));
}

// Lazy expiry: a key past its endsAt is dropped on read, so no per-frame tick
// is needed — drawPlayer re-queries every frame and the giant pops back to
// normal the instant the timer lapses.
function active(key, at = nowMs()) {
  const endsAt = giants.get(key);
  if (endsAt == null) return false;
  if (at >= endsAt) { giants.delete(key); return false; }
  return true;
}

// Render-path query: is this player (local object or network mirror) giant
// right now? Works for every avatar — local self, local co-op partner, and
// mirrored host/guest copies — because each carries its own playerId/index.
export function isGiant(player) { return active(keyForPlayer(player)); }

// Inventory query for a local player index — gates the consumable's Use button
// so a pill isn't wasted while already giant.
export function isGiantIndex(index) { return active(keyForIndex(index)); }

// Local activation for a player index (the consumable effect). Arms locally,
// then announces to peers so every client renders this avatar as a giant.
export function triggerGiant(index) {
  arm(keyForIndex(index), GIANT_DURATION_MS);
  // Only the local self (index 0) has a network identity to announce. Local
  // co-op partners (index > 0) are offline-only and need no wire traffic.
  if ((index | 0) === 0) announce(GIANT_DURATION_MS);
}

function announce(ms) {
  const role = getNetRole();
  if (role === "host") {
    const id = getSelfPlayerId();
    if (id) broadcastHostEvent("giant", { playerId: id, ms });
  } else if (role === "guest") {
    const net = getNet();
    if (net?.isConnected?.()) net.send({ op: "guest.giant", ms });
  }
}

// ---- Network glue --------------------------------------------------------

let unsubs = [];

// Wire the giant-mode net listeners for the current role. Idempotent.
//   * everyone: event:"giant" from the host → arm that playerId locally.
//   * host only: op:"guest.giant" from a guest → arm it + fan event:"giant"
//     to all peers (the guest already armed itself locally).
export function installGiantNet(opts = {}) {
  uninstallGiantNet();
  const net = opts.net || getNet();
  if (!net) return false;
  unsubs.push(net.on("event", (m) => {
    if (!m || m.kind !== "giant" || !m.playerId) return;
    arm(m.playerId, m.ms ?? GIANT_DURATION_MS);
  }));
  if (getNetRole() === "host") {
    unsubs.push(net.on("guest.giant", (m) => {
      if (!m || !m.from) return;
      const ms = m.ms ?? GIANT_DURATION_MS;
      arm(m.from, ms);
      broadcastHostEvent("giant", { playerId: m.from, ms });
    }));
  }
  return true;
}

export function uninstallGiantNet() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  // Drop session state so a stale giant can't bleed into the next session.
  giants.clear();
}

// Test seams.
export function _clearGiantsForTesting() { giants.clear(); }
export function _armForTesting(key, ms) { arm(key, ms); }
