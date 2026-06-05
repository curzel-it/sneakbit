// Pure logic for demands-attention NPCs: the 4-direction line-of-sight scan
// and the storage-gated "is the mark armed" check. No DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spotPlayerFrom, isDemandingAttention } from "../js/npcInterception.js";
import { setValue, _resetStorageForTesting } from "../js/storage.js";

// Build a zone from an ASCII map: '#' blocked, anything else walkable.
// Matches zone.js::isWalkable (collision[y][x] truthy === blocked).
function grid(rows) {
  const collision = rows.map((r) => [...r].map((c) => c === "#"));
  return { cols: rows[0].length, rows: rows.length, collision };
}

const player = (tileX, tileY) => ({ tileX, tileY });

test("spots a player along each of the four cardinal directions", () => {
  const zone = grid([
    ".....",
    ".....",
    ".....",
    ".....",
    ".....",
  ]);
  // NPC foot tile at the centre (2,2).
  const up    = spotPlayerFrom(zone, 2, 2, [player(2, 0)]);
  const down  = spotPlayerFrom(zone, 2, 2, [player(2, 4)]);
  const left  = spotPlayerFrom(zone, 2, 2, [player(0, 2)]);
  const right = spotPlayerFrom(zone, 2, 2, [player(4, 2)]);
  assert.equal(up?.dir, "up");
  assert.equal(down?.dir, "down");
  assert.equal(left?.dir, "left");
  assert.equal(right?.dir, "right");
});

test("a wall mid-ray blocks detection beyond it", () => {
  const zone = grid([
    ".....",
    "..#..",  // wall at (2,1), between the NPC and the player
    ".....",
    ".....",
  ]);
  // NPC foot at (2,3) looking up; player at (2,0) sits past the wall at (2,1).
  assert.equal(spotPlayerFrom(zone, 2, 3, [player(2, 0)]), null);
});

test("respects the sight range", () => {
  // A tall clear column so only distance — not a wall — limits the scan.
  const zone = grid(Array.from({ length: 9 }, () => "..."));
  // Default range is 5: distance 5 is spotted, distance 6 is not.
  assert.equal(spotPlayerFrom(zone, 1, 6, [player(1, 1)])?.dir, "up"); // dist 5
  assert.equal(spotPlayerFrom(zone, 1, 7, [player(1, 1)]), null);      // dist 6
});

test("ignores a player off the cardinal axes", () => {
  const zone = grid([
    ".....",
    ".....",
    ".....",
  ]);
  const hit = spotPlayerFrom(zone, 2, 2, [player(4, 0)]); // diagonal
  assert.equal(hit, null);
});

test("isDemandingAttention is gated by the npc_interactions flag", () => {
  _resetStorageForTesting();
  const npc = { id: 4242, demands_attention: true };
  assert.equal(isDemandingAttention(npc), true, "armed before any encounter");
  setValue("npc_interactions.4242", 1);
  assert.equal(isDemandingAttention(npc), false, "disarmed once persisted");

  assert.equal(isDemandingAttention({ id: 7, demands_attention: false }), false);
  assert.equal(isDemandingAttention(null), false);
  _resetStorageForTesting();
});
