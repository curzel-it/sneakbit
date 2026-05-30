// Building-prefab expansion. Mirrors Rust prefabs::all::new_building's
// dispatch + emits a buffered interior zone per source-side door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js?v=20260530a";
import { tryBuildingPrefab } from "../js/prefabs.js?v=20260530a";

// Minimal species fixtures: the building entries the prefab map recognises,
// plus the auxiliary species the interior populates (teleporter, table,
// seats, stairs, shop clerk).
loadSpeciesData([
  // Single-floor house species.
  { id: 1002, entity_type: "Building", sprite_sheet_id: 1004,
    sprite_frame: { x: 0, y: 1, w: 5, h: 4 } },
  // Two-floor house species.
  { id: 1005, entity_type: "Building", sprite_sheet_id: 1004,
    sprite_frame: { x: 5, y: 0, w: 5, h: 5 } },
  // Small house species (4×3).
  { id: 1033, entity_type: "Building", sprite_sheet_id: 1004,
    sprite_frame: { x: 0, y: 0, w: 4, h: 3 } },
  // Shop species.
  { id: 1070, entity_type: "Building", sprite_sheet_id: 1004,
    sprite_frame: { x: 0, y: 0, w: 5, h: 4 } },
  // Building that isn't in the prefab table — should NOT expand.
  { id: 9999, entity_type: "Building", sprite_sheet_id: 1004,
    sprite_frame: { x: 0, y: 0, w: 5, h: 4 } },
  // Auxiliary species the interior populates.
  { id: 1019, entity_type: "Teleporter",  sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 5, w: 1, h: 1 } },
  { id: 1016, entity_type: "StaticObject", sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 2, h: 2 } },
  { id: 1013, entity_type: "StaticObject", sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 1010, entity_type: "StaticObject", sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 1011, entity_type: "StaticObject", sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 3008, entity_type: "Npc", sprite_sheet_id: 1009,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
]);

const SOURCE = 1001;

test("non-prefab building (unknown id) → null, single-entity fallback", () => {
  assert.equal(tryBuildingPrefab(9999, SOURCE, 10, 10), null);
});

test("single-floor house emits building + door + one interior zone", () => {
  const out = tryBuildingPrefab(1002, SOURCE, 40, 20);
  assert.ok(out, "prefab should match");
  assert.equal(out.entities.length, 2, "one building + one door teleporter");
  const [building, door] = out.entities;
  assert.equal(building.species_id, 1002);
  assert.equal(building.frame.x, 40);
  assert.equal(building.frame.y, 20);
  assert.equal(building.frame.w, 5);
  assert.equal(building.frame.h, 4);
  // Door sits at the middle-bottom of the building.
  assert.equal(door.species_id, 1019);
  assert.equal(door.frame.x, 40 + 3); // ceil(5/2) = 3
  assert.equal(door.frame.y, 20 + 3);
  // Door destination resolves to a freshly-generated interior zone id.
  assert.ok(door.destination && door.destination.world > 0);
  assert.equal(out.interiorZones.length, 1);
  assert.equal(out.interiorZones[0].id, door.destination.world);
});

test("interior zone has the right shell: floor, walls, back-doors", () => {
  const out = tryBuildingPrefab(1002, SOURCE, 0, 0);
  const interior = out.interiorZones[0];
  assert.equal(interior.world_type, "HouseInterior");
  // 30 cols × 10 rows is the bounds Rust ships with.
  assert.equal(interior.biome_tiles.tiles.length, 10);
  assert.equal(interior.biome_tiles.tiles[0].length, 30);
  // Floor: row 4, col 5 is dark wood (within the 6×10 interior).
  assert.equal(interior.biome_tiles.tiles[4][5], "6");
  // Wall: row 0, col 1 is LightWall.
  assert.equal(interior.construction_tiles.tiles[0][1], "4");
  // Back-door cutouts at row 8, cols 5 and 6 stay as Nothing (no wall).
  assert.equal(interior.construction_tiles.tiles[8][5], "0");
  assert.equal(interior.construction_tiles.tiles[8][6], "0");
  // Two teleporters in the interior point back to the source zone.
  const backs = interior.entities.filter(
    (e) => e.species_id === 1019 && e.destination?.world === SOURCE,
  );
  assert.equal(backs.length, 2);
  assert.deepEqual(backs.map((e) => e.frame.x).sort(), [5, 6]);
  assert.equal(backs[0].frame.y, 8);
});

