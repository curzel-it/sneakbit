import { test } from "node:test";
import assert from "node:assert/strict";

const { BIOME } = await import("../js/biomes.js?v=20260529b");
const { tickTrails } = await import("../js/trails.js?v=20260529b");

function makeZone(biomeCell) {
  const rows = 5, cols = 5;
  const biome = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(biomeCell);
    biome.push(row);
  }
  return { id: 1, rows, cols, biome, entities: [] };
}

test("no trail on grass, even after several tile steps", () => {
  const zone = makeZone(BIOME.GRASS);
  // First tick seeds the lastTile cache without dropping a trail.
  tickTrails(zone, { tileX: 1, tileY: 1, direction: "down" }, 0.016);
  tickTrails(zone, { tileX: 1, tileY: 2, direction: "down" }, 0.016);
  tickTrails(zone, { tileX: 1, tileY: 3, direction: "down" }, 0.016);
  assert.equal(zone._trails.length, 0);
});

test("snow drops a footstep at the previous tile when player moves", () => {
  const zone = makeZone(BIOME.SNOW);
  tickTrails(zone, { tileX: 1, tileY: 1, direction: "down" }, 0.016);
  tickTrails(zone, { tileX: 1, tileY: 2, direction: "down" }, 0.016);
  assert.equal(zone._trails.length, 1);
  assert.equal(zone._trails[0].x, 1);
  // y of trail sprite is one tile below the *previous* foot tile.
  assert.equal(zone._trails[0].y, 2);
  assert.equal(zone._trails[0].direction, "down");
});

test("trails decay and disappear after their lifespan", () => {
  const zone = makeZone(BIOME.SNOW);
  tickTrails(zone, { tileX: 1, tileY: 1, direction: "down" }, 0.016);
  tickTrails(zone, { tileX: 1, tileY: 2, direction: "down" }, 0.016);
  assert.equal(zone._trails.length, 1);
  // Lifespan is 15/8 ≈ 1.875s — advance well past it.
  tickTrails(zone, { tileX: 1, tileY: 2, direction: "down" }, 5.0);
  assert.equal(zone._trails.length, 0);
});

test("trail cache is per-zone (teleport between zones resets it)", () => {
  const a = makeZone(BIOME.SNOW);
  const b = makeZone(BIOME.SNOW);
  tickTrails(a, { tileX: 1, tileY: 1, direction: "down" }, 0.016);
  // Switch to a fresh zone with the same player position — first tick
  // in `b` shouldn't immediately drop a trail.
  tickTrails(b, { tileX: 1, tileY: 1, direction: "down" }, 0.016);
  assert.equal(b._trails.length, 0);
});
