import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveMode, _setOnlineModeForTesting, _resetOnlineModeForTesting,
  getMode, getJoinCode, getStorageNamespace, getOnlineUuid } =
  await import("../js/onlineMode.js?v=20260527");

test("resolveMode: no params -> offline", () => {
  assert.deepEqual(resolveMode(""), { mode: "offline", code: null });
  assert.deepEqual(resolveMode("?foo=bar"), { mode: "offline", code: null });
});

test("resolveMode: ?host=1 -> host", () => {
  assert.deepEqual(resolveMode("?host=1"), { mode: "host", code: null });
});

test("resolveMode: ?host=0 is offline (explicit off)", () => {
  assert.deepEqual(resolveMode("?host=0"), { mode: "offline", code: null });
});

test("resolveMode: ?join=ABC12 -> guest, uppercased", () => {
  assert.deepEqual(resolveMode("?join=abc12"), { mode: "guest", code: "ABC12" });
  assert.deepEqual(resolveMode("?join=K7MJ2"), { mode: "guest", code: "K7MJ2" });
});

test("resolveMode: ?join= (empty) -> guest with null code", () => {
  assert.deepEqual(resolveMode("?join="), { mode: "guest", code: null });
});

test("getMode honors test seam", () => {
  _resetOnlineModeForTesting();
  _setOnlineModeForTesting({ mode: "host", code: null });
  assert.equal(getMode(), "host");
  assert.equal(getStorageNamespace(), "host");
  _resetOnlineModeForTesting();
  _setOnlineModeForTesting({ mode: "guest", code: "ABC12" });
  assert.equal(getMode(), "guest");
  assert.equal(getJoinCode(), "ABC12");
  assert.equal(getStorageNamespace(), "guest");
  _resetOnlineModeForTesting();
  _setOnlineModeForTesting({ mode: "offline" });
  assert.equal(getStorageNamespace(), "");
  _resetOnlineModeForTesting();
});

test("getOnlineUuid generates a stable v4-shaped string", () => {
  _resetOnlineModeForTesting();
  const a = getOnlineUuid();
  const b = getOnlineUuid();
  assert.equal(a, b);
  // Either a real UUID v4 (8-4-4-4-12 hex) or a polyfilled one — both fit:
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  _resetOnlineModeForTesting();
});
