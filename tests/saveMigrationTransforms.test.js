// Save-migration data transforms (v2 inventory fan-out, v3 world→zone rename)
// plus the storage failure paths that used to silently drop saves. These run
// against a controllable fake localStorage so we can exercise a write that
// throws (quota / private mode) — the exact case that corrupted real saves.
//
// The fake must be installed BEFORE importing storage.js: that module probes
// localStorage once at load and caches the result. Each test file is its own
// node process, so this global doesn't leak into the other suites.

import { test } from "node:test";
import assert from "node:assert/strict";

function makeFakeLocalStorage() {
  const store = new Map();
  let failWrites = false;
  return {
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) {
      if (failWrites) throw new Error("QuotaExceededError");
      store.set(k, String(v));
    },
    removeItem(k) {
      if (failWrites) throw new Error("QuotaExceededError");
      store.delete(k);
    },
    _store: store,
    _failWrites(v) { failWrites = v; },
  };
}

const fakeLS = makeFakeLocalStorage();
globalThis.localStorage = fakeLS;

const { getValue, setValue, _resetStorageForTesting } =
  await import("../js/storage.js");
const { runMigrations, BUILD_NUMBER } = await import("../js/migrations.js");

const INVENTORY_KEY = "sneakbit.inventory.v1";
const PREFIX = "sneakbit.kv.v1.";

// Fresh disk + cache, writes healthy, for the start of each test.
function reset() {
  fakeLS._failWrites(false);
  fakeLS._store.clear();
  _resetStorageForTesting();
}

test("probe: a usable localStorage is detected (writes go to disk)", () => {
  reset();
  setValue("probe.key", 7);
  assert.equal(fakeLS._store.get(PREFIX + "probe.key"), "7");
  assert.equal(getValue("probe.key"), 7);
});

test("v2: inventory blob fans out into per-player keys, filtering junk", () => {
  reset();
  setValue("build_number", 1);
  // Realistic legacy blob: valid entries, a zero, a negative, a non-numeric
  // species id, and a fractional count — only the first two species survive,
  // and the fractional count truncates toward zero.
  fakeLS._store.set(INVENTORY_KEY, JSON.stringify({
    10: 3, 11: 5, 12: 0, 13: -2, bad: 7, 14: 2.9,
  }));

  const r = runMigrations();

  assert.equal(r.to, BUILD_NUMBER);
  assert.equal(getValue("player.0.inventory.amount.10"), 3);
  assert.equal(getValue("player.0.inventory.amount.11"), 5);
  assert.equal(getValue("player.0.inventory.amount.12"), null); // count <= 0 dropped
  assert.equal(getValue("player.0.inventory.amount.13"), null); // negative dropped
  assert.equal(getValue("player.0.inventory.amount.14"), 2);     // 2.9 | 0
  assert.equal(getValue("player.0.inventory.amount.NaN"), null); // non-numeric id dropped
  // Source blob removed only after the fan-out succeeded.
  assert.equal(fakeLS._store.has(INVENTORY_KEY), false);
});

test("v3: latest_world is copied to latest_zone then dropped", () => {
  reset();
  setValue("build_number", 2);
  setValue("latest_world", 42);

  const r = runMigrations();

  assert.equal(r.to, BUILD_NUMBER);
  assert.equal(getValue("latest_zone"), 42);
  assert.equal(getValue("latest_world"), null);
  assert.equal(fakeLS._store.has(PREFIX + "latest_world"), false);
});

test("v3 no-clobber: an existing latest_zone is not overwritten", () => {
  reset();
  setValue("build_number", 2);
  setValue("latest_world", 42);
  setValue("latest_zone", 99);

  runMigrations();

  assert.equal(getValue("latest_zone"), 99); // kept, not clobbered by the legacy value
  assert.equal(getValue("latest_world"), null);
});

test("v3 failure: a failed latest_zone write keeps latest_world and does NOT advance the build", () => {
  reset();
  setValue("build_number", 2);
  setValue("latest_world", 42);
  // Disk goes read-only right before the migration (quota / private mode).
  fakeLS._failWrites(true);

  const r = runMigrations();

  // The save is preserved on disk, the build number is not advanced, and the
  // copy will be retried on the next boot — instead of disk holding neither
  // key and the player silently losing their progress.
  assert.equal(r.applied, 0);
  assert.equal(r.to, 2);
  assert.equal(fakeLS._store.get(PREFIX + "latest_world"), "42");
  assert.equal(fakeLS._store.has(PREFIX + "latest_zone"), false);
  assert.equal(fakeLS._store.get(PREFIX + "build_number"), "2");
});

test("v2 failure: a failed inventory write keeps the legacy blob and stops the ladder", () => {
  reset();
  setValue("build_number", 1);
  fakeLS._store.set(INVENTORY_KEY, JSON.stringify({ 10: 3 }));
  fakeLS._failWrites(true);

  const r = runMigrations();

  assert.equal(r.applied, 0);
  assert.equal(r.to, 1);                          // ladder stopped at v2, never reached v3
  assert.equal(fakeLS._store.has(INVENTORY_KEY), true); // source blob preserved for retry
  assert.equal(fakeLS._store.get(PREFIX + "build_number"), "1");
});

test("storage: setValue returns false and leaves the cache unchanged when the disk write throws", () => {
  reset();
  assert.equal(setValue("k", 5), true);
  assert.equal(getValue("k"), 5);

  fakeLS._failWrites(true);
  assert.equal(setValue("k", 9), false); // write rejected
  assert.equal(getValue("k"), 5);        // cache still mirrors disk, not the unsaved 9
  assert.equal(fakeLS._store.get(PREFIX + "k"), "5");

  // Clearing a key whose disk removal fails likewise leaves the cache intact.
  assert.equal(setValue("k", null), false);
  assert.equal(getValue("k"), 5);
});

test("ladder is idempotent: replaying v2/v3 after a recovered failure converges", () => {
  reset();
  setValue("build_number", 1);
  fakeLS._store.set(INVENTORY_KEY, JSON.stringify({ 10: 3 }));
  setValue("latest_world", 42);

  // First boot: disk is read-only, everything stalls at v1.
  fakeLS._failWrites(true);
  const first = runMigrations();
  assert.equal(first.to, 1);

  // Disk recovers; next boot completes the whole ladder cleanly.
  fakeLS._failWrites(false);
  const second = runMigrations();
  assert.equal(second.to, BUILD_NUMBER);
  assert.equal(getValue("player.0.inventory.amount.10"), 3);
  assert.equal(getValue("latest_zone"), 42);
  assert.equal(getValue("latest_world"), null);
  assert.equal(fakeLS._store.has(INVENTORY_KEY), false);
});
