// Speed mode is a timed, index-keyed local movement buff. These tests pin the
// state machine player.stepDuration queries: arming, lazy expiry, the
// multiplier it exposes, and per-index independence for local co-op.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  speedMultiplier,
  isSpeedActiveIndex,
  triggerSpeed,
  getSpeedRemainingMs,
  SPEED_DURATION_MS,
  SPEED_MULTIPLIER,
  _clearSpeedForTesting,
  _armForTesting,
} = await import("../js/speedMode.js");

test("triggerSpeed arms the local self and exposes the multiplier", () => {
  _clearSpeedForTesting();
  assert.equal(isSpeedActiveIndex(0), false);
  assert.equal(speedMultiplier({ index: 0 }), 1);
  triggerSpeed(0);
  assert.equal(isSpeedActiveIndex(0), true);
  assert.equal(speedMultiplier({ index: 0 }), SPEED_MULTIPLIER);
  assert.ok(getSpeedRemainingMs(0) > 0 && getSpeedRemainingMs(0) <= SPEED_DURATION_MS);
});

test("a lapsed timer reads as inactive (multiplier 1) and is dropped", () => {
  _clearSpeedForTesting();
  _armForTesting(0, -10); // endsAt already in the past
  assert.equal(isSpeedActiveIndex(0), false);
  assert.equal(speedMultiplier({ index: 0 }), 1);
  assert.equal(getSpeedRemainingMs(0), 0);
});

test("index keying keeps local co-op players independent", () => {
  _clearSpeedForTesting();
  triggerSpeed(1); // only the partner is buffed
  assert.equal(speedMultiplier({ index: 1 }), SPEED_MULTIPLIER);
  assert.equal(speedMultiplier({ index: 0 }), 1);
});

test("an unknown / undefined player is never buffed", () => {
  _clearSpeedForTesting();
  assert.equal(speedMultiplier(undefined), 1);
  assert.equal(speedMultiplier({ index: 5 }), 1);
});
