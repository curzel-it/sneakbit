// Per-player inventory counts, and the two ways items used to go missing.
//
// inventory.js keeps an in-memory mirror of the `player.<p>.inventory.amount.<sid>`
// slice of the kv store. That mirror has to stay in lockstep with storage.js:
// it is the value every add/remove reads before writing back, so any drift is
// written straight over the real save.

import { test } from "node:test";
import assert from "node:assert/strict";

// A working localStorage shim installed BEFORE storage.js is imported, so its
// usability probe sees real writes and the disk path is the one under test
// (Node's own stub throws on setItem, which would put storage.js in its
// in-memory fallback and make the failed-write test unreachable).
function makeLocalStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
  };
}
globalThis.localStorage = makeLocalStorage();

const {
  getAmmo, addAmmo, removeAmmo, clearInventory, snapshotInventory,
} = await import("../js/inventory.js");
const { getValue, setValue, _resetStorageForTesting } = await import("../js/storage.js");

function reset() {
  globalThis.localStorage.clear();
  _resetStorageForTesting();
  clearInventory();
}

test("add / remove round-trip through storage", () => {
  reset();
  addAmmo(7000, 3);
  assert.equal(getAmmo(7000), 3);
  assert.equal(getValue("player.0.inventory.amount.7000"), 3);
  assert.equal(removeAmmo(7000, 2), true);
  assert.equal(getAmmo(7000), 1);
  // An emptied slot is cleared, not stored as 0 — matches storage.js's
  // "null is unset, distinct from 0".
  assert.equal(removeAmmo(7000, 1), true);
  assert.equal(getValue("player.0.inventory.amount.7000"), null);
});

test("removeAmmo refuses to go negative", () => {
  reset();
  addAmmo(7000, 1);
  assert.equal(removeAmmo(7000, 5), false);
  assert.equal(getAmmo(7000), 1);
});

test("each player index owns its own pool", () => {
  reset();
  addAmmo(7000, 4, 0);
  addAmmo(7000, 1, 2);
  assert.equal(getAmmo(7000, 0), 4);
  assert.equal(getAmmo(7000, 1), 0);
  assert.equal(getAmmo(7000, 2), 1);
});

// Regression: the mirror was built by scanning localStorage once and never
// refreshed. Anything that wrote an inventory key through storage.js instead
// of addAmmo — the v2 migration fanning out the legacy blob, a restoreStorage,
// a cloud pull — left the mirror stale, and the next addAmmo wrote
// `stale + 1` back over it. Items the other writer had put there vanished.
test("a write from outside inventory.js is picked up, not overwritten", () => {
  reset();
  addAmmo(7000, 1);
  assert.equal(getAmmo(7000), 1);

  // Someone else (migration / save merge) lands 10 kunai in the same slot.
  setValue("player.0.inventory.amount.7000", 10);
  assert.equal(getAmmo(7000), 10, "the mirror must re-read after a foreign write");

  addAmmo(7000, 1);
  assert.equal(getAmmo(7000), 11, "add builds on the merged value, not the stale one");
  assert.equal(getValue("player.0.inventory.amount.7000"), 11);
});

test("a foreign write to a slot we've never touched is visible", () => {
  reset();
  addAmmo(7000, 1);           // hydrate the mirror
  setValue("player.0.inventory.amount.1176", 7);
  assert.equal(getAmmo(1176), 7);
  assert.deepEqual(snapshotInventory(0), { 1176: 7, 7000: 1 });
});

// Regression: setValue returns false when the disk write fails (quota, Safari
// private mode). The bucket had already been mutated, so the session showed
// items that never reached the save and were gone on the next load.
test("a failed persist rolls the in-memory count back", async (t) => {
  reset();
  addAmmo(7000, 5);

  const ls = globalThis.localStorage;
  const realSetItem = ls.setItem.bind(ls);
  ls.setItem = () => { throw new Error("QuotaExceededError"); };
  t.after(() => { ls.setItem = realSetItem; });

  addAmmo(7000, 3);
  assert.equal(getAmmo(7000), 5, "the failed add must not linger in memory");

  assert.equal(removeAmmo(7000, 2), false, "a failed remove reports failure");
  assert.equal(getAmmo(7000), 5, "the failed remove must not linger either");
});
