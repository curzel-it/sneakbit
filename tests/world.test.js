import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, isWalkable, isEntityBlocked } from "../js/world.js";
import { loadSpeciesData } from "../js/species.js";

loadSpeciesData([
  { id: 1006, entity_type: "Building", is_rigid: true, sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 5, h: 5 } },
  { id: 1019, entity_type: "Teleporter", is_rigid: false, sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

const TINY = {
  id: 9999,
  biome_tiles: {
    sheet_id: 1002,
    tiles: [
      "1112",
      "1112",
      "1122",
      "1222",
    ],
  },
  construction_tiles: {
    sheet_id: 1003,
    tiles: [
      "0000",
      "0E00",
      "0080",
      "0000",
    ],
  },
  entities: [],
};

test("buildWorld produces correct dimensions and tile grids", () => {
  const w = buildWorld(TINY);
  assert.equal(w.rows, 4);
  assert.equal(w.cols, 4);
  assert.ok(Array.isArray(w.biome));
  assert.ok(Array.isArray(w.biomeCol));
  assert.ok(Array.isArray(w.construction));
  assert.ok(Array.isArray(w.constructionRow));
  assert.ok(Array.isArray(w.collision));
});

test("walkability: grass walkable, water blocked, bridge over water walkable, forest blocked", () => {
  const w = buildWorld(TINY);
  // (0,0) is grass
  assert.equal(isWalkable(w, 0, 0), true);
  // (3,0) is water
  assert.equal(isWalkable(w, 3, 0), false);
  // (1,1) is grass + Bridge (E) — bridge is non-obstacle
  assert.equal(isWalkable(w, 1, 1), true);
  // (2,2) has forest (8) which is an obstacle
  assert.equal(isWalkable(w, 2, 2), false);
});

test("walkability rejects out-of-bounds", () => {
  const w = buildWorld(TINY);
  assert.equal(isWalkable(w, -1, 0), false);
  assert.equal(isWalkable(w, 0, -1), false);
  assert.equal(isWalkable(w, 4, 0), false);
  assert.equal(isWalkable(w, 0, 4), false);
});

test("destination-teleporter on a building tile is enterable", () => {
  const w = buildWorld({
    ...TINY,
    biome_tiles: { sheet_id: 1002, tiles: ["1111","1111","1111","1111"] },
    construction_tiles: { sheet_id: 1003, tiles: ["0000","0000","0000","0000"] },
    entities: [
      { species_id: 1006, frame: { x: 0, y: 0, w: 3, h: 3 } },
      { species_id: 1019, destination: { world: 42, x: 0, y: 0 },
        frame: { x: 1, y: 2, w: 1, h: 1 } },
    ],
  });
  assert.equal(isEntityBlocked(w, 1, 2), false);
  assert.equal(isEntityBlocked(w, 0, 0), true);
});

test("teleporter without destination does not unblock the building", () => {
  const w = buildWorld({
    ...TINY,
    biome_tiles: { sheet_id: 1002, tiles: ["1111","1111","1111","1111"] },
    construction_tiles: { sheet_id: 1003, tiles: ["0000","0000","0000","0000"] },
    entities: [
      { species_id: 1006, frame: { x: 0, y: 0, w: 3, h: 3 } },
      { species_id: 1019, destination: null,
        frame: { x: 1, y: 2, w: 1, h: 1 } },
    ],
  });
  assert.equal(isEntityBlocked(w, 1, 2), true);
});
