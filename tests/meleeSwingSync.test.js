// Bug #2 (guest sword swing) lives or dies on the melee cooldown state
// machine that drives getMeleeSwingProgress. The host ships sw/swd in
// snapshots and the guest replays them through setSwingAnimation, then
// decays them with tickMelee — none of which the guest used to do. These
// tests pin that machine so the swing animates and, crucially, FINISHES.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setSwingAnimation,
  getMeleeCooldown,
  getMeleeSwingProgress,
  tickMelee,
} from "../js/melee.js";

// Drain every player's cooldown to 0 → all idle. (setSwingAnimation is not
// a reset: a 0 duration means "use the default cooldown", which arms it.)
function clearAll() { tickMelee(10_000); }

// melee stores cooldowns in a Float32Array, so 0.35 round-trips as
// 0.34999…; compare with a tolerance rather than strict equality.
function near(a, b, eps = 1e-4) { return Math.abs(a - b) < eps; }

test("setSwingAnimation arms the cooldown and progress starts at 1.0", () => {
  clearAll();
  setSwingAnimation(0, 0.35, 0.35);
  const { cd, dur } = getMeleeCooldown(0);
  assert.ok(near(cd, 0.35) && near(dur, 0.35), `got cd=${cd} dur=${dur}`);
  assert.equal(getMeleeSwingProgress(0), 1);
});

test("tickMelee decays the swing toward 0 and then ends it (null)", () => {
  clearAll();
  setSwingAnimation(0, 0.35, 0.35);
  tickMelee(0.175);
  const mid = getMeleeSwingProgress(0);
  assert.ok(mid > 0.4 && mid < 0.6, `expected ~0.5 mid-swing, got ${mid}`);
  tickMelee(0.35); // overshoot — cooldown floors at 0
  assert.equal(getMeleeSwingProgress(0), null, "swing must finish, not freeze");
  assert.equal(getMeleeCooldown(0).cd, 0);
});

test("a fresh snapshot mid-swing re-syncs the guest to the host's remaining", () => {
  clearAll();
  setSwingAnimation(1, 0.35, 0.35);
  tickMelee(0.30); // guest is near the end locally...
  setSwingAnimation(1, 0.20, 0.35); // ...but host says 0.20 left — re-sync up
  const p = getMeleeSwingProgress(1);
  assert.ok(p > 0.5 && p <= 0.6, `expected ~0.57 after resync, got ${p}`);
});

test("remaining is clamped to the duration; out-of-range is a no-op", () => {
  clearAll();
  setSwingAnimation(2, 999, 0.35); // remaining can't exceed duration
  assert.ok(near(getMeleeCooldown(2).cd, 0.35), `got ${getMeleeCooldown(2).cd}`);
  setSwingAnimation(-1, 0.35, 0.35); // out of range — ignored
  setSwingAnimation(99, 0.35, 0.35); // out of range — ignored
  assert.equal(getMeleeSwingProgress(99), null);
});

test("per-player indices are independent (self vs remote don't collide)", () => {
  clearAll();
  setSwingAnimation(3, 0.35, 0.35);
  assert.equal(getMeleeSwingProgress(0), null, "player 0 must stay idle");
  assert.equal(getMeleeSwingProgress(3), 1);
});
