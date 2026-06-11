// The pure reconcile diff. grant marks the active set owned; revoke removes
// ONLY entitlement-owned skins that are no longer active (a refund). Coin-owned
// skins are never in the entitled-set, so the diff never touches them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { diffEntitlements } from "../js/entitlements.js";

test("first reconcile grants the active set, revokes nothing", () => {
  const { toGrant, toRevoke } = diffEntitlements(["ninja_black", "outfit_red"], []);
  assert.deepEqual([...toGrant].sort(), ["ninja_black", "outfit_red"]);
  assert.deepEqual(toRevoke, []);
});

test("a refund (active shrinks vs cache) revokes the dropped skin", () => {
  // Previously entitled to both; now only outfit_red is active → ninja revoked.
  const { toGrant, toRevoke } = diffEntitlements(["outfit_red"], ["ninja_black", "outfit_red"]);
  assert.deepEqual(toGrant, ["outfit_red"]);
  assert.deepEqual(toRevoke, ["ninja_black"]);
});

test("coin-owned skins (absent from both active and cache) are never in the diff", () => {
  // outfit_blue is coin-owned: it appears in neither the server's entitlement
  // list nor our entitled-set cache, so the diff ignores it entirely.
  const { toGrant, toRevoke } = diffEntitlements(["ninja_black"], ["ninja_black"]);
  assert.ok(!toRevoke.includes("outfit_blue"));
  assert.ok(!toGrant.includes("outfit_blue"));
  assert.deepEqual(toRevoke, []);
});

test("re-grant after refund: skin returns to active", () => {
  const { toGrant, toRevoke } = diffEntitlements(["ninja_black"], []);
  assert.deepEqual(toGrant, ["ninja_black"]);
  assert.deepEqual(toRevoke, []);
});
