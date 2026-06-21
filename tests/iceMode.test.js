// Ice mode is a timed combat buff that drives the player's frost aura and the
// _icy tagging of fired bullets. These tests pin the buff state machine the
// renderer/consumable query: arming, lazy expiry, the per-player keying, and
// the onIceChange notification.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  isIceActive,
  isIceActiveIndex,
  triggerIce,
  getIceRemainingMs,
  onIceChange,
  ICE_DURATION_MS,
  _clearIceForTesting,
  _armForTesting,
} = await import("../js/iceMode.js");

test("triggerIce arms the local self and is queryable by index and player", () => {
  _clearIceForTesting();
  assert.equal(isIceActiveIndex(0), false);
  assert.equal(isIceActive({ index: 0 }), false);
  triggerIce(0);
  assert.equal(isIceActiveIndex(0), true);
  assert.equal(isIceActive({ index: 0 }), true);
  assert.ok(getIceRemainingMs(0) > 0 && getIceRemainingMs(0) <= ICE_DURATION_MS);
});

test("a lapsed timer reads as inactive and is dropped", () => {
  _clearIceForTesting();
  _armForTesting("local:0", -10); // endsAt already in the past
  assert.equal(isIceActiveIndex(0), false);
  assert.equal(getIceRemainingMs(0), 0);
});

test("an avatar is keyed by playerId when present (mirrored peers stay independent)", () => {
  _clearIceForTesting();
  _armForTesting("peer-xyz", ICE_DURATION_MS);
  assert.equal(isIceActive({ playerId: "peer-xyz", index: 0 }), true);
  assert.equal(isIceActive({ index: 0 }), false); // local self, no playerId armed
});

test("an unknown / undefined player is never buffed", () => {
  _clearIceForTesting();
  assert.equal(isIceActive(undefined), false);
  assert.equal(isIceActive({ index: 5 }), false);
});

test("onIceChange fires when the buff is armed", () => {
  _clearIceForTesting();
  let fired = 0;
  const off = onIceChange(() => { fired++; });
  triggerIce(0);
  assert.ok(fired >= 1);
  off();
});
