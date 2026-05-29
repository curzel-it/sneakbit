import { test } from "node:test";
import assert from "node:assert/strict";

import { projectStraight, moveStraight } from "../js/movement.js?v=20260529c";

const ZONE = { cols: 10, rows: 10 };

test("projectStraight moves down at the requested speed for dt seconds", () => {
  const f = { x: 1, y: 1, w: 1, h: 1 };
  const next = projectStraight(f, "down", 4, 0.25);
  assert.equal(next.x, 1);
  assert.equal(next.y, 2);
  assert.equal(f.y, 1); // original unchanged
});

test("projectStraight accepts capitalized directions (Rust-style)", () => {
  const f = { x: 0, y: 0, w: 1, h: 1 };
  assert.equal(projectStraight(f, "Right", 2, 0.5).x, 1);
  assert.equal(projectStraight(f, "Left",  2, 0.5).x, -1);
});

test("moveStraight applies the step in place and returns true", () => {
  const f = { x: 3, y: 3, w: 1, h: 1 };
  const ok = moveStraight(f, "right", 8, 0.125, ZONE);
  assert.equal(ok, true);
  assert.equal(f.x, 4);
  assert.equal(f.y, 3);
});

test("moveStraight returns false and leaves frame untouched with zero speed", () => {
  const f = { x: 3, y: 3, w: 1, h: 1 };
  assert.equal(moveStraight(f, "right", 0, 0.5, ZONE), false);
  assert.equal(f.x, 3);
});

test("moveStraight returns false on 'none' / missing direction", () => {
  const f = { x: 3, y: 3, w: 1, h: 1 };
  assert.equal(moveStraight(f, "none", 5, 0.1, ZONE), false);
  assert.equal(moveStraight(f, null,   5, 0.1, ZONE), false);
  assert.equal(f.x, 3);
});

test("moveStraight refuses to leave the zone bounds", () => {
  const f = { x: 0, y: 0, w: 1, h: 1 };
  assert.equal(moveStraight(f, "left", 5, 1.0, ZONE), false);
  assert.equal(f.x, 0);

  const g = { x: 9, y: 9, w: 1, h: 1 };
  assert.equal(moveStraight(g, "right", 5, 1.0, ZONE), false);
  assert.equal(g.x, 9);
});
