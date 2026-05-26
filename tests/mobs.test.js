// Mob AI uses pure helpers we can test directly. The full tick imports
// world.js (no DOM) so we can run it end-to-end too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";
import { tickMobs, chaseDirections } from "../js/mobs.js";

// Minimal species table: one chase monster, one wandering NPC, one wall.
loadSpeciesData([
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 4001, entity_type: "Npc", sprite_sheet_id: 1014,
    movement_directions: "Free",
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

function makeWorld(walk = () => true) {
  return { cols: 20, rows: 20, entities: [], collision: makeCollision(20, 20, walk) };
}

function makeCollision(rows, cols, walk) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(!walk(c, r));
    grid.push(row);
  }
  return grid;
}

test("chaseDirections returns nothing when player is out of vision range", () => {
  const e = { _ai: { tileX: 0, tileY: 0, h: 1 } };
  const player = { tileX: 12, tileY: 0 };
  assert.deepEqual(chaseDirections(e, player), []);
});

test("chaseDirections targets the longer-axis direction first", () => {
  const e = { _ai: { tileX: 5, tileY: 5, h: 1 } };
  const right = { tileX: 8, tileY: 6 };  // dx 3, dy 1 → right first
  assert.deepEqual(chaseDirections(e, right), ["right", "down"]);
  const up = { tileX: 4, tileY: 1 };     // dy 4, dx -1 → up first
  assert.deepEqual(chaseDirections(e, up), ["up", "left"]);
});

test("FindHero mob takes a step toward the player on tick", () => {
  const world = makeWorld();
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 }, direction: "Down" };
  world.entities.push(mob);
  const player = { tileX: 8, tileY: 6, x: 8, y: 6 };
  // First tick: AI bootstraps + starts a chase step.
  tickMobs(world, player, 0.02);
  assert.ok(mob._ai, "ai state created");
  assert.ok(mob._ai.step, "chase step started");
  assert.equal(mob._ai.step.toX, 6); // stepped right
  assert.equal(mob._ai.step.toY, 5);
  // After enough dt to complete the step, the mob snaps to the new tile.
  tickMobs(world, player, 1.0);
  assert.equal(mob._ai.tileX, 6);
  assert.equal(mob._ai.tileY, 5);
  assert.equal(mob._ai.step, null);
});

test("FindHero mob wanders when the player is out of vision range", () => {
  const world = makeWorld();
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  world.entities.push(mob);
  // Player far away (Manhattan distance > VISION_TILES=6).
  const player = { tileX: 19, tileY: 19 };
  tickMobs(world, player, 0.02);
  assert.ok(mob._ai.step, "wander step started even though player is out of vision");
});

test("FindHero mob falls back to the secondary direction when primary is blocked", () => {
  // Wall directly to the right of the mob's feet tile.
  const world = makeWorld((c, r) => !(c === 6 && r === 6));
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  world.entities.push(mob);
  // Player to the lower-right: primary 'right' is blocked, secondary
  // 'down' should be picked instead.
  const player = { tileX: 8, tileY: 7 };
  tickMobs(world, player, 0.02);
  assert.equal(mob._ai.step.toX, 5);
  assert.equal(mob._ai.step.toY, 6);
});
