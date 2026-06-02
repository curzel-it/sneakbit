import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeId, getEdited, putEdited, deleteEdited, listEdited } from "../server/editingStore.js";

// Each test gets an isolated tmp dir injected via EDITING_DIR.
function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "editing-test-"));
  const env = { EDITING_DIR: dir };
  try { fn(env); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("safeId accepts integer zone ids (including negative interiors)", () => {
  assert.equal(safeId(1010), "1010");
  assert.equal(safeId("-5"), "-5");
});

test("safeId rejects path traversal and non-numeric ids", () => {
  for (const bad of ["../etc/passwd", "1/2", "1.5", "a", "1010 ", "", "1;2"]) {
    assert.throws(() => safeId(bad), (e) => e.code === "BAD_ID", `expected BAD_ID for ${JSON.stringify(bad)}`);
  }
});

test("get is null when absent, then put → get round-trips the raw zone", () => {
  withDir((env) => {
    assert.equal(getEdited("1010", env), null);
    const raw = { id: 1010, biome: "x", entities: [{ id: -1 }] };
    putEdited("1010", raw, env);
    assert.deepEqual(getEdited("1010", env), raw);
  });
});

test("delete removes the stored world", () => {
  withDir((env) => {
    putEdited("42", { id: 42 }, env);
    assert.ok(getEdited("42", env));
    deleteEdited("42", env);
    assert.equal(getEdited("42", env), null);
    // Deleting a missing file is a no-op, not a throw.
    assert.doesNotThrow(() => deleteEdited("42", env));
  });
});

test("listEdited returns the stored ids (and [] for a missing dir)", () => {
  withDir((env) => {
    assert.deepEqual(listEdited(env), []);
    putEdited("1010", { id: 1010 }, env);
    putEdited("-3", { id: -3 }, env);
    assert.deepEqual(new Set(listEdited(env)), new Set(["1010", "-3"]));
  });
  // A never-created dir lists empty rather than throwing.
  assert.deepEqual(listEdited({ EDITING_DIR: join(tmpdir(), "definitely-not-here-xyz") }), []);
});
