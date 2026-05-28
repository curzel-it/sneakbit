// BFS spawn-tile picker for co-op partners. Verifies the prior
// "prefer the facing tile" behaviour for open spawns and the new
// outward expansion when the immediate neighbours are all walled.

import { test } from "node:test";
import assert from "node:assert/strict";

const { pickCoopSpawn } = await import("../js/coopSpawn.js?v=20260528c");

// Builds a zone whose collision matrix is given as a string grid:
// "." → walkable, "#" → blocked. The optional entities array is
// passed through to isEntityBlocked unchanged.
function mkZone(grid, entities = []) {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const collision = grid.map((row) =>
    [...row].map((ch) => ch === "#"));
  return { cols, rows, collision, entities };
}

test("prefers the tile in front of the reference player", () => {
  const zone = mkZone([
    ".....",
    ".....",
    ".....",
    ".....",
    ".....",
  ]);
  const ref = { tileX: 2, tileY: 2, direction: "right" };
  assert.deepEqual(pickCoopSpawn(ref, zone), { x: 3, y: 2 });
});

test("falls back to another cardinal when the facing tile is blocked", () => {
  const zone = mkZone([
    ".....",
    "..#..",
    ".....",
    ".....",
    ".....",
  ]);
  const ref = { tileX: 2, tileY: 2, direction: "up" };
  // up is wall → BFS visits remaining cardinals in fixed order
  // (down, left, right) and picks the first walkable one.
  assert.deepEqual(pickCoopSpawn(ref, zone), { x: 2, y: 3 });
});

test("expands outward when every cardinal is blocked", () => {
  // Reference sits at (2,2). All four cardinals are walls. The
  // nearest walkable tile is two steps away through one of the
  // corners. Expected: BFS finds a diagonal-adjacent tile (e.g.
  // (1,1), (3,1), (1,3), (3,3)) — never the reference's own tile.
  const zone = mkZone([
    ".....",
    ".....",
    "..#..",
    "..#..",
    ".....",
  ]);
  // surround (2,2) with walls on every cardinal:
  zone.collision[1][2] = true;
  zone.collision[2][1] = true;
  zone.collision[2][3] = true;
  zone.collision[3][2] = true;
  const ref = { tileX: 2, tileY: 2, direction: "down" };
  const spawn = pickCoopSpawn(ref, zone);
  assert.notDeepEqual(spawn, { x: 2, y: 2 });
  const dist = Math.abs(spawn.x - 2) + Math.abs(spawn.y - 2);
  assert.equal(dist, 2, `expected nearest walkable at distance 2, got ${JSON.stringify(spawn)}`);
});

test("falls back to the reference tile when the zone is fully walled", () => {
  const zone = mkZone([
    "###",
    "#.#",
    "###",
  ]);
  const ref = { tileX: 1, tileY: 1, direction: "down" };
  assert.deepEqual(pickCoopSpawn(ref, zone), { x: 1, y: 1 });
});

test("treats out-of-bounds neighbours as blocked", () => {
  const zone = mkZone([
    ".....",
    ".....",
  ]);
  const ref = { tileX: 0, tileY: 0, direction: "up" };
  // up + left are out of bounds (skipped); facing-first order then
  // visits down → (0,1) is walkable and wins.
  assert.deepEqual(pickCoopSpawn(ref, zone), { x: 0, y: 1 });
});
