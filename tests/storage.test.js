// Generic key/value storage + Rust-equivalent matching rule for dialogue
// conditionals. No DOM, no localStorage in node — the module degrades to
// an in-memory cache automatically.

import { test } from "node:test";
import assert from "node:assert/strict";

const { getValue, setValue, keyMatches, _resetStorageForTesting } =
  await import("../js/storage.js");

test("keyMatches: 'always' matches anything", () => {
  _resetStorageForTesting();
  assert.equal(keyMatches("always", 0), true);
  assert.equal(keyMatches("always", 99), true);
});

test("keyMatches: stored value must equal expected", () => {
  _resetStorageForTesting();
  setValue("quest.intro", 3);
  assert.equal(keyMatches("quest.intro", 3), true);
  assert.equal(keyMatches("quest.intro", 2), false);
});

test("keyMatches: expected=0 matches an unset key", () => {
  _resetStorageForTesting();
  assert.equal(keyMatches("never.set", 0), true);
  assert.equal(keyMatches("never.set", 1), false);
});

test("keyMatches: explicit zero is distinct from unset for non-zero expected", () => {
  _resetStorageForTesting();
  setValue("zero.set", 0);
  assert.equal(keyMatches("zero.set", 0), true);
  assert.equal(keyMatches("zero.set", 1), false);
});

test("getValue / setValue roundtrip + clear", () => {
  _resetStorageForTesting();
  assert.equal(getValue("a"), null);
  setValue("a", 7);
  assert.equal(getValue("a"), 7);
  setValue("a", null);
  assert.equal(getValue("a"), null);
});

test("falsy key behaves like 'always'", () => {
  _resetStorageForTesting();
  assert.equal(keyMatches("", 5), true);
  assert.equal(keyMatches(undefined, 5), true);
});

// Comma-joined keys are a multi-condition gate, ported from Rust
// storage.rs::get_value_for_global_key: getValue returns the value shared by
// ALL sub-keys, or null when they disagree. With keyMatches this is AND — the
// gate holds only when every sub-key equals the expected value. Dialogue data
// relies on this (e.g. "asked about both ninjas", "quest started AND item
// collected"); before the port these lines were dead and their branch
// unreachable.
test("getValue: comma key returns the value shared by all sub-keys", () => {
  _resetStorageForTesting();
  assert.equal(getValue("a,b"), null); // both unset → no common value vs the rest
  setValue("a", 1);
  assert.equal(getValue("a,b"), null); // a=1, b unset → disagree → null
  setValue("b", 1);
  assert.equal(getValue("a,b"), 1);    // both 1 → shared value 1
  setValue("b", 2);
  assert.equal(getValue("a,b"), null); // 1 vs 2 → disagree → null
});

test("keyMatches: comma key is AND across sub-keys", () => {
  _resetStorageForTesting();
  assert.equal(keyMatches("a,b", 1), false); // neither set
  setValue("a", 1);
  assert.equal(keyMatches("a,b", 1), false); // only one set
  setValue("b", 1);
  assert.equal(keyMatches("a,b", 1), true);  // both set
});

// Inventory counts are stored per-player as `player.<p>.inventory.amount.<sid>`.
// A bare `inventory.amount.<sid>` gate is player-agnostic and resolves to the
// first local player who holds the item — ported from Rust
// storage.rs::get_value_for_global_key. Without it the bare form (used by
// several lore/quest gates) never matched.
test("getValue: bare inventory.amount resolves across player slots", () => {
  _resetStorageForTesting();
  assert.equal(getValue("inventory.amount.2005"), null); // nobody holds it
  setValue("player.0.inventory.amount.2005", 2);
  assert.equal(getValue("inventory.amount.2005"), 2);
});

test("getValue: bare inventory.amount finds a co-op partner's item", () => {
  _resetStorageForTesting();
  setValue("player.1.inventory.amount.2005", 1); // only player 2 holds it
  assert.equal(keyMatches("inventory.amount.2005", 1), true);
});

test("getValue: explicit player.N.inventory.amount reads that slot directly", () => {
  _resetStorageForTesting();
  setValue("player.0.inventory.amount.2005", 3);
  assert.equal(getValue("player.0.inventory.amount.2005"), 3);
  assert.equal(keyMatches("player.0.inventory.amount.2005", 3), true);
});
