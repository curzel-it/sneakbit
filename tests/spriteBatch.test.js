import { test } from "node:test";
import assert from "node:assert/strict";
import { clipBlit } from "../js/spriteBatch.js";
import { premultiplied8 } from "../js/darknessPass.js";
import { wantsCanvas2d } from "../js/renderer.js";

test("an in-bounds blit passes through unchanged", () => {
  assert.deepEqual(clipBlit(64, 64, 16, 16, 16, 32, 5, 7, 16, 32),
    { sx: 16, sy: 16, sw: 16, sh: 32, dx: 5, dy: 7, dw: 16, dh: 32 });
});

test("a source rect past the sheet edge is clipped, shrinking the destination", () => {
  assert.deepEqual(clipBlit(40, 40, 32, 0, 16, 16, 100, 0, 32, 32),
    { sx: 32, sy: 0, sw: 8, sh: 16, dx: 100, dy: 0, dw: 16, dh: 32 });
  assert.deepEqual(clipBlit(40, 40, -4, 0, 16, 16, 0, 0, 16, 16),
    { sx: 0, sy: 0, sw: 12, sh: 16, dx: 4, dy: 0, dw: 12, dh: 16 });
});

test("empty or fully outside blits draw nothing", () => {
  assert.equal(clipBlit(40, 40, 0, 0, 0, 16, 0, 0, 16, 16), null);
  assert.equal(clipBlit(40, 40, 48, 0, 16, 16, 0, 0, 16, 16), null);
});

test("the night wash rounds to Canvas 2D's 8-bit premultiplied colour", () => {
  const [r, g, b, a] = premultiplied8(15 / 255, 25 / 255, 70 / 255, 0.45);
  assert.deepEqual([r, g, b, a].map((c) => Math.round(c * 255)), [7, 11, 32, 115]);
});

test("?canvas selects the Canvas 2D renderer", () => {
  assert.equal(wantsCanvas2d("?canvas"), true);
  assert.equal(wantsCanvas2d("?coop=1&canvas"), true);
  assert.equal(wantsCanvas2d(""), false);
});
