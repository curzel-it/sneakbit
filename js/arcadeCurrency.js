// Tower Defense economy: a single gold pool plus a change-listener registry.
// No currency exists anywhere else in the game — this is net-new and lives
// only on the TD path. Pure data + events; the DOM build/buy panel (tdHud.js)
// renders it and the controller drives income/spend. Per CLAUDE.md the UI is
// never canvas.

let gold = 0;
const listeners = new Set();

export function resetGold(amount = 0) {
  gold = Math.max(0, amount | 0);
  notify();
}

export function getGold() {
  return gold;
}

export function addGold(amount) {
  const n = amount | 0;
  if (n <= 0) return gold;
  gold += n;
  notify();
  return gold;
}

export function canAfford(cost) {
  return gold >= (cost | 0);
}

// Spend if affordable; returns true on success, false if too poor (no change).
export function spendGold(cost) {
  const c = cost | 0;
  if (c <= 0) return true;
  if (gold < c) return false;
  gold -= c;
  notify();
  return true;
}

export function onGoldChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(gold);
}
