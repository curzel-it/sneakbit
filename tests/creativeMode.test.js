// Creative-mode predicate is intentionally tiny: it's local-only and reads
// `?creative=true` once, then caches. These tests cover the cache, the
// test-only override hook, and the local-origin gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCreativeMode, isLocalHost, _setCreativeModeForTesting } from "../js/creativeMode.js";

test("defaults to false in a non-browser test environment", () => {
  _setCreativeModeForTesting(false);
  assert.equal(isCreativeMode(), false);
});

test("override hook flips the cached value", () => {
  _setCreativeModeForTesting(true);
  assert.equal(isCreativeMode(), true);
  _setCreativeModeForTesting(false);
  assert.equal(isCreativeMode(), false);
});

test("isLocalHost recognises local origins and rejects deployed ones", () => {
  const at = (location) => {
    const saved = globalThis.location;
    globalThis.location = location;
    try { return isLocalHost(); } finally { globalThis.location = saved; }
  };
  assert.equal(at({ protocol: "http:", hostname: "localhost" }), true);
  assert.equal(at({ protocol: "http:", hostname: "127.0.0.1" }), true);
  assert.equal(at({ protocol: "file:", hostname: "" }), true);
  assert.equal(at({ protocol: "https:", hostname: "sneakbit.curzel.it" }), false);
});
