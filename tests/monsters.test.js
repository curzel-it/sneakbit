import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js?v=20260529a");

loadSpeciesData([
  { id: 4003, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    hp: 50,  sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    hp: 100, sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 4005, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    hp: 200, sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 4006, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    hp: 400, sprite_frame: { x: 0, y: 0, w: 2, h: 2 } },
  { id: 4007, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    hp: 800, sprite_frame: { x: 0, y: 0, w: 2, h: 3 } },
]);

const { tickMonsterFusion, isMonsterSpecies } = await import("../js/monsters.js?v=20260529a");

function makeZone(entities) {
  return { id: 1, cols: 30, rows: 30, entities, collision: [] };
}

test("isMonsterSpecies recognises the five monster tiers", () => {
  for (const id of [4003, 4004, 4005, 4006, 4007]) {
    assert.equal(isMonsterSpecies(id), true);
  }
  assert.equal(isMonsterSpecies(4008), false);
});

test("overlapping equal-tier monsters fuse into the next tier", () => {
  const a = { id: 1, species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  const b = { id: 2, species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  const zone = makeZone([a, b]);
  tickMonsterFusion(zone);
  // The higher-id `b` should be removed; `a` promoted to blueberry (4005).
  assert.equal(zone.entities.length, 1);
  assert.equal(zone.entities[0].species_id, 4005);
});

test("monsters that do not overlap don't fuse", () => {
  const a = { id: 1, species_id: 4004, frame: { x: 0, y: 0, w: 1, h: 2 } };
  const b = { id: 2, species_id: 4004, frame: { x: 10, y: 0, w: 1, h: 2 } };
  const zone = makeZone([a, b]);
  tickMonsterFusion(zone);
  assert.equal(zone.entities.length, 2);
  assert.equal(a.species_id, 4004);
});

test("small + blueberry → strawberry (lower tier absorbs into higher)", () => {
  const a = { id: 1, species_id: 4003, frame: { x: 5, y: 5, w: 1, h: 1 } };
  const b = { id: 2, species_id: 4005, frame: { x: 5, y: 5, w: 1, h: 2 } };
  const zone = makeZone([a, b]);
  tickMonsterFusion(zone);
  // b is higher-tier and higher-id → consumes a, promotes to strawberry.
  assert.equal(zone.entities.length, 1);
  assert.equal(zone.entities[0].id, 2);
  assert.equal(zone.entities[0].species_id, 4006);
});

test("gooseberry is the top tier — no further fusion", () => {
  const a = { id: 1, species_id: 4007, frame: { x: 5, y: 5, w: 2, h: 3 } };
  const b = { id: 2, species_id: 4007, frame: { x: 5, y: 5, w: 2, h: 3 } };
  const zone = makeZone([a, b]);
  tickMonsterFusion(zone);
  assert.equal(zone.entities.length, 2);
});

test("non-monster entities are ignored", () => {
  const a = { id: 1, species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  const tree = { id: 2, species_id: 9999, frame: { x: 5, y: 5, w: 1, h: 2 } };
  const zone = makeZone([a, tree]);
  tickMonsterFusion(zone);
  assert.equal(zone.entities.length, 2);
});
