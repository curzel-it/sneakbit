// Covers findFacingEntity's "reach over a counter" behaviour: the player
// should be able to talk to a clerk standing behind a non-walkable desk,
// but not to an NPC across open floor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findFacingEntity } from "../js/interact.js";
import { loadSpeciesData } from "../js/species.js";

// Builds a zone with a collision grid. `blocked` is a set of "x,y" tile
// keys that are non-walkable. isWalkable() reads zone.collision[y][x].
function makeZone(cols, rows, blocked = new Set(), entities = []) {
  const collision = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) row.push(blocked.has(`${x},${y}`));
    collision.push(row);
  }
  return { cols, rows, collision, entities };
}

function clerk(tileX, tileY) {
  return { frame: { x: tileX, y: tileY, w: 1, h: 1 }, dialogues: [{ text: "hi" }] };
}

test("talks to an NPC directly in front", () => {
  const npc = clerk(5, 4);
  const zone = makeZone(10, 10, new Set(), [npc]);
  const player = { tileX: 5, tileY: 5, direction: "up" };
  assert.equal(findFacingEntity(zone, player), npc);
});

test("reaches a clerk across a non-walkable counter", () => {
  const npc = clerk(5, 3);
  // The counter at (5,4) sits between the player (5,5) and the clerk (5,3).
  const zone = makeZone(10, 10, new Set(["5,4"]), [npc]);
  const player = { tileX: 5, tileY: 5, direction: "up" };
  assert.equal(findFacingEntity(zone, player), npc);
});

test("does NOT reach an NPC across open floor", () => {
  const npc = clerk(5, 3);
  // Nothing blocking at (5,4): the gap is walkable, so the far NPC is out of range.
  const zone = makeZone(10, 10, new Set(), [npc]);
  const player = { tileX: 5, tileY: 5, direction: "up" };
  assert.equal(findFacingEntity(zone, player), null);
});

test("reach respects facing direction", () => {
  const npc = clerk(5, 3);
  const zone = makeZone(10, 10, new Set(["5,4"]), [npc]);
  const player = { tileX: 5, tileY: 5, direction: "down" };
  assert.equal(findFacingEntity(zone, player), null);
});

test("ignores entities without dialogue", () => {
  const wall = { frame: { x: 5, y: 4, w: 1, h: 1 }, dialogues: [] };
  const zone = makeZone(10, 10, new Set(["5,4"]), [wall]);
  const player = { tileX: 5, tileY: 5, direction: "up" };
  assert.equal(findFacingEntity(zone, player), null);
});

test("ignores Hint signs even though they carry dialogue (toast-only, no talk affordance)", () => {
  // Hints store their walk-over toast text in `dialogues`, but they're
  // proximity-triggered (pickups.js) and must not light up the interact
  // prompt or be talk-able.
  loadSpeciesData([{ id: 42, name: "hint", entity_type: "Hint" }]);
  const hint = { species_id: 42, frame: { x: 5, y: 4, w: 1, h: 1 }, dialogues: [{ text: "tip" }] };
  const zone = makeZone(10, 10, new Set(["5,4"]), [hint]);
  const player = { tileX: 5, tileY: 5, direction: "up" };
  assert.equal(findFacingEntity(zone, player), null);
});
