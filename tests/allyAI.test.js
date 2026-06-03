// Tower Defense ally AI — the Barbarian's two pure decision helpers: picking
// the enemy nearest the exit (priority 4's target) and stepping toward it
// around the barrel maze. The full priority ladder (cover / melee / lunge) is
// exercised live in tests/e2e/towerDefense.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { enemyNearestExit, pathStepToward } from "../js/allyAI.js";
import { computeFlowField } from "../js/flowField.js";
import { BARREL_SPECIES } from "../js/tdObstacles.js";

// A 1×1 enemy whose feet tile is (x, y).
const enemy = (x, y, extra = {}) => ({ frame: { x, y, w: 1, h: 1 }, ...extra });

// A bare TD zone the collision helpers can read: an all-walkable grid plus
// optional wall tiles (construction collision) and placed barrels (entities).
function tdZone(cols, rows, { walls = [], barrels = [] } = {}) {
  const collision = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  for (const [x, y] of walls) collision[y][x] = true;
  // A barrel renders 1×2 and blocks its feet tile (frame.y is one tile up).
  const entities = barrels.map(([x, y], i) => ({
    id: -100 - i, species_id: BARREL_SPECIES.wood, frame: { x, y: y - 1, w: 1, h: 2 },
  }));
  return { cols, rows, collision, entities };
}

const openGrid = (cols, rows) => ({ cols, rows, isBlocked: () => false });

// — enemyNearestExit ————————————————————————————————————————————————————————

test("enemyNearestExit picks the enemy closest to the goal by flow-field distance", () => {
  const field = computeFlowField(openGrid(5, 5), { x: 4, y: 2 });
  const enemies = [enemy(0, 2), enemy(3, 2), enemy(1, 4)];
  // (3,2) is one step from the goal — the next to leak.
  assert.deepEqual(enemyNearestExit(enemies, field, { x: 4, y: 2 }), { x: 3, y: 2 });
});

test("enemyNearestExit falls back to straight-line distance with no field", () => {
  const enemies = [enemy(0, 2), enemy(3, 2)];
  assert.deepEqual(enemyNearestExit(enemies, null, { x: 4, y: 2 }), { x: 3, y: 2 });
});

test("enemyNearestExit skips dying enemies", () => {
  const field = computeFlowField(openGrid(5, 5), { x: 4, y: 2 });
  // The closest-to-exit enemy is dying — the live one further back wins.
  const enemies = [enemy(3, 2, { _dying: true }), enemy(1, 2)];
  assert.deepEqual(enemyNearestExit(enemies, field, { x: 4, y: 2 }), { x: 1, y: 2 });
});

test("enemyNearestExit returns null when there are no live enemies", () => {
  assert.equal(enemyNearestExit([], null, { x: 4, y: 2 }), null);
  assert.equal(enemyNearestExit([enemy(1, 1, { _dying: true })], null, { x: 4, y: 2 }), null);
});

// — pathStepToward ——————————————————————————————————————————————————————————

test("pathStepToward steps straight at a target with a clear lane", () => {
  const zone = tdZone(5, 5);
  assert.equal(pathStepToward(zone, 0, 2, { x: 4, y: 2 }), "right");
});

test("pathStepToward routes around a barrel blocking the direct lane", () => {
  // Hero (0,1) → target (2,1). The straight tile (1,1) holds a barrel and the
  // tile above it (1,0) is a wall, so the only path bends down through (1,2).
  const zone = tdZone(3, 3, { walls: [[1, 0]], barrels: [[1, 1]] });
  // Sanity: with a clear lane the same hop is "right"…
  assert.equal(pathStepToward(tdZone(3, 3), 0, 1, { x: 2, y: 1 }), "right");
  // …but the barrel forces the detour downward.
  assert.equal(pathStepToward(zone, 0, 1, { x: 2, y: 1 }), "down");
});

test("pathStepToward returns null when the target is walled off", () => {
  // Box the target (2,2) in with walls on every approach.
  const zone = tdZone(5, 5, { walls: [[1, 2], [3, 2], [2, 1], [2, 3]] });
  assert.equal(pathStepToward(zone, 0, 0, { x: 2, y: 2 }), null);
});
