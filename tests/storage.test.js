// Generic key/value storage + Rust-equivalent matching rule for dialogue
// conditionals. No DOM, no localStorage in node — the module degrades to
// an in-memory cache automatically.

import { test } from "node:test";
import assert from "node:assert/strict";

const { getValue, setValue, keyMatches, _resetStorageForTesting } =
  await import("../js/storage.js?v=20260528d");

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
