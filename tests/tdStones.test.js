// Tower Defense stones — the pushable boulders that replace the build shop.
// Pure-ish (no DOM): exercises the block query, the in-view spawn placement,
// and the field recompute when a stone is shoved. The live push + reroute is
// covered end-to-end in tests/e2e/towerDefense.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadSpeciesData } from "../js/species.js";
import { STONE_SPECIES, stoneBlocksTile, stoneCount, spawnStonesInView, reconcileStones, resetStones } from "../js/tdStones.js";
import { initBoard, getField, getGoal, getSpawns } from "../js/tdBoard.js";
import { fieldDistance } from "../js/flowField.js";

// The stone is looked up by species (PushableObject) in every path here.
loadSpeciesData([
  { id: STONE_SPECIES, entity_type: "PushableObject", sprite_sheet_id: 1010, sprite_frame: { x: 1, y: 2, w: 1, h: 1 } },
]);

const stone = (x, y, extra = {}) => ({
  id: -1, species_id: STONE_SPECIES, frame: { x, y, w: 1, h: 1 }, ...extra,
});

function emptyZone(cols, rows) {
  return {
    cols, rows,
    collision: Array.from({ length: rows }, () => Array.from({ length: cols }, () => false)),
    entities: [],
  };
}

// — stoneBlocksTile —————————————————————————————————————————————————————————

test("stoneBlocksTile reports the stone's own tile only", () => {
  const zone = emptyZone(5, 5);
  zone.entities.push(stone(2, 3));
  assert.equal(stoneBlocksTile(zone, 2, 3), true, "the stone tile blocks");
  assert.equal(stoneBlocksTile(zone, 2, 2), false, "the tile above is clear");
  assert.equal(stoneBlocksTile(zone, 3, 3), false, "the neighbour is clear");
});

test("a dying stone no longer blocks", () => {
  const zone = emptyZone(5, 5);
  const s = stone(2, 3, { _dying: true });
  zone.entities.push(s);
  assert.equal(stoneBlocksTile(zone, 2, 3), false);
});

// — spawnStonesInView ————————————————————————————————————————————————————————

function boardState(cols, rows, camera) {
  resetStones();
  const zone = emptyZone(cols, rows);
  const rawZone = {
    td: {
      goal: { x: cols - 1, y: Math.floor(rows / 2) },
      spawns: [{ x: 0, y: Math.floor(rows / 2) }],
      heroSpawns: [{ x: 1, y: 1 }],
    },
  };
  initBoard(rawZone, zone);
  return { zone, rawZone, camera, player: { tileX: 1, tileY: 1 }, players: [] };
}

test("spawnStonesInView drops the requested count on free in-view tiles", () => {
  const state = boardState(10, 10, { x: 0, y: 0, w: 10, h: 10 });
  const placed = spawnStonesInView(state, 4);

  assert.equal(placed.length, 4, "four stones placed");
  assert.equal(stoneCount(state.zone), 4);
  const goal = getGoal();
  const spawns = getSpawns();
  for (const s of placed) {
    const { x, y } = s.frame;
    assert.ok(x >= 0 && x < 10 && y >= 0 && y < 10, "in bounds / in view");
    assert.ok(!(x === goal.x && y === goal.y), "never on the goal");
    assert.ok(!spawns.some((sp) => sp.x === x && sp.y === y), "never on a spawn");
    assert.ok(!(x === 1 && y === 1), "never under the hero");
    assert.equal(s._tdTile.x, x, "remembers its tile");
  }
  // No two stones share a tile (isEntityBlocked rejects stacking).
  const keys = new Set(placed.map((s) => `${s.frame.x},${s.frame.y}`));
  assert.equal(keys.size, 4, "all distinct tiles");
});

test("spawnStonesInView only uses tiles inside the camera rect", () => {
  // A 2x2 window in the top-left of a big board: every stone must land there.
  const state = boardState(30, 30, { x: 0, y: 0, w: 2, h: 2 });
  const placed = spawnStonesInView(state, 4);
  for (const s of placed) {
    assert.ok(s.frame.x <= 2 && s.frame.y <= 2, "within the small view");
  }
});

// — reconcileStones ——————————————————————————————————————————————————————————

test("reconcileStones recomputes the field after a stone is shoved", () => {
  const state = boardState(10, 10, { x: 0, y: 0, w: 10, h: 10 });
  // Place one stone away from everything, then move it onto a fresh tile and
  // confirm the flow field marks the new tile blocked (Infinity distance).
  const s = stone(5, 2);
  s._tdTile = { x: 5, y: 2 };
  state.zone.entities.push(s);

  s.frame.x = 6;
  s.frame.y = 2;
  reconcileStones(state);

  assert.deepEqual(s._tdTile, { x: 6, y: 2 }, "remembered tile follows the shove");
  assert.equal(fieldDistance(getField(), 6, 2), Infinity, "the new stone tile is unreachable");
  assert.notEqual(fieldDistance(getField(), 5, 2), Infinity, "the vacated tile reopens");
});
