import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js?v=20260529b");

// Boss 4008 ("grapevine") spawns minion 4009 ("grapeberry") when the
// player is in line of sight but out of melee range. Minion is a normal
// 1×1 CloseCombatMonster that the FindHero AI then takes over.
loadSpeciesData([
  { id: 4008, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    hp: 4800, dps: 170, base_speed: 1.4, movement_directions: "FindHero",
    bullet_species_id: 4009, cooldown_after_use: 1.0,
    sprite_frame: { x: 0, y: 0, w: 2, h: 3 } },
  { id: 4009, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    hp: 80, dps: 80, base_speed: 3.0, movement_directions: "FindHero",
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

const { tickMinionSpawning, _resetMinionsForTesting } = await import("../js/minions.js?v=20260529b");

function makeZone(entities) {
  return { id: 1, cols: 30, rows: 30, entities };
}

test("boss spawns a minion once the cooldown elapses and player is in range", () => {
  _resetMinionsForTesting();
  const boss = { id: 1, species_id: 4008, direction: "Right",
                 frame: { x: 5, y: 5, w: 2, h: 3 } };
  const player = { x: 12, y: 6, tileX: 12, tileY: 6 };
  const zone = makeZone([boss]);

  // First tick consumes the (initially zero) cooldown and spawns.
  tickMinionSpawning(zone, player, 0.5);
  assert.equal(zone.entities.length, 2);
  assert.equal(zone.entities[1].species_id, 4009);
});

test("no spawn while player is in melee range (< 3.5 tiles centre-to-centre)", () => {
  _resetMinionsForTesting();
  const boss = { id: 1, species_id: 4008, direction: "Down",
                 frame: { x: 5, y: 5, w: 2, h: 3 } };
  const player = { x: 6, y: 7, tileX: 6, tileY: 7 }; // adjacent to boss
  const zone = makeZone([boss]);
  tickMinionSpawning(zone, player, 1.0);
  assert.equal(zone.entities.length, 1);
});

test("cooldown gates subsequent spawns", () => {
  _resetMinionsForTesting();
  const boss = { id: 1, species_id: 4008, direction: "Right",
                 frame: { x: 5, y: 5, w: 2, h: 3 } };
  const player = { x: 15, y: 6, tileX: 15, tileY: 6 };
  const zone = makeZone([boss]);

  tickMinionSpawning(zone, player, 0.1);
  assert.equal(zone.entities.length, 2);
  // Immediately tick again — the boss should be on cooldown.
  tickMinionSpawning(zone, player, 0.1);
  assert.equal(zone.entities.length, 2);
  // After enough time the cooldown clears and a second minion spawns.
  tickMinionSpawning(zone, player, 3.0);
  assert.equal(zone.entities.length, 3);
});

test("non-boss monsters never spawn minions", () => {
  _resetMinionsForTesting();
  const other = { id: 1, species_id: 4009, direction: "Right",
                  frame: { x: 5, y: 5, w: 1, h: 1 } };
  const player = { x: 15, y: 6, tileX: 15, tileY: 6 };
  const zone = makeZone([other]);
  tickMinionSpawning(zone, player, 5.0);
  assert.equal(zone.entities.length, 1);
});
