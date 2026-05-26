// Visibility filter: mirrors Rust's `update_hitmaps` so only entities
// inside the camera viewport (plus a few always-visible types) end up
// in `world.visibleEntities` and get an `_visible` flag set on the
// entity object.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";
import { updateVisibleEntities } from "../js/worldVisibility.js";

loadSpeciesData([
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 1001, entity_type: "PressurePlate", is_rigid: false, sprite_sheet_id: 1014,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 1100, entity_type: "Building", is_rigid: true, sprite_sheet_id: 1014,
    width: 4, height: 4, sprite_frame: { x: 0, y: 0, w: 4, h: 4 } },
]);

function camera(x, y, w = 30, h = 20) { return { x, y, w, h }; }

test("entities inside the viewport are marked visible, others are not", () => {
  const inside  = { species_id: 1100, frame: { x: 10, y: 10, w: 4, h: 4 } };
  const outside = { species_id: 1100, frame: { x: 80, y: 80, w: 4, h: 4 } };
  const world = { entities: [inside, outside] };
  updateVisibleEntities(world, camera(5, 5));
  assert.equal(inside._visible, true);
  assert.equal(outside._visible, false);
  assert.deepEqual(world.visibleEntities, [inside]);
});

test("pressure plates stay visible even when off-screen", () => {
  const plate = { species_id: 1001, frame: { x: 200, y: 200, w: 1, h: 1 } };
  const world = { entities: [plate] };
  updateVisibleEntities(world, camera(0, 0));
  assert.equal(plate._visible, true);
  assert.deepEqual(world.visibleEntities, [plate]);
});

test("spawned bullets always count as visible", () => {
  const bullet = { _spawned: true, species_id: 7000, frame: { x: 999, y: 999, w: 1, h: 1 } };
  const world = { entities: [bullet] };
  updateVisibleEntities(world, camera(0, 0));
  assert.equal(bullet._visible, true);
  assert.deepEqual(world.visibleEntities, [bullet]);
});

test("an entity exactly touching the viewport edge is still visible", () => {
  const e = { species_id: 4004, frame: { x: 30, y: 10, w: 1, h: 2 } };
  const world = { entities: [e] };
  updateVisibleEntities(world, camera(0, 0, 30, 20));
  assert.equal(e._visible, true);
});
