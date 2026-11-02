import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlayer, updatePlayer, getPlayerSpriteFrame } from "../js/player.js";
import { BIOME } from "../js/biomes.js";

// A 5×1 strip: ice on tiles 0–2, grass on 3–4.
function makeStripZone() {
  return {
    cols: 5,
    rows: 1,
    biome: [[BIOME.ICE, BIOME.ICE, BIOME.ICE, BIOME.GRASS, BIOME.GRASS]],
    collision: [[0, 0, 0, 0, 0]],
    entities: [],
  };
}

function at(x) {
  const p = createPlayer();
  p.x = x; p.y = 0; p.tileX = x; p.tileY = 0;
  p.direction = "right";
  return p;
}

test("a slide on ice renders the idle pose, not the walk cycle", () => {
  const zone = makeStripZone();
  const p = at(0);
  updatePlayer(p, { events: ["right"], held: new Set(["right"]) }, 0.016, zone);
  assert.equal(p._slide, "right");
  assert.equal(p.moving, false, "moving should be false while sliding on ice");
  const frame = getPlayerSpriteFrame(p);
  assert.equal(frame.y, p.baseFrame.y + 3 * p.baseFrame.h, "uses the still row");
});

test("a slide keeps going without input until it leaves the ice", () => {
  const zone = makeStripZone();
  const p = at(0);
  updatePlayer(p, { events: ["right"], held: new Set(["right"]) }, 0.016, zone);
  for (let i = 0; i < 200 && p.tileX < 3; i++) updatePlayer(p, { events: [], held: new Set(["up"]) }, 0.016, zone);
  assert.equal(p.tileX, 3, "slid onto the first grass tile");
  assert.equal(p.y, 0, "input could not steer the slide");
  updatePlayer(p, { events: [], held: new Set() }, 0.016, zone);
  assert.equal(p._slide, null, "the slide ends off the ice");
});

test("walking on solid ground animates the walk cycle", () => {
  const zone = makeStripZone();
  const p = at(4);
  p.direction = "left";
  updatePlayer(p, { events: ["left"], held: new Set(["left"]) }, 0.016, zone);
  assert.equal(p.moving, true);
  const frame = getPlayerSpriteFrame(p);
  assert.equal(frame.y, p.baseFrame.y + 6 * p.baseFrame.h, "uses the moving row");
});
