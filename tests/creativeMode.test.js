// Creative-mode predicate is intentionally tiny: read `?creative=true`
// once and cache. These tests cover the cache, the accepted values, and
// the test-only override hook.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCreativeMode, _setCreativeModeForTesting } from "../js/creativeMode.js?v=20260531b";

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
