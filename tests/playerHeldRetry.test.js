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

test("holding into a blocked tile resumes walking once the blocker is gone", () => {
  const zone = makeZone(1);
  const p = facingRightAt(0);
  const held = new Set(["right"]);

  updatePlayer(p, { events: ["right"], held }, 0.016, zone);
  for (let i = 0; i < 20; i++) updatePlayer(p, { events: [], held }, 0.016, zone);
  assert.ok(p.x < 0.25, `stopped against the barrel, x=${p.x}`);
  assert.equal(p.tileX, 0);

  zone.collision[0][1] = 0;

  for (let i = 0; i < 6; i++) updatePlayer(p, { events: [], held }, 0.016, zone);
  assert.ok(p.x > 0.5, `walks on once the tile is free, x=${p.x}`);
  assert.equal(p.tileX, 1);
});

test("a one-frame tap in a new direction turns without moving", () => {
  const zone = makeZone();
  const p = facingRightAt(1);

  updatePlayer(p, { events: ["down"], held: new Set() }, 0.016, zone);
  assert.equal(p.direction, "down");
  assert.equal(p.x, 1);
  assert.equal(p.y, 0);
});
