import { test } from "node:test";
import assert from "node:assert/strict";

import { directionForVector } from "../js/touchJoystick.js";

// Screen space: +x is right, +y is down. The dead zone is 16px by default.

test("inside the dead zone yields no direction", () => {
  assert.equal(directionForVector(0, 0), null);
  assert.equal(directionForVector(10, 10), null); // hypot ~14 < 16
});

test("dominant axis decides the cardinal direction", () => {
  assert.equal(directionForVector(40, 0), "right");
  assert.equal(directionForVector(-40, 0), "left");
  assert.equal(directionForVector(0, 40), "down");
  assert.equal(directionForVector(0, -40), "up");
});

test("near-diagonal drags snap to the stronger axis", () => {
  assert.equal(directionForVector(40, 10), "right");
  assert.equal(directionForVector(10, -40), "up");
  assert.equal(directionForVector(-40, 30), "left");
});

test("exact diagonal ties resolve to the horizontal axis", () => {
  assert.equal(directionForVector(30, 30), "right");
  assert.equal(directionForVector(-30, -30), "left");
});

test("a custom dead zone is honored", () => {
  assert.equal(directionForVector(20, 0, 30), null);
  assert.equal(directionForVector(40, 0, 30), "right");
});
