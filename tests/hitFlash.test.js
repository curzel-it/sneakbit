import { test } from "node:test";
import assert from "node:assert/strict";
import { markHit, tickHitFlashes, hitFlashAmount } from "../js/hitFlash.js";

test("a hit entity flashes white until the flash ages out", () => {
  const e = {};
  const zone = { entities: [e] };
  assert.equal(hitFlashAmount(e), 0);
  markHit(e);
  assert.equal(hitFlashAmount(e), 1);
  tickHitFlashes(zone, 0.05);
  assert.equal(hitFlashAmount(e), 1);
  tickHitFlashes(zone, 0.1);
  assert.equal(hitFlashAmount(e), 0);
});

test("hitFlashAmount tolerates a missing entity", () => {
  assert.equal(hitFlashAmount(undefined), 0);
});
