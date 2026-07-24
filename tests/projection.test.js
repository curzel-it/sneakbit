// Pure-node coverage for the world→screen projection math. No DOM, so the
// module loads in flat mode (TILT === 1); the tests assert both the classic
// top-down identity and the tilt-invariant relationships the renderer relies on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TILE_SIZE } from "../js/constants.js";
import {
  TILT, screenX, groundY, projectGround, projectBillboard,
  billboardFromFeet, unprojectGround, depthOf,
} from "../js/projection.js";

const camera = { x: 3, y: 5, w: 20, h: 15 };

test("flat mode is the default under node (no ?bb=1)", () => {
  assert.equal(TILT, 1);
});

test("screenX is the classic camera-relative pixel column", () => {
  assert.equal(screenX(10, camera), (10 - 3) * TILE_SIZE);
});

test("groundY compresses depth by TILT", () => {
  assert.equal(groundY(12, camera), (12 - 5) * TILE_SIZE * TILT);
});

test("projectGround round-trips through unprojectGround", () => {
  const wx = 11.25, wy = 8.5;
  const { sx, sy } = projectGround(wx, wy, camera);
  const back = unprojectGround(sx, sy, camera);
  assert.ok(Math.abs(back.wx - wx) < 1e-9);
  assert.ok(Math.abs(back.wy - wy) < 1e-9);
});

test("projectBillboard anchors the feet on the ground plane", () => {
  const wx = 7, wy = 4, h = 2;
  const b = projectBillboard(wx, wy, h, camera);
  // Feet (wy + h) land exactly at their ground-plane y, with the sprite's full
  // unscaled height rising above that anchor.
  assert.equal(b.sy + h * TILE_SIZE, groundY(wy + h, camera));
  assert.equal(b.sx, screenX(wx, camera));
});

test("billboardFromFeet matches a billboard whose top-left is aboveFeet tiles up", () => {
  const feetY = 9, aboveFeet = 3;
  const fromFeet = billboardFromFeet(feetY, aboveFeet, camera);
  const asBillboard = projectBillboard(0, feetY - aboveFeet, aboveFeet, camera).sy;
  assert.equal(fromFeet, asBillboard);
});

test("flat billboard equals the old top-down top-left blit", () => {
  // The classic hero blit was py = (player.y - 1 - camera.y) * TILE_SIZE for a
  // 1×2 sprite (top-left player.y - 1). Billboarding that top-left must match
  // pixel-for-pixel while TILT === 1.
  const playerY = 12;
  const b = projectBillboard(8, playerY - 1, 2, camera);
  assert.equal(b.sy, (playerY - 1 - camera.y) * TILE_SIZE);
});

test("depthOf is the feet row for painter sorting", () => {
  assert.equal(depthOf(9.5), 9.5);
});