test("two-floor house: door points to first floor, stairs link first → second", () => {
  const out = tryBuildingPrefab(1005, SOURCE, 0, 0);
  const [, door] = out.entities;
  // Two-floor door y-offset is +4.
  assert.equal(door.frame.y, 4);
  assert.equal(out.interiorZones.length, 2);
  const [first, second] = out.interiorZones;
  assert.equal(door.destination.world, first.id);
  // First floor contains a teleporter pointing to the second floor.
  const upDoor = first.entities.find(
    (e) => e.species_id === 1019 && e.destination?.world === second.id,
  );
  assert.ok(upDoor, "first floor has a stairs-up teleporter");
  // Second floor has a teleporter back to the first floor.
  const downDoor = second.entities.find(
    (e) => e.species_id === 1019 && e.destination?.world === first.id,
  );
  assert.ok(downDoor, "second floor has a stairs-down teleporter");
  // Second floor has NO back-door to the source — return is via stairs only.
  const backToSource = second.entities.find(
    (e) => e.species_id === 1019 && e.destination?.world === SOURCE,
  );
  assert.equal(backToSource, undefined);
});

test("small house: door y-offset is +2 (smaller building)", () => {
  const out = tryBuildingPrefab(1033, SOURCE, 0, 0);
  const [building, door] = out.entities;
  assert.equal(building.frame.w, 4);
  assert.equal(door.frame.x, Math.ceil(4 / 2));
  assert.equal(door.frame.y, 2);
});

test("shop: interior has counter + library construction blocks + clerk NPC", () => {
  const out = tryBuildingPrefab(1070, SOURCE, 0, 0);
  const interior = out.interiorZones[0];
  // Counter (id 5 → char "5") tile at one of the cluster positions.
  assert.equal(interior.construction_tiles.tiles[3][5], "5");
  // Library (id 6 → char "6") tile.
  assert.equal(interior.construction_tiles.tiles[1][1], "6");
  // Clerk NPC present, head row 1, w=1, h=2.
  const clerk = interior.entities.find((e) => e.species_id === 3008);
  assert.ok(clerk);
  assert.equal(clerk.frame.y, 1);
  assert.equal(clerk.frame.h, 2);
});

test("non-Building species returns null (NPCs, items, etc.)", () => {
  // 3008 is the shop clerk — an NPC, not a Building.
  assert.equal(tryBuildingPrefab(3008, SOURCE, 10, 10), null);
});

test("editor entity ids are negative (so the eraser keeps shipped entities)", () => {
  const out = tryBuildingPrefab(1002, SOURCE, 0, 0);
  for (const e of out.entities) {
    assert.ok(e.id < 0, `editor entity id should be negative, got ${e.id}`);
  }
  for (const e of out.interiorZones[0].entities) {
    assert.ok(e.id < 0, `interior entity id should be negative, got ${e.id}`);
  }
});

test("interior zone ids are unique across back-to-back placements", () => {
  const a = tryBuildingPrefab(1002, SOURCE, 0, 0);
  const b = tryBuildingPrefab(1002, SOURCE, 10, 10);
  assert.notEqual(a.interiorZones[0].id, b.interiorZones[0].id);
});

test("interior zone id fits in int32 (storage.js coerces via `n | 0`)", () => {
  // js/storage.js stores numeric values as int32 (n | 0). A larger id
  // would truncate when latest_world is saved, so the player would
  // reload into a non-existent zone. This regression test pins the
  // contract: interior ids must round-trip through int32 unchanged.
  const INT32_MAX = 2 ** 31 - 1;
  const out = tryBuildingPrefab(1002, SOURCE, 0, 0);
  for (const w of out.interiorZones) {
    assert.ok(
      w.id > 0 && w.id <= INT32_MAX,
      `interior id ${w.id} must fit in [1, ${INT32_MAX}]`,
    );
    assert.equal((w.id | 0), w.id, `id ${w.id} survives int32 round-trip`);
  }
});
