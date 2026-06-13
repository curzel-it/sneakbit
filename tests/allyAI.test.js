// Tower Defense ally AI — the pure decision helpers shared by every hero and
// the Ninja's positioning maths. The full per-archetype ladders (cover / melee
// / lunge, and the kite-and-fire shooter) run live in
// tests/e2e/towerDefense.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectTarget, marchTarget, resetAllyAI, pathStepToward,
  alignStep, laneDirToward, seekVisibleArea,
} from "../js/allyAI.js";

const enemy = (id, x, y, extra = {}) => ({ id, frame: { x, y, w: 1, h: 1 }, ...extra });
const hero = (tileX, tileY, index = 1) => ({ tileX, tileY, index });

// Ally pathing reads the walkable grid only (the maze obstacles live on the
// construction layer, folded into collision), so walls are all the test needs.
function tdZone(cols, rows, { walls = [] } = {}) {
  const collision = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  for (const [x, y] of walls) collision[y][x] = true;
  return { cols, rows, collision, entities: [] };
}

const heldDir = (input) => [...(input.held || [])][0] ?? null;

// — selectTarget: closest wins, exit-nearness breaks ties ————————————————————

test("selectTarget picks the closest enemy within range", () => {
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  const far = enemy(2, 8, 0);
  assert.equal(selectTarget(h, [far, near], null, null, 10), near);
});

test("selectTarget breaks a distance tie by exit-nearness", () => {
  const h = hero(0, 0);
  // Both 2 tiles from the hero; goal at (3,0) makes eA the next to leak.
  const eA = enemy(1, 2, 0); // 1 from goal
  const eB = enemy(2, 0, 2); // 5 from goal
  assert.equal(selectTarget(h, [eB, eA], null, { x: 3, y: 0 }, 10), eA);
});

test("selectTarget ignores enemies beyond range", () => {
  const h = hero(0, 0);
  const out = enemy(1, 11, 0);
  assert.equal(selectTarget(h, [out], null, null, 10), null);
  const inRange = enemy(2, 5, 0);
  assert.equal(selectTarget(h, [out, inRange], null, null, 10), inRange);
});

test("selectTarget skips dying enemies", () => {
  const h = hero(0, 0);
  const dying = enemy(1, 2, 0, { _dying: true });
  const live = enemy(2, 6, 0);
  assert.equal(selectTarget(h, [dying, live], null, null, 10), live);
});

// — marchTarget: commit to the closest, hold through ties, switch on closer ——

test("marchTarget acquires the closest and commits", () => {
  resetAllyAI();
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  const far = enemy(2, 8, 0);
  assert.equal(marchTarget(h, [near, far], null, null), near);
});

test("marchTarget holds its target against an equally-close one (even if more exit-near)", () => {
  resetAllyAI();
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);   // 3 tiles from hero, 8 from the goal (0,5)
  const goal = { x: 0, y: 5 };
  assert.equal(marchTarget(h, [near], null, goal), near); // commit to near
  // A new enemy ties on distance and is nearer the exit — a fresh selectTarget
  // would prefer it, but commitment beats the tiebreak (no dithering).
  const tie = enemy(2, 0, 3);    // also 3 tiles from hero, just 2 from the goal
  assert.equal(marchTarget(h, [near, tie], null, goal), near);
});

test("marchTarget switches when a strictly closer enemy turns up", () => {
  resetAllyAI();
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  const far = enemy(2, 8, 0);
  assert.equal(marchTarget(h, [near, far], null, null), near); // commit to near
  near.frame.x = 9;                                            // it drifts to 9 tiles
  assert.equal(marchTarget(h, [near, far], null, null), far);  // far (8) is now closer
});

test("marchTarget re-acquires once the committed target is eliminated", () => {
  resetAllyAI();
  const h = hero(0, 0);
  const near = enemy(1, 3, 0);
  const far = enemy(2, 8, 0);
  assert.equal(marchTarget(h, [near, far], null, null), near);
  near._dying = true;
  assert.equal(marchTarget(h, [near, far], null, null), far);
});

// — Ninja positioning: lane alignment + lane firing direction ————————————————

test("alignStep zeroes the nearer lane and avoids walls", () => {
  const zone = tdZone(8, 8);
  // Target far to the right, slightly down: the cheap lane is the row → step down.
  assert.equal(alignStep(zone, hero(0, 0), { x: 6, y: 2 }), "down");
  // Block the preferred horizontal step → fall back to the vertical axis.
  const walled = tdZone(8, 8, { walls: [[1, 0]] });
  assert.equal(alignStep(walled, hero(0, 0), { x: 2, y: 6 }), "down");
});

test("laneDirToward fires along the shared row or column", () => {
  assert.equal(laneDirToward(hero(2, 5), { x: 2, y: 1 }), "up");    // same column
  assert.equal(laneDirToward(hero(2, 5), { x: 6, y: 5 }), "right"); // same row
});

// — seekVisibleArea: regroup toward the camera centre ————————————————————————

test("seekVisibleArea steps toward the camera centre, and holds once centred", () => {
  const zone = tdZone(20, 20);
  const cam = { x: 0, y: 0, w: 10, h: 10 }; // centre (5,5)
  assert.equal(heldDir(seekVisibleArea({ camera: cam, zone }, hero(0, 5))), "right");
  // Already at the centre tile → no movement.
  const centred = seekVisibleArea({ camera: cam, zone }, hero(5, 5));
  assert.deepEqual([...centred.held], []);
});

// — pathStepToward: route around the maze obstacles —————————————————————————

test("pathStepToward steps straight at a target with a clear lane", () => {
  assert.equal(pathStepToward(tdZone(5, 5), 0, 2, { x: 4, y: 2 }), "right");
});

test("pathStepToward routes around an obstacle blocking the direct lane", () => {
  // (1,0) walled off above and (1,1) walled on the direct lane → detour down.
  const zone = tdZone(3, 3, { walls: [[1, 0], [1, 1]] });
  assert.equal(pathStepToward(tdZone(3, 3), 0, 1, { x: 2, y: 1 }), "right");
  assert.equal(pathStepToward(zone, 0, 1, { x: 2, y: 1 }), "down");
});

test("pathStepToward returns null when the target is walled off", () => {
  const zone = tdZone(5, 5, { walls: [[1, 2], [3, 2], [2, 1], [2, 3]] });
  assert.equal(pathStepToward(zone, 0, 0, { x: 2, y: 2 }), null);
});
