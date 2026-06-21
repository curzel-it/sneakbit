// Freeze is the short per-monster status applied by ice-buffed bullets. These
// tests pin the footprint→overlay mapping (which decides who can be frozen at
// all), freezeEntity's immunity for odd sizes, and isFrozen's lazy expiry.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  freezeEntity,
  isFrozen,
  freezeOverlayId,
  FREEZE_DURATION_MS,
} = await import("../js/freeze.js");

test("freezeOverlayId maps the four authored footprints", () => {
  assert.equal(freezeOverlayId({ width: 1, height: 1 }), 260621201);
  assert.equal(freezeOverlayId({ width: 1, height: 2 }), 260621202);
  assert.equal(freezeOverlayId({ width: 2, height: 2 }), 260621203);
  assert.equal(freezeOverlayId({ width: 2, height: 4 }), 260621204);
});

test("freezeOverlayId falls back to the frame footprint when species lacks size", () => {
  assert.equal(freezeOverlayId({}, { w: 1, h: 2 }), 260621202);
});

test("an unsupported footprint has no overlay (immune)", () => {
  assert.equal(freezeOverlayId({ width: 3, height: 3 }), null);
  assert.equal(freezeOverlayId({ width: 2, height: 1 }), null);
});

test("freezeEntity freezes a supported monster and isFrozen reads true", () => {
  const e = { frame: { x: 0, y: 0, w: 1, h: 2 } };
  freezeEntity(e, { width: 1, height: 2 });
  assert.equal(isFrozen(e), true);
  assert.ok(e._frozenUntil > Date.now());
});

test("freezeEntity is a no-op for an immune footprint", () => {
  const e = { frame: { x: 0, y: 0, w: 3, h: 3 } };
  freezeEntity(e, { width: 3, height: 3 });
  assert.equal(e._frozenUntil, undefined);
  assert.equal(isFrozen(e), false);
});

test("a lapsed timer reads as no longer frozen", () => {
  const e = { frame: { w: 1, h: 1 }, _frozenUntil: Date.now() - 1 };
  assert.equal(isFrozen(e), false);
});

test("the mirrored `frozen` boolean (guest path) reads as frozen without a timestamp", () => {
  assert.equal(isFrozen({ frozen: true }), true);
  assert.equal(isFrozen({ frozen: false }), false);
});

test("FREEZE_DURATION_MS is the 0.25s beat", () => {
  assert.equal(FREEZE_DURATION_MS, 250);
});
