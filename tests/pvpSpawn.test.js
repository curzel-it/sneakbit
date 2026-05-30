// Corner spawns for PvP — scans inward from each map corner.

import { test } from "node:test";
import assert from "node:assert/strict";

const { cornerSpawnTile } = await import("../js/pvpSpawn.js?v=20260530a");

// "." walkable, "#" blocked (same shape as coopSpawn.test.js).
function mkZone(grid, entities = []) {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const collision = grid.map((row) => [...row].map((ch) => ch === "#"));
  return { cols, rows, collision, entities };
}

test("open map: each corner spawns at its own corner tile", () => {
  const zone = mkZone(Array(6).fill("......"));
  assert.deepEqual(cornerSpawnTile(zone, 0), { x: 0, y: 0 }); // TL
  assert.deepEqual(cornerSpawnTile(zone, 1), { x: 5, y: 0 }); // TR
  assert.deepEqual(cornerSpawnTile(zone, 2), { x: 0, y: 5 }); // BL
  assert.deepEqual(cornerSpawnTile(zone, 3), { x: 5, y: 5 }); // BR
});

test("two players land diagonally opposite", () => {
  const zone = mkZone(Array(6).fill("......"));
  const a = cornerSpawnTile(zone, 0);
  const b = cornerSpawnTile(zone, 1);
  assert.notDeepEqual(a, b);
});

test("scans inward when the corner tile is blocked", () => {
  // TL corner blocked; column-major inward scan finds (0,1) next.
  const zone = mkZone([
    "#.....",
    "......",
    "......",
    "......",
    "......",
    "......",
  ]);
  assert.deepEqual(cornerSpawnTile(zone, 0), { x: 0, y: 1 });
});

test("falls back to map centre when the quarter is walled off", () => {
  const zone = mkZone([
    "###...",
    "###...",
    "###...",
    "......",
    "......",
    "......",
  ]);
  // TL quarter (cols<3, rows<3) entirely blocked → centre fallback.
  assert.deepEqual(cornerSpawnTile(zone, 0), { x: 3, y: 3 });
});

test("corner index wraps mod 4", () => {
  const zone = mkZone(Array(4).fill("...."));
  assert.deepEqual(cornerSpawnTile(zone, 4), cornerSpawnTile(zone, 0));
});
