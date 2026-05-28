import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZone, isWalkable, isEntityBlocked } from "../js/zone.js?v=20260528c";
import { loadSpeciesData } from "../js/species.js?v=20260528c";
import { _setCreativeModeForTesting } from "../js/creativeMode.js?v=20260528c";

loadSpeciesData([
  { id: 1006, entity_type: "Building", is_rigid: true, sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 5, h: 5 } },
  { id: 1019, entity_type: "Teleporter", is_rigid: false, sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 3007, entity_type: "Npc", is_rigid: true, sprite_sheet_id: 1009,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 2010, entity_type: "Gate", is_rigid: true, sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

const storage = await import("../js/storage.js?v=20260528c");

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

test("buildZone produces correct dimensions and tile grids", () => {
  const w = buildZone(TINY);
  assert.equal(w.rows, 4);
  assert.equal(w.cols, 4);
  assert.ok(Array.isArray(w.biome));
  assert.ok(Array.isArray(w.biomeCol));
  assert.ok(Array.isArray(w.construction));
  assert.ok(Array.isArray(w.constructionRow));
  assert.ok(Array.isArray(w.collision));
});

test("walkability: grass walkable, water blocked, bridge over water walkable, forest blocked", () => {
  const w = buildZone(TINY);
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
  const w = buildZone(TINY);
  assert.equal(isWalkable(w, -1, 0), false);
  assert.equal(isWalkable(w, 0, -1), false);
  assert.equal(isWalkable(w, 4, 0), false);
  assert.equal(isWalkable(w, 0, 4), false);
});

test("destination-teleporter on a building tile is enterable", () => {
  const w = buildZone({
    ...TINY,
    biome_tiles: { sheet_id: 1002, tiles: ["1111","1111","1111","1111"] },
    construction_tiles: { sheet_id: 1003, tiles: ["0000","0000","0000","0000"] },
    entities: [
      { species_id: 1006, frame: { x: 0, y: 0, w: 3, h: 3 } },
      { species_id: 1019, destination: { zone: 42, x: 0, y: 0 },
        frame: { x: 1, y: 2, w: 1, h: 1 } },
    ],
  });
  assert.equal(isEntityBlocked(w, 1, 2), false);
  assert.equal(isEntityBlocked(w, 0, 0), true);
});

test("teleporter without destination does not unblock the building", () => {
  const w = buildZone({
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

test("NPC 1x2 only blocks its feet tile, head tile is walkable", () => {
  storage._resetStorageForTesting();
  const w = buildZone({
    ...TINY,
    biome_tiles: { sheet_id: 1002, tiles: ["1111","1111","1111","1111"] },
    construction_tiles: { sheet_id: 1003, tiles: ["0000","0000","0000","0000"] },
    entities: [
      { id: 1, species_id: 3007, frame: { x: 1, y: 1, w: 1, h: 2 } },
    ],
  });
  // Head row free, feet row blocked.
  assert.equal(isEntityBlocked(w, 1, 1), false);
  assert.equal(isEntityBlocked(w, 1, 2), true);
});

test("creative mode walks through Building and closed Gate (is_rigid dropped)", () => {
  storage._resetStorageForTesting();
  const w = buildZone({
    ...TINY,
    biome_tiles: { sheet_id: 1002, tiles: ["1111","1111","1111","1111"] },
    construction_tiles: { sheet_id: 1003, tiles: ["0000","0000","0000","0000"] },
    entities: [
      { species_id: 1006, frame: { x: 0, y: 0, w: 3, h: 3 } },
      { id: 5, species_id: 2010, frame: { x: 3, y: 3, w: 1, h: 1 } },
    ],
  });
  // Non-creative: building blocks (0,0); closed gate blocks (3,3).
  _setCreativeModeForTesting(false);
  assert.equal(isEntityBlocked(w, 0, 0), true);
  assert.equal(isEntityBlocked(w, 3, 3), true);
  // Creative: both pass through.
  _setCreativeModeForTesting(true);
  assert.equal(isEntityBlocked(w, 0, 0), false);
  assert.equal(isEntityBlocked(w, 3, 3), false);
  _setCreativeModeForTesting(false);
});

test("entity hidden by display_conditions does not block", () => {
  storage._resetStorageForTesting();
  const w = buildZone({
    ...TINY,
    biome_tiles: { sheet_id: 1002, tiles: ["1111","1111","1111","1111"] },
    construction_tiles: { sheet_id: 1003, tiles: ["0000","0000","0000","0000"] },
    entities: [
      { id: 7, species_id: 3007, frame: { x: 1, y: 1, w: 1, h: 2 },
        display_conditions: [
          { expected_value: 1, key: "always", visible: false },
        ] },
    ],
  });
  // Hidden NPC: feet tile is still walkable.
  assert.equal(isEntityBlocked(w, 1, 2), false);
});
