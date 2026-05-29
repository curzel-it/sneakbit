// Mob AI uses pure helpers we can test directly. The full tick imports
// zone.js (no DOM) so we can run it end-to-end too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js?v=20260529a";
import { tickMobs, chaseDirections } from "../js/mobs.js?v=20260529a";

// Minimal species table: one chase monster, one wandering NPC, one wall.
loadSpeciesData([
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 4001, entity_type: "Npc", sprite_sheet_id: 1014,
    movement_directions: "Free",
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

function makeZone(walk = () => true) {
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
  const zone = makeZone();
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 }, direction: "Down" };
  zone.entities.push(mob);
  const player = { tileX: 8, tileY: 6, x: 8, y: 6 };
  // First tick: AI bootstraps + starts a chase step.
  tickMobs(zone, player, 0.02);
  assert.ok(mob._ai, "ai state created");
  assert.ok(mob._ai.step, "chase step started");
  assert.equal(mob._ai.step.toX, 6); // stepped right
  assert.equal(mob._ai.step.toY, 5);
  // After enough dt to complete the step, the mob snaps to the new tile.
  tickMobs(zone, player, 1.0);
  assert.equal(mob._ai.tileX, 6);
  assert.equal(mob._ai.tileY, 5);
  assert.equal(mob._ai.step, null);
});

test("FindHero mob wanders when the player is out of vision range", () => {
  const zone = makeZone();
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  zone.entities.push(mob);
  // Player far away (Manhattan distance > VISION_TILES=6).
  const player = { tileX: 19, tileY: 19 };
  tickMobs(zone, player, 0.02);
  assert.ok(mob._ai.step, "wander step started even though player is out of vision");
});

test("FindHero mob is blocked by every tile of a multi-tile rigid entity", () => {
  // Load a "Building" species: 4 wide × 4 tall, rigid. Mirrors the house
  // sprite from monster-over-house.png — without the multi-tile footprint
  // check, mobs could walk through every tile except the bottom-left.
  loadSpeciesData([
    { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
      movement_directions: "FindHero", dps: 100, hp: 200,
      sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
    { id: 1100, entity_type: "Building", is_rigid: true, sprite_sheet_id: 1014,
      width: 4, height: 4, sprite_frame: { x: 0, y: 0, w: 4, h: 4 } },
  ]);
  const zone = makeZone();
  // Building covers (10..13, 10..13). Place the mob next to its east wall.
  zone.entities.push({ species_id: 1100, frame: { x: 10, y: 10, w: 4, h: 4 } });
  const mob = { species_id: 4004, frame: { x: 14, y: 11, w: 1, h: 2 } };
  zone.entities.push(mob);
  // Player is two tiles west of the mob — chase wants to go 'left' into
  // the building's middle row. That tile should be blocked.
  const player = { tileX: 12, tileY: 12 };
  tickMobs(zone, player, 0.02);
  // Mob should NOT have stepped onto a tile inside the building. The
  // chase 'left' tile (13, 12) is inside the footprint. If unblocked,
  // pre-fix code happily moves there.
  if (mob._ai.step) {
    const { toX, toY } = mob._ai.step;
    assert.ok(!(toX >= 10 && toX < 14 && toY >= 10 && toY < 14),
      `mob walked into building footprint at (${toX}, ${toY})`);
  }
});

test("FindHero mob targets the closest live player in co-op", () => {
  loadSpeciesData([
    { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
      movement_directions: "FindHero", dps: 100, hp: 200,
      sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  ]);
  const zone = makeZone();
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  zone.entities.push(mob);
  // P1 is far (out of vision), P2 is right next door. The mob should
  // chase P2, not stand around because the old code only saw P1.
  const p1 = { tileX: 18, tileY: 18 };
  const p2 = { tileX: 7, tileY: 6 };
  tickMobs(zone, [p1, p2], 0.02);
  assert.ok(mob._ai.step, "chase step started");
  // Moves toward P2's tile (dx=+2, dy=+1 → 'right' first).
  assert.equal(mob._ai.step.toX, 6);
  assert.equal(mob._ai.step.toY, 5);
});

test("FindHero mob falls back to the secondary direction when primary is blocked", () => {
  // Wall directly to the right of the mob's feet tile.
  const zone = makeZone((c, r) => !(c === 6 && r === 6));
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  zone.entities.push(mob);
  // Player to the lower-right: primary 'right' is blocked, secondary
  // 'down' should be picked instead.
  const player = { tileX: 8, tileY: 7 };
  tickMobs(zone, player, 0.02);
  assert.equal(mob._ai.step.toX, 5);
  assert.equal(mob._ai.step.toY, 6);
});
