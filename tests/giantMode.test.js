// Giant mode is a timed, playerId-keyed cosmetic flag. These tests pin the
// state machine that drawPlayer queries: arming, lazy expiry, and — the
// load-bearing property — that two avatars sharing local index 0 (the host
// and a guest's own self, on a guest) never collide because keying is by
// playerId, not index.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  isGiant,
  isGiantIndex,
  triggerGiant,
  getGiantRemainingMs,
  onGiantChange,
  GIANT_DURATION_MS,
  _clearGiantsForTesting,
  _armForTesting,
} = await import("../js/giantMode.js");

test("triggerGiant arms the local self (offline) and gates re-use", () => {
  _clearGiantsForTesting();
  assert.equal(isGiantIndex(0), false);
  triggerGiant(0); // offline: no playerId → keyed local:0, no wire traffic
  assert.equal(isGiantIndex(0), true);
  // The render-path query agrees for the matching local player object.
  assert.equal(isGiant({ index: 0 }), true);
  assert.equal(GIANT_DURATION_MS > 0, true);
});

test("a lapsed timer reads as not-giant and is dropped", () => {
  _clearGiantsForTesting();
  _armForTesting("p1", -10); // endsAt already in the past
  assert.equal(isGiant({ playerId: "p1" }), false);
  _armForTesting("p2", 5000);
  assert.equal(isGiant({ playerId: "p2" }), true);
});

test("playerId keying keeps two index-0 avatars independent", () => {
  _clearGiantsForTesting();
  _armForTesting("host-id", 5000); // host avatar is giant
  // Both the host avatar and a guest's own self render at local index 0, yet
  // only the one whose playerId matches is giant.
  assert.equal(isGiant({ index: 0, playerId: "host-id" }), true);
  assert.equal(isGiant({ index: 0, playerId: "guest-id" }), false);
});

test("local co-op partners (index > 0) key independently without a playerId", () => {
  _clearGiantsForTesting();
  triggerGiant(1); // local:1
  assert.equal(isGiantIndex(1), true);
  assert.equal(isGiantIndex(0), false);
  assert.equal(isGiant({ index: 1 }), true);
  assert.equal(isGiant({ index: 0 }), false);
});

test("getGiantRemainingMs reports the countdown and clamps a lapsed timer to 0", () => {
  _clearGiantsForTesting();
  // Never armed → 0.
  assert.equal(getGiantRemainingMs(0), 0);
  triggerGiant(0);
  const remaining = getGiantRemainingMs(0);
  // Fresh arm: ~full duration (allow a few ms of clock drift during the call).
  assert.equal(remaining > GIANT_DURATION_MS - 1000 && remaining <= GIANT_DURATION_MS, true);
  // A timer in the past reads as 0, never negative.
  _clearGiantsForTesting();
  _armForTesting("local:0", -10);
  assert.equal(getGiantRemainingMs(0), 0);
});

test("onGiantChange fires on arm and stops after unsubscribe", () => {
  _clearGiantsForTesting();
  let count = 0;
  const off = onGiantChange(() => { count++; });
  triggerGiant(0);
  assert.equal(count, 1);
  off();
  triggerGiant(0);
  assert.equal(count, 1); // no further notifications after unsubscribe
});
