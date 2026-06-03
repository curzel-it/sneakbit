// Tower Defense build shop: the placeable-obstacle pieces that don't need a
// DOM or a fully-loaded zone — the obstacle collision query, the way a placed
// barrel reshapes the horde's flow field (block + anti-wall-off), and the
// build catalog / palette economy. Full click-to-place is exercised end-to-end
// by tests/e2e/towerDefense.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  tdObstacleAt, obstacleFeetTile, isBuildObstacleSpecies, BARREL_SPECIES,
} from "../js/tdObstacles.js";
import {
  initBoard, recomputeField, spawnsReachGoal, getField,
} from "../js/tdBoard.js";
import { fieldDistance, isReachable } from "../js/flowField.js";
import { BUILD_ITEMS, getSelectedItem, setSelectedItem, getPaletteModel } from "../js/tdBuild.js";
import { resetGold } from "../js/arcadeCurrency.js";

// A bare zone the flow field can read: an all-walkable grid plus an entity
// list. No biome/construction layers — initBoard + recomputeField only touch
// cols/rows/collision/entities.
function openZone(cols, rows, entities = []) {
  const collision = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  return { cols, rows, collision, entities };
}

function barrel(x, y) {
  // Feet on (x, y): a 1×2 barrel anchored one tile up, like the placer makes.
  return { id: -3_000_001, species_id: BARREL_SPECIES.wood, frame: { x, y: y - 1, w: 1, h: 2 } };
}

// — tdObstacles: the shared collision query ————————————————————————————————

test("a barrel blocks its feet tile and isExplosive-style species are obstacles", () => {
  const zone = openZone(5, 5, [barrel(2, 3)]);
  assert.equal(tdObstacleAt(zone, 2, 3), true, "feet tile blocks");
  assert.equal(tdObstacleAt(zone, 2, 2), false, "the upper sprite half does not block");
  assert.equal(tdObstacleAt(zone, 1, 3), false, "neighbouring tile is clear");
  assert.equal(isBuildObstacleSpecies(BARREL_SPECIES.purple), true);
  assert.equal(isBuildObstacleSpecies(9999), false);
});

test("obstacleFeetTile reads the bottom row of a 2-tall prop", () => {
  assert.deepEqual(obstacleFeetTile({ x: 4, y: 1, w: 1, h: 2 }), { x: 4, y: 2 });
});

test("a barrel the squad shot (dying) stops blocking at once", () => {
  const b = barrel(2, 3);
  const zone = openZone(5, 5, [b]);
  assert.equal(tdObstacleAt(zone, 2, 3), true);
  b._dying = true;
  assert.equal(tdObstacleAt(zone, 2, 3), false, "a dying barrel no longer blocks — corridor reopens");
});

// — Flow field: barrels reshape the horde route —————————————————————————————

test("the horde's flow field routes around a placed barrel", () => {
  // Goal at the right edge; a barrel sits straight ahead of the left tile.
  const raw = { td: { goal: { x: 4, y: 2 }, spawns: [{ x: 0, y: 2 }], heroSpawns: [] } };
  const zone = openZone(5, 5, [barrel(2, 2)]);
  initBoard(raw, zone);
  const f = getField();
  assert.equal(fieldDistance(f, 2, 2), Infinity, "the barrel tile is unreachable (blocked)");
  assert.ok(isReachable(f, 0, 2), "the spawn still has a path");
  assert.ok(fieldDistance(f, 0, 2) > 4, "the detour around the barrel is longer than the straight line");
});

test("anti-wall-off: a barrel ring that seals the only spawn is rejected", () => {
  const raw = { td: { goal: { x: 4, y: 4 }, spawns: [{ x: 0, y: 0 }], heroSpawns: [] } };
  // Box (0,0) in with barrels on its two open sides.
  const zone = openZone(5, 5, [barrel(1, 0), barrel(0, 1)]);
  initBoard(raw, zone);
  assert.equal(spawnsReachGoal(), false, "the spawn is walled off — placement must be refused");

  // Remove one barrel: the spawn breathes again.
  zone.entities = [barrel(1, 0)];
  recomputeField(zone);
  assert.equal(spawnsReachGoal(), true, "with a gap, the spawn reaches the goal");
});

// — Catalog / palette economy ——————————————————————————————————————————————

test("the build catalog ships four barrels and nothing else", () => {
  assert.equal(BUILD_ITEMS.length, 4, "four barrel colours");
  assert.ok(BUILD_ITEMS.every((i) => i.kind === "entity"), "every item is an entity — no construction tiles");
  assert.ok(BUILD_ITEMS.every((b) => isBuildObstacleSpecies(b.species)), "each barrel is an obstacle species");
});

test("selection defaults to the first barrel and can be switched", () => {
  assert.equal(getSelectedItem(), "barrel_wood");
  setSelectedItem("barrel_green");
  assert.equal(getSelectedItem(), "barrel_green");
  setSelectedItem("nope"); // unknown ids are ignored
  assert.equal(getSelectedItem(), "barrel_green");
  setSelectedItem("barrel_wood");
});

test("the palette model reflects what the player can afford", () => {
  resetGold(10); // enough for one 10g barrel
  let model = getPaletteModel();
  assert.equal(model.length, BUILD_ITEMS.length);
  assert.ok(model.every((m) => m.can), "every barrel affordable at 10g");

  resetGold(5); // not enough for any barrel
  model = getPaletteModel();
  assert.ok(model.every((m) => !m.can), "no barrel affordable at 5g");
});
