import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, isWalkable } from "../js/world.js";

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
