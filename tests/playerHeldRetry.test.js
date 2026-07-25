import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlayer, updatePlayer } from "../js/player.js";
import { BIOME } from "../js/biomes.js";

// 3×1 strip of plain grass. Tile 1 starts blocked (stand-in for the barrel);
// clearing the collision cell mid-test simulates the barrel blowing up.
function makeZone(blockedX = -1) {
  const collision = [[0, 0, 0]];
  if (blockedX >= 0) collision[0][blockedX] = 1;
  return {
    cols: 3,
    rows: 1,
    biome: [[BIOME.GRASS, BIOME.GRASS, BIOME.GRASS]],
    collision,
    entities: [],
  };
}

function facingRightAt(tileX) {
  const p = createPlayer();
  p.tileX = tileX;
  p.tileY = 0;
  p.x = tileX;
  p.y = 0;
  p.direction = "right";
  return p;
}

test("holding into a blocked tile resumes stepping once the blocker is gone", () => {
  const zone = makeZone(1);
  const p = facingRightAt(0);
  const held = new Set(["right"]);

  // Initial press into the barrel: blocked, no step.
  updatePlayer(p, { events: ["right"], held }, 0.016, zone);
  assert.equal(p.step, null, "should not step into the barrel");

  // Key stays down; no new press events (OS key repeat produces none).
  updatePlayer(p, { events: [], held }, 0.016, zone);
  assert.equal(p.step, null, "still blocked");

  // Barrel blows up.
  zone.collision[0][1] = 0;

  updatePlayer(p, { events: [], held }, 0.016, zone);
  assert.ok(p.step, "should start stepping now the tile is free");
  assert.equal(p.step.toX, 1);
});

test("a tap in a new direction still only rotates (commit delay preserved)", () => {
  const zone = makeZone();
  const p = facingRightAt(1);

  updatePlayer(p, { events: ["down"], held: new Set(["down"]) }, 0.001, zone);
  assert.equal(p.direction, "down");
  assert.equal(p.step, null, "rotate should not commit a step immediately");

  // Released before the commit delay → rotation only.
  updatePlayer(p, { events: [], held: new Set() }, 0.001, zone);
  assert.equal(p.step, null, "tap must not step");
});
