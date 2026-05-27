import { test } from "node:test";
import assert from "node:assert/strict";

const { _resetStorageForTesting, getValue, setValue } =
  await import("../js/storage.js?v=20260527");
const { runMigrations, BUILD_NUMBER } = await import("../js/migrations.js?v=20260527");

test("first-ever launch: stamps BUILD_NUMBER and reports applied=0", () => {
  _resetStorageForTesting();
  const r = runMigrations();
  assert.equal(r.applied, 0);
  assert.equal(r.from, null);
  assert.equal(r.to, BUILD_NUMBER);
  assert.equal(getValue("build_number"), BUILD_NUMBER);
});

test("idempotent: re-running on a stamped save is a no-op", () => {
  _resetStorageForTesting();
  setValue("build_number", BUILD_NUMBER);
  const r = runMigrations();
  assert.equal(r.applied, 0);
  assert.equal(r.from, BUILD_NUMBER);
});

test("save from an older build is brought up to current", () => {
  _resetStorageForTesting();
  setValue("build_number", BUILD_NUMBER > 0 ? BUILD_NUMBER - 1 : 0);
  const r = runMigrations();
  assert.equal(r.to, BUILD_NUMBER);
  assert.equal(getValue("build_number"), BUILD_NUMBER);
});
