// Tower Defense ally AI — the Barbarian's pure targeting helpers: priority 4's
// acquisition (closest enemy within range, exit-nearness as the tiebreak) and
// priority 5's commitment (stay on a target until it's eliminated unless a
// strictly closer one turns up), plus the barrel-avoiding path step. The full
// ladder (cover / melee / lunge) runs live in tests/e2e/towerDefense.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { acquireTarget, marchTarget, resetAllyAI, pathStepToward } from "../js/allyAI.js";
import { computeFlowField } from "../js/flowField.js";
import { BARREL_SPECIES } from "../js/tdObstacles.js";

const enemy = (id, x, y, extra = {}) => ({ id, frame: { x, y, w: 1, h: 1 }, ...extra });
const hero = (tileX, tileY, index = 1) => ({ tileX, tileY, index });

function tdZone(cols, rows, { walls = [], barrels = [] } = {}) {
  const collision = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  for (const [x, y] of walls) collision[y][x] = true;
  const entities = barrels.map(([x, y], i) => ({
    id: -100 - i, species_id: BARREL_SPECIES.wood, frame: { x, y: y - 1, w: 1, h: 2 },
  }));
  return { cols, rows, collision, entities };
}

const openGrid = (cols, rows) => ({ cols, rows, isBlocked: () => false });

// — acquireTarget (priority 4) ——————————————————————————————————————————————

test("acquireTarget picks the closest enemy to the hero within range", () => {
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  const far = enemy(2, 8, 0);
  assert.equal(acquireTarget(h, [far, near], null, null, 10), near);
});

test("acquireTarget breaks ties by exit-nearness", () => {
  const h = hero(0, 0);
  // Both enemies are 4 tiles from the hero; the goal at (5,0) makes e_a the
  // one further along toward the leak, so it wins the tie.
  const eA = enemy(1, 4, 0); // 1 tile from goal
  const eB = enemy(2, 0, 4); // 9 tiles from goal
  assert.equal(acquireTarget(h, [eB, eA], null, { x: 5, y: 0 }, 10), eA);
});

test("acquireTarget ignores enemies beyond the range", () => {
  const h = hero(0, 0);
  const out = enemy(1, 11, 0); // 11 tiles — out of a 10-tile reach
  assert.equal(acquireTarget(h, [out], null, null, 10), null);
  const inRange = enemy(2, 5, 0);
  assert.equal(acquireTarget(h, [out, inRange], null, null, 10), inRange);
});

test("acquireTarget skips dying enemies", () => {
  const h = hero(0, 0);
  const dying = enemy(1, 2, 0, { _dying: true });
  const live = enemy(2, 6, 0);
  assert.equal(acquireTarget(h, [dying, live], null, null, 10), live);
});

// — marchTarget (priority 5: commitment) ————————————————————————————————————

test("marchTarget acquires the closest target and commits to it", () => {
  resetAllyAI();
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  const far = enemy(2, 8, 0);
  assert.equal(marchTarget(h, [near, far], null, null), near);
});

test("marchTarget holds its target when nothing strictly closer appears", () => {
  resetAllyAI();
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  assert.equal(marchTarget(h, [near], null, null), near); // commit
  // A second enemy shows up at the same distance (not strictly closer) — hold.
  const tie = enemy(2, 0, 3);
  assert.equal(marchTarget(h, [near, tie], null, null), near);
  // And a farther one certainly doesn't pull it off target.
  const farther = enemy(3, 5, 0);
  assert.equal(marchTarget(h, [near, tie, farther], null, null), near);
});

test("marchTarget switches when a strictly closer target turns up", () => {
  resetAllyAI();
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  const far = enemy(2, 8, 0);
  assert.equal(marchTarget(h, [near, far], null, null), near); // commit to near
  // The committed target drifts away (now 9 tiles); far is now closer (8) →
  // a closer target has come up, so switch.
  near.frame.x = 9;
  assert.equal(marchTarget(h, [near, far], null, null), far);
});

test("marchTarget re-acquires once the committed target is eliminated", () => {
  resetAllyAI();
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  const far = enemy(2, 8, 0);
  assert.equal(marchTarget(h, [near, far], null, null), near); // commit
  near._dying = true;                                          // killed
  assert.equal(marchTarget(h, [near, far], null, null), far);  // pick the next
  // A target removed from the list entirely is likewise treated as eliminated.
  resetAllyAI();
  assert.equal(marchTarget(h, [far], null, null), far);
});

test("marchTarget returns null when nothing is in range", () => {
  resetAllyAI();
  const h = hero(0, 0);
  assert.equal(marchTarget(h, [enemy(1, 30, 0)], null, null), null);
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
  assert.equal(pathStepToward(tdZone(3, 3), 0, 1, { x: 2, y: 1 }), "right");
  assert.equal(pathStepToward(zone, 0, 1, { x: 2, y: 1 }), "down");
});

test("pathStepToward returns null when the target is walled off", () => {
  const zone = tdZone(5, 5, { walls: [[1, 2], [3, 2], [2, 1], [2, 3]] });
  assert.equal(pathStepToward(zone, 0, 0, { x: 2, y: 2 }), null);
});
