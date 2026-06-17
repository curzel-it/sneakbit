// Per-player coin wallet: the real game's currency balance, keyed by player
// index. Sibling to inventory.js (ammo / pickup counts) — same persistence
// namespace, a single scalar per player instead of a per-species map.
//
// Every player owns a dedicated purse and spends from it alone: single-player
// and the host use index 0, local split-screen co-op uses indices 1..3 for
// P2..P4, and each online guest owns its own balance (the host reflects
// per-guest credits over the wire — see guestEvents.js `coins`). No index is
// folded onto another.

import { getValue, setValue } from "./storage.js";

const MAX_PLAYERS = 4;
// Every fresh save starts the hero with a small purse so the zone-1001 shop is
// usable without grinding first. Granted once via seedStartingCoins (see below).
const STARTING_COINS = 50;
// Lazy in-memory mirror; null means "not loaded from storage yet".
const balances = new Array(MAX_PLAYERS).fill(null);
const listeners = new Set();

function key(playerIndex) {
  return `player.${playerIndex | 0}.coins`;
}

// Marks that this slot has already received its starting purse. Needed because
// addCoins persists `null` at a zero balance, so "spent down to 0" is otherwise
// indistinguishable from "never seeded" — without this flag a broke player would
// be re-granted STARTING_COINS on every reload.
function seededKey(playerIndex) {
  return `player.${playerIndex | 0}.coins.seeded`;
}

// Wallets are never folded: each player index addresses its own purse.
// Mirrors inventory.js effectiveIndex.
function effectiveIndex(playerIndex) {
  return playerIndex | 0;
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

// Grant the one-time starting purse if this slot hasn't been seeded yet. Called
// once at boot (main.js). Kept out of load() so the read path stays
// side-effect-free and the wallet tests still see a fresh balance of 0. A New
// game wipes localStorage (flag included), so the next boot re-seeds; an
// existing pre-currency save gets a one-time top-up on its next boot.
export function seedStartingCoins(playerIndex = 0) {
  const idx = effectiveIndex(playerIndex);
  if (getValue(seededKey(idx))) return;
  setValue(seededKey(idx), 1);
  balances[idx] = STARTING_COINS;
  setValue(key(idx), STARTING_COINS);
  for (const fn of listeners) fn(STARTING_COINS, idx);
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

// Drop the in-memory mirror so balances are re-read from storage on next
// access. Used by tests for a clean slate.
export function resetWalletCache() {
  balances.fill(null);
}

// Test-only alias kept for existing tests.
export function _resetWalletForTesting() {
  resetWalletCache();
}
