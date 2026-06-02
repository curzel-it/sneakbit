// Grid BFS — pure logic, no DOM. A walkable grid is { cols, rows, collision }
// where collision[y][x] truthy means blocked (matches zone.js::isWalkable).

import { test } from "node:test";
import assert from "node:assert/strict";
import { findPathToNearest } from "../js/pathfinding.js";

// Build a zone from an ASCII map: '#' blocked, anything else walkable.
function grid(rows) {
  const collision = rows.map((r) => [...r].map((c) => c === "#"));
  return { cols: rows[0].length, rows: rows.length, collision };
}

test("returns the path to the nearest of several goals", () => {
  const zone = grid([
    ".....",
    ".....",
    ".....",
  ]);
  // Start (2,1); goals far-left (0,1) at dist 2 and far-right (4,1) at dist 2.
  const path = findPathToNearest(zone, 2, 1, [{ x: 0, y: 1 }, { x: 4, y: 1 }]);
  assert.ok(path, "a path exists");
  assert.equal(path.length, 2, "two steps to a dist-2 goal");
  const last = path[path.length - 1];
  assert.ok((last.x === 0 || last.x === 4) && last.y === 1, "ends on a goal tile");
});

test("routes around a wall", () => {
  const zone = grid([
    ".#...",
    ".#...",
    ".....",
  ]);
  // Start (0,0), goal (2,0) — the wall at column 1 forces a detour via row 2.
  const path = findPathToNearest(zone, 0, 0, [{ x: 2, y: 0 }]);
  assert.ok(path, "a detour path exists");
  assert.deepEqual(path[path.length - 1], { x: 2, y: 0 });
  // Every step must be on a walkable tile.
  for (const t of path) assert.equal(zone.collision[t.y][t.x], false);
});

test("omits the start tile and includes the goal", () => {
  const zone = grid(["..."]);
  const path = findPathToNearest(zone, 0, 0, [{ x: 2, y: 0 }]);
  assert.deepEqual(path, [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
});

test("returns null when boxed in", () => {
  const zone = grid([
    "###",
    "#.#",
    "###",
  ]);
  assert.equal(findPathToNearest(zone, 1, 1, [{ x: 0, y: 0 }]), null);
});

test("returns null with no goals", () => {
  const zone = grid(["..."]);
  assert.equal(findPathToNearest(zone, 0, 0, []), null);
});
