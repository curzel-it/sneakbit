// Unit tests for the progress-blob serializer. Runs against a minimal
// localStorage shim so it stays pure Node. Verifies the blob captures exactly
// the account-scoped keys (kv + bindings + language) and that applying it
// merges language without disturbing per-device settings (volume).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeLocalStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    _map: m,
  };
}

globalThis.localStorage = makeLocalStorage();
const { serializeBlob, applyBlob, hasLocalProgress } = await import("../js/saveBlob.js");

beforeEach(() => { globalThis.localStorage.clear(); });

test("serialize captures kv + bindings + language, excludes per-device/identity keys", () => {
  const ls = globalThis.localStorage;
  ls.setItem("sneakbit.kv.v1.latest_zone", "1010");
  ls.setItem("sneakbit.kv.v1.player.0.inventory.amount.1001", "7");
  ls.setItem("sneakbit.keyBindings.v2", JSON.stringify({ p1: { shoot: ["KeyF", ""] } }));
  ls.setItem("sneakbit.gamepadBindings.v1", JSON.stringify({ p1: { shoot: 1 } }));
  ls.setItem("sneakbit.settings.v1", JSON.stringify({ sfxVolume: 0.9, language: "it" }));
  // Excluded:
  ls.setItem("sneakbit.online.uuid", "abc");
  ls.setItem("sneakbit.account.v1", JSON.stringify({ token: "t" }));

  const blob = serializeBlob();
  assert.equal(blob.kv["latest_zone"], "1010");
  assert.equal(blob.kv["player.0.inventory.amount.1001"], "7");
  assert.ok(blob.bindings["keyBindings.v2"]);
  assert.ok(blob.bindings["gamepadBindings.v1"]);
  assert.equal(blob.language, "it");
  // No identity / per-device leakage.
  assert.ok(!JSON.stringify(blob).includes("online.uuid"));
  assert.ok(!JSON.stringify(blob).includes("token"));
  assert.equal(blob.kv["online.uuid"], undefined);
});

test("apply writes kv + bindings and MERGES language, preserving local volume", () => {
  const ls = globalThis.localStorage;
  // Pre-existing per-device settings on this machine.
  ls.setItem("sneakbit.settings.v1", JSON.stringify({ sfxVolume: 0.3, musicVolume: 0.1, language: "en" }));
  ls.setItem("sneakbit.kv.v1.stale", "should_be_dropped");

  applyBlob({
    v: 1,
    kv: { latest_zone: "2020", "skill.x": "1" },
    bindings: { "keyBindings.v2": JSON.stringify({ p1: { melee: ["KeyG", ""] } }) },
    language: "it",
  });

  // kv replaced wholesale.
  assert.equal(ls.getItem("sneakbit.kv.v1.latest_zone"), "2020");
  assert.equal(ls.getItem("sneakbit.kv.v1.skill.x"), "1");
  assert.equal(ls.getItem("sneakbit.kv.v1.stale"), null);
  // bindings applied.
  assert.ok(ls.getItem("sneakbit.keyBindings.v2").includes("melee"));
  // language merged; volume untouched.
  const settings = JSON.parse(ls.getItem("sneakbit.settings.v1"));
  assert.equal(settings.language, "it");
  assert.equal(settings.sfxVolume, 0.3);
  assert.equal(settings.musicVolume, 0.1);
});

test("round-trip serialize → apply reproduces kv", () => {
  const ls = globalThis.localStorage;
  ls.setItem("sneakbit.kv.v1.latest_zone", "1234");
  ls.setItem("sneakbit.kv.v1.dialogue.answer.foo", "1");
  const blob = serializeBlob();
  ls.clear();
  applyBlob(blob);
  assert.equal(ls.getItem("sneakbit.kv.v1.latest_zone"), "1234");
  assert.equal(ls.getItem("sneakbit.kv.v1.dialogue.answer.foo"), "1");
});

test("apply rolls back kv on a mid-write quota throw (old progress survives)", () => {
  const ls = globalThis.localStorage;
  // Existing real progress on this device.
  ls.setItem("sneakbit.kv.v1.latest_zone", "1010");
  ls.setItem("sneakbit.kv.v1.skill.a", "1");

  // Make the 2nd new-key write throw (quota), simulating a partial write.
  const realSet = ls.setItem.bind(ls);
  let writes = 0;
  ls.setItem = (k, v) => {
    if (k.startsWith("sneakbit.kv.v1.") && ++writes === 2) throw new Error("QuotaExceeded");
    return realSet(k, v);
  };
  try {
    applyBlob({ v: 1, kv: { latest_zone: "2020", "skill.b": "9", "skill.c": "9" } });
  } finally {
    ls.setItem = realSet;
  }

  // The pull failed, but the old progress must be intact — not wiped/half-written.
  assert.equal(ls.getItem("sneakbit.kv.v1.latest_zone"), "1010", "old zone restored");
  assert.equal(ls.getItem("sneakbit.kv.v1.skill.a"), "1", "old skill restored");
  // No partial new keys left behind.
  assert.equal(ls.getItem("sneakbit.kv.v1.skill.b"), null, "partial new key rolled back");
  assert.equal(ls.getItem("sneakbit.kv.v1.skill.c"), null, "unwritten new key absent");
});

test("hasLocalProgress reflects a saved zone", () => {
  assert.equal(hasLocalProgress(), false);
  globalThis.localStorage.setItem("sneakbit.kv.v1.latest_zone", "1");
  assert.equal(hasLocalProgress(), true);
});
