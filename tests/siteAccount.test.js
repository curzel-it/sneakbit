// Two pure-node concerns behind the website account UI:
//   1. accountSession.reloadSessionFromStorage — the cross-tab sync path. The
//      site (/) and game (/play/) share one localStorage key, so a sign-in/out
//      in one tab must surface in the other. No `window` in the node runner, so
//      we drive the reload directly instead of dispatching a storage event.
//   2. siteAccount.formatPurchase — the entitlement → label/date formatter.

import { test } from "node:test";
import assert from "node:assert/strict";

const KEY = "sneakbit.account.v1";

// Minimal localStorage stub, installed before importing the module under test
// (which reads localStorage lazily on first access).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

const {
  getToken, getUser, isSignedIn, onAccountChange,
  reloadSessionFromStorage, _resetAccountSessionForTesting,
} = await import("../js/accountSession.js");

const { formatPurchase } = await import("../js/siteAccount.js");

function writeSession(token, user) {
  store.set(KEY, JSON.stringify({ token, user }));
}

test("reloadSessionFromStorage adopts a session another tab wrote", () => {
  _resetAccountSessionForTesting();
  store.clear();
  assert.equal(isSignedIn(), false); // forces a load from the (empty) store

  const seen = [];
  onAccountChange((u) => seen.push(u));

  writeSession("t1", { id: "u1", email: "a@b.c", displayName: "Aya" });
  reloadSessionFromStorage();

  assert.equal(getToken(), "t1");
  assert.equal(getUser().displayName, "Aya");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].displayName, "Aya");
});

test("reloadSessionFromStorage signs out when another tab cleared the key", () => {
  _resetAccountSessionForTesting();
  store.clear();
  writeSession("t", { email: "x@y.z" });
  assert.equal(isSignedIn(), true); // loads the existing session

  const seen = [];
  onAccountChange((u) => seen.push(u));

  store.delete(KEY); // another tab signed out
  reloadSessionFromStorage();

  assert.equal(isSignedIn(), false);
  assert.equal(seen[0], null);
});

test("formatPurchase prettifies a refId", () => {
  assert.equal(formatPurchase({ refId: "outfit_red", kind: "skin" }).name, "Outfit Red");
});

test("formatPurchase strips the skin. prefix from the sku fallback", () => {
  assert.equal(formatPurchase({ sku: "skin.ninja_black" }).name, "Ninja Black");
});

test("formatPurchase falls back to Item for an empty entitlement", () => {
  assert.equal(formatPurchase({}).name, "Item");
});

test("formatPurchase formats a positive grantedAt and omits a zero one", () => {
  assert.notEqual(formatPurchase({ refId: "x", grantedAt: 1_700_000_000_000 }).when, "");
  assert.equal(formatPurchase({ refId: "x", grantedAt: 0 }).when, "");
});
