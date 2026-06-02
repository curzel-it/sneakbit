// Tower Defense flow-field: BFS-out-from-goal gradient correctness, the
// "step toward goal" direction, reachability, and the anti-wall-off check.
// Pure grid math — no DOM, no zone.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeFlowField, fieldDistance, fieldDirection, isReachable, allReachable, dirDelta,
} from "../js/flowField.js";

// Grid helper: a cols×rows field with an optional set of blocked "x,y" tiles.
function grid(cols, rows, blocked = []) {
  const set = new Set(blocked.map(([x, y]) => `${x},${y}`));
  return { cols, rows, isBlocked: (x, y) => set.has(`${x},${y}`) };
}

test("distance is 0 at the goal and grows by Manhattan steps on an open field", () => {
  const f = computeFlowField(grid(5, 5), { x: 0, y: 0 });
  assert.equal(fieldDistance(f, 0, 0), 0);
  assert.equal(fieldDistance(f, 1, 0), 1);
  assert.equal(fieldDistance(f, 0, 1), 1);
  assert.equal(fieldDistance(f, 4, 4), 8);
  assert.equal(fieldDirection(f, 0, 0), null); // nothing to do on the goal
});

test("direction points one step closer to the goal", () => {
  const f = computeFlowField(grid(5, 5), { x: 4, y: 2 });
  // Goal is to the right of (0,2): stepping right reduces distance.
  const d = fieldDirection(f, 0, 2);
  assert.ok(d != null);
  const [dx, dy] = dirDelta(d);
  assert.equal(fieldDistance(f, 0 + dx, 2 + dy), fieldDistance(f, 0, 2) - 1);
});

test("following the gradient from any open tile reaches the goal", () => {
  const f = computeFlowField(grid(8, 8, [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6]]), { x: 7, y: 7 });
  let x = 0, y = 0;
  let steps = 0;
  while (!(x === 7 && y === 7)) {
    const d = fieldDirection(f, x, y);
    assert.ok(d != null, `stuck at ${x},${y}`);
    const [dx, dy] = dirDelta(d);
    x += dx; y += dy;
    assert.ok(++steps < 200, "did not converge");
  }
  assert.equal(steps, fieldDistance(f, 0, 0));
});

test("enemies route around a wall instead of through it", () => {
  // A vertical wall at x=2 spanning rows 0..3, with a gap at row 4.
  const f = computeFlowField(grid(5, 6, [[2, 0], [2, 1], [2, 2], [2, 3]]), { x: 4, y: 0 });
  // (0,0) must detour down to row 4, through the gap, then back up — strictly
  // longer than the straight-line Manhattan distance of 4.
  assert.ok(fieldDistance(f, 0, 0) > 4);
  assert.ok(isReachable(f, 0, 0));
});

test("a tile fully walled off from the goal is unreachable", () => {
  // Box (0,0) in completely.
  const f = computeFlowField(grid(5, 5, [[1, 0], [0, 1], [1, 1]]), { x: 4, y: 4 });
  assert.equal(isReachable(f, 0, 0), false);
  assert.equal(fieldDistance(f, 0, 0), Infinity);
  assert.equal(fieldDirection(f, 0, 0), null);
});

test("allReachable rejects a placement that seals any spawn off", () => {
  const spawns = [{ x: 0, y: 0 }, { x: 0, y: 4 }];
  const open = computeFlowField(grid(5, 5), { x: 4, y: 4 });
  assert.equal(allReachable(open, spawns), true);

  // Wall the top spawn off (box (0,0)); the bottom spawn is still fine.
  const sealed = computeFlowField(grid(5, 5, [[1, 0], [0, 1], [1, 1]]), { x: 4, y: 4 });
  assert.equal(allReachable(sealed, spawns), false);
});

test("an out-of-bounds or blocked goal yields an empty field", () => {
  const oob = computeFlowField(grid(4, 4), { x: 9, y: 9 });
  assert.equal(isReachable(oob, 0, 0), false);
  const blockedGoal = computeFlowField(grid(4, 4, [[2, 2]]), { x: 2, y: 2 });
  assert.equal(isReachable(blockedGoal, 0, 0), false);
});
