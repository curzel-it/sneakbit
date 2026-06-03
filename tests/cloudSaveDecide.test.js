// Unit tests for the pure cloud-save conflict decision. This is the heart of
// "newest-wins" resolution, isolated from the DOM/network so every branch
// (including true conflicts) is exercised deterministically.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSync } from "../js/cloudSave.js";

const localProgress = { hash: "LOCAL", hasProgress: true };

test("no cloud + local progress → seed", () => {
  assert.equal(decideSync({ cloud: null, local: localProgress, meta: {} }), "seed");
});

test("no cloud + no local progress → noop", () => {
  assert.equal(decideSync({ cloud: null, local: { hash: "x", hasProgress: false }, meta: {} }), "noop");
});

test("cloud hash equals local → insync", () => {
  const cloud = { rev: 3, updatedAt: 100, hash: "SAME" };
  assert.equal(decideSync({ cloud, local: { hash: "SAME", hasProgress: true }, meta: { rev: 3, lastHash: "SAME" } }), "insync");
});

test("local untouched since last sync, cloud advanced → pull", () => {
  // local.hash === meta.lastHash (no local change) but cloud differs.
  const cloud = { rev: 5, updatedAt: 200, hash: "CLOUDNEW" };
  const meta = { rev: 4, lastHash: "LOCAL", localUpdatedAt: 50 };
  assert.equal(decideSync({ cloud, local: localProgress, meta }), "pull");
});

test("local changed, cloud NOT advanced → push (we're ahead)", () => {
  const cloud = { rev: 4, updatedAt: 200, hash: "OLD" };
  const meta = { rev: 4, lastHash: "OLDLOCAL", localUpdatedAt: 300 };
  assert.equal(decideSync({ cloud, local: localProgress, meta }), "push");
});

test("first sign-in, local is a fresh-boot default → pull (adopt the account)", () => {
  // A brand-new device (meaningful:false) signing into an existing account
  // adopts the cloud — the common new-device case (the e2e's device B). The
  // content-aware `meaningful` flag is what lets us keep this branch automatic
  // while still catching genuine offline progress below.
  const cloud = { rev: 7, updatedAt: 999, hash: "CLOUD" };
  const meta = {}; // rev == null → never synced here
  const local = { hash: "LOCAL", hasProgress: true, meaningful: false };
  assert.equal(decideSync({ cloud, local, meta }), "pull");
});

test("first sign-in, local has genuine progress diverging from cloud → conflict", () => {
  // The open-P2 case: this device made real offline progress (meaningful:true)
  // before ever syncing, and the account already holds a different save. We
  // can't auto-pick a winner without risking data loss — surface a conflict so
  // the caller asks the player instead of silently clobbering either side.
  const cloud = { rev: 7, updatedAt: 999, hash: "CLOUD" };
  const meta = {}; // rev == null → never synced here
  const local = { hash: "LOCAL", hasProgress: true, meaningful: true };
  assert.equal(decideSync({ cloud, local, meta }), "conflict");
});

test("true conflict, local newer → push", () => {
  const cloud = { rev: 9, updatedAt: 1000, hash: "CLOUD" };
  const meta = { rev: 4, lastHash: "BASELINE", localUpdatedAt: 2000 }; // local changed after cloud
  assert.equal(decideSync({ cloud, local: localProgress, meta }), "push");
});

test("true conflict, cloud newer → pull", () => {
  const cloud = { rev: 9, updatedAt: 5000, hash: "CLOUD" };
  const meta = { rev: 4, lastHash: "BASELINE", localUpdatedAt: 2000 }; // cloud changed after local
  assert.equal(decideSync({ cloud, local: localProgress, meta }), "pull");
});
