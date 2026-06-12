// snapshotStorage/restoreStorage: the seam that lets the autoplay bot
// dry-run the route planner against a COPY of the live save. A round-trip
// must leave the kv namespace byte-for-byte unchanged — including clearing
// keys the dry-run added.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getValue, setValue, snapshotStorage, restoreStorage, _resetStorageForTesting,
} from "../js/storage.js";

test("restore undoes additions made after the snapshot", () => {
  _resetStorageForTesting();
  setValue("a", 1);
  setValue("b", 2);
  const snap = snapshotStorage();
  setValue("c", 3);          // added by the "dry-run"
  setValue("a", 99);         // mutated by the "dry-run"
  restoreStorage(snap);
  assert.equal(getValue("a"), 1);
  assert.equal(getValue("b"), 2);
  assert.equal(getValue("c"), null, "key added after the snapshot must be cleared");
});

test("restore reinstates a key the dry-run deleted", () => {
  _resetStorageForTesting();
  setValue("keep", 5);
  const snap = snapshotStorage();
  setValue("keep", null);    // deleted during the dry-run
  assert.equal(getValue("keep"), null);
  restoreStorage(snap);
  assert.equal(getValue("keep"), 5);
});

test("snapshot is an independent copy", () => {
  _resetStorageForTesting();
  setValue("x", 7);
  const snap = snapshotStorage();
  setValue("x", 8);
  assert.equal(snap.x, 7, "snapshot object must not track later writes");
});
