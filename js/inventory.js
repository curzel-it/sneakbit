// Player inventory: count of each pickup-able species id. Lives in
// localStorage so it survives reloads. Future weapons just register
// their bullet species id and read counts via getAmmo.

const STORAGE_KEY = "sneakbit.inventory.v1";

let counts = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(counts)); } catch {}
  for (const fn of listeners) fn(counts);
}

export function getAmmo(speciesId) {
  return counts[speciesId] | 0;
}

export function addAmmo(speciesId, amount = 1) {
  if (!amount) return;
  counts[speciesId] = (counts[speciesId] | 0) + amount;
  persist();
}

export function removeAmmo(speciesId, amount = 1) {
  const have = counts[speciesId] | 0;
  if (have < amount) return false;
  counts[speciesId] = have - amount;
  persist();
  return true;
}

export function onInventoryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearInventory() {
  counts = {};
  persist();
}
