import { test } from "node:test";
import assert from "node:assert/strict";
import { isEditor, editorEmails } from "../server/editors.js";

test("the hard-coded allowlist admits federico, case/whitespace-insensitively", () => {
  assert.equal(isEditor("federico@curzel.it"), true);
  assert.equal(isEditor("  Federico@Curzel.IT  "), true);
});

test("a random account is not an editor", () => {
  assert.equal(isEditor("someone@else.com"), false);
});

test("empty / null / undefined emails are never editors", () => {
  assert.equal(isEditor(""), false);
  assert.equal(isEditor("   "), false);
  assert.equal(isEditor(null), false);
  assert.equal(isEditor(undefined), false);
});

test("EDITOR_EMAILS extends the set without dropping the hard-coded default", () => {
  const env = { EDITOR_EMAILS: "a@b.com, C@D.com" };
  assert.equal(isEditor("a@b.com", env), true);
  assert.equal(isEditor("c@d.com", env), true);      // normalized
  assert.equal(isEditor("federico@curzel.it", env), true); // default still in
  assert.equal(isEditor("nope@x.com", env), false);
});

test("editorEmails returns the normalized membership set", () => {
  const set = editorEmails({ EDITOR_EMAILS: " X@Y.com " });
  assert.ok(set.has("federico@curzel.it"));
  assert.ok(set.has("x@y.com"));
});
