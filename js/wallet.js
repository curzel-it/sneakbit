// Per-player coin wallet: the real game's currency balance, keyed by player
// index. Sibling to inventory.js (ammo / pickup counts) — same persistence
// namespace and the same co-op folding rule, but a single scalar per player
// instead of a per-species map.
//
// Single-player defaults to index 0. Local split-screen co-op (one save slot)
// FOLDS P2..P4 onto P1 so both heroes spend from one purse. Network co-op
// keeps indices independent — each guest owns its own balance and the host
// reflects per-guest credits over the wire (see guestEvents.js `coins`).

import { getValue, setValue } from "./storage.js";
import { isCoopMode } from "./coopMode.js";

const MAX_PLAYERS = 4;
// Lazy in-memory mirror; null means "not loaded from storage yet".
const balances = new Array(MAX_PLAYERS).fill(null);
const listeners = new Set();

function key(playerIndex) {
  return `player.${playerIndex | 0}.coins`;
}

// Local co-op shares one save slot — both local heroes use player.0. Network
// co-op keeps slots independent. Mirrors inventory.js effectiveIndex.
function effectiveIndex(playerIndex) {
  const idx = playerIndex | 0;
  if (idx > 0 && isCoopMode()) return 0;
  return idx;
}

function load(idx) {
  if (balances[idx] == null) balances[idx] = getValue(key(idx)) | 0;
  return balances[idx];
}

export function getCoins(playerIndex = 0) {
  return load(effectiveIndex(playerIndex));
}

export function addCoins(amount = 1, playerIndex = 0) {
  if (!amount) return;
  const idx = effectiveIndex(playerIndex);
  const next = Math.max(0, load(idx) + (amount | 0));
  balances[idx] = next;
  setValue(key(idx), next === 0 ? null : next);
  for (const fn of listeners) fn(next, idx);
}

export function onWalletChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Not wired into the New-game button (that does a full localStorage.clear() +
// reload), but kept for symmetry with clearInventory and for tests.
export function clearWallet(playerIndex) {
  const targets = playerIndex == null
    ? balances.map((_, i) => i)
    : [effectiveIndex(playerIndex)];
  for (const idx of targets) {
    balances[idx] = 0;
    setValue(key(idx), null);
    for (const fn of listeners) fn(0, idx);
  }
}

// Test-only: drop the in-memory mirror so a fresh storage state is re-read.
export function _resetWalletForTesting() {
  balances.fill(null);
}
