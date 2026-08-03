// Lock primitives: the lock ↔ key species mapping and the key-species set
// that drives the pickup fanfare (pickups.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCK_YELLOW, LOCK_RED, LOCK_GREEN, LOCK_BLUE, LOCK_SILVER, LOCK_NONE,
  keySpeciesIdForLock, isKeySpecies,
} from "../js/locks.js";

test("each coloured lock maps to its key species", () => {
  assert.equal(keySpeciesIdForLock(LOCK_YELLOW), 2000);
  assert.equal(keySpeciesIdForLock(LOCK_RED), 2001);
  assert.equal(keySpeciesIdForLock(LOCK_GREEN), 2002);
  assert.equal(keySpeciesIdForLock(LOCK_BLUE), 2003);
  assert.equal(keySpeciesIdForLock(LOCK_SILVER), 2004);
  assert.equal(keySpeciesIdForLock(LOCK_NONE), null);
});

test("isKeySpecies covers every key, including the lock-less white key", () => {
  for (const id of [2000, 2001, 2002, 2003, 2004, 2005]) {
    assert.ok(isKeySpecies(id), `${id} is a key`);
  }
  // The white key opens no coloured lock, so keySpeciesIdForLock can't find
  // it — the fanfare must not depend on that mapping.
  const mapped = [LOCK_YELLOW, LOCK_RED, LOCK_GREEN, LOCK_BLUE, LOCK_SILVER]
    .map(keySpeciesIdForLock);
  assert.ok(!mapped.includes(2005));
});

test("isKeySpecies rejects coins and other pickups", () => {
  assert.ok(!isKeySpecies(2010)); // coin
  assert.ok(!isKeySpecies(2020)); // health potion
  assert.ok(!isKeySpecies(7000)); // kunai
  assert.ok(!isKeySpecies(undefined));
});
