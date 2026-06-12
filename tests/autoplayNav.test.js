// botNav pure logic: direction conversion, BFS pathing on a synthetic zone,
// and the navigator's arrived/blocked status. No DOM, no real engine zone —
// a minimal zone stub is enough for the collision helpers (empty entity
// list, so only terrain collision matters).

import { test } from "node:test";
import assert from "node:assert/strict";
import { stepDirection, findPath, isNavWalkable, makeNavigator } from "../js/autoplay/botNav.js";

// rows is an array of strings; '#' = blocked, '.' = walkable.
function zoneFrom(rows) {
  const collision = rows.map((r) => [...r].map((c) => c === "#"));
  return { cols: rows[0].length, rows: rows.length, collision, entities: [] };
}

test("stepDirection maps 4-adjacency, null otherwise", () => {
  assert.equal(stepDirection({ x: 1, y: 1 }, { x: 2, y: 1 }), "right");
  assert.equal(stepDirection({ x: 1, y: 1 }, { x: 0, y: 1 }), "left");
  assert.equal(stepDirection({ x: 1, y: 1 }, { x: 1, y: 2 }), "down");
  assert.equal(stepDirection({ x: 1, y: 1 }, { x: 1, y: 0 }), "up");
  assert.equal(stepDirection({ x: 1, y: 1 }, { x: 2, y: 2 }), null);
});

test("findPath routes around a wall", () => {
  const zone = zoneFrom([
    ".#.",
    "...",
  ]);
  const path = findPath(zone, { x: 0, y: 0 }, new Set(["2,0"]));
  assert.ok(path, "a path should exist around the wall");
  assert.deepEqual(path[0], { x: 0, y: 0 });
  assert.deepEqual(path[path.length - 1], { x: 2, y: 0 });
  // It cannot step through (1,0) — must dip to row 1.
  assert.ok(path.some((t) => t.y === 1), "path must detour through the open row");
});

test("findPath returns null when the goal is walled off", () => {
  const zone = zoneFrom([
    ".#.",
    ".#.",
  ]);
  assert.equal(findPath(zone, { x: 0, y: 0 }, new Set(["2,0"])), null);
});

test("isNavWalkable respects terrain collision", () => {
  const zone = zoneFrom([".#"]);
  assert.equal(isNavWalkable(zone, 0, 0), true);
  assert.equal(isNavWalkable(zone, 1, 0), false);
  assert.equal(isNavWalkable(zone, 5, 5), false, "out of bounds is not walkable");
});

test("navigator reports arrived when already on a goal tile", () => {
  const zone = zoneFrom(["..."]);
  const nav = makeNavigator();
  nav.setGoal([{ x: 2, y: 0 }]);
  const r = nav.tick({ tileX: 2, tileY: 0, step: null }, zone);
  assert.equal(r.status, "arrived");
});

test("navigator steps toward the goal", () => {
  const zone = zoneFrom(["..."]);
  const nav = makeNavigator();
  nav.setGoal([{ x: 2, y: 0 }]);
  const r = nav.tick({ tileX: 0, tileY: 0, step: null }, zone);
  assert.equal(r.status, "moving");
  assert.equal(r.dir, "right");
});

test("navigator reports blocked when the goal is unreachable", () => {
  const zone = zoneFrom([
    ".#.",
    ".#.",
  ]);
  const nav = makeNavigator();
  nav.setGoal([{ x: 2, y: 0 }]);
  const r = nav.tick({ tileX: 0, tileY: 0, step: null }, zone);
  assert.equal(r.status, "blocked");
});
