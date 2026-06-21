import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlayer, updatePlayer, getPlayerSpriteFrame } from "../js/player.js";
import { BIOME } from "../js/biomes.js";

// A 3×1 strip: tile 0 is ice, tile 1 is grass, tile 2 is ice. Just enough for
// isTileSlippery (which only reads zone.biome / cols / rows).
function makeStripZone() {
  return {
    cols: 3,
    rows: 1,
    biome: [[BIOME.ICE, BIOME.GRASS, BIOME.ICE]],
  };
}

const EMPTY_INPUT = { events: [], held: new Set() };

// Park a player mid-slide on the given tile with a freshly-started step, then
// tick a tiny dt so the step lerps but does not snap. Returns the player.
function tickMidStep(tileX) {
  const p = createPlayer();
  p.tileX = tileX;
  p.tileY = 0;
  p.x = tileX;
  p.y = 0;
  p.direction = "right";
  p.step = { fromX: tileX, fromY: 0, toX: tileX + 1, toY: 0, progress: 0 };
  updatePlayer(p, EMPTY_INPUT, 0.001, makeStripZone());
  return p;
}

test("a slide that originates on ice renders the idle pose, not the walk cycle", () => {
  const p = tickMidStep(0); // on an ice tile
  assert.equal(p.moving, false, "moving should be false while sliding on ice");
  assert.equal(p.frameIndex, 0, "frame should reset to the idle frame");
  // 'right' still row is offset 3 (moving would be 2).
  const frame = getPlayerSpriteFrame(p);
  assert.equal(frame.y, p.baseFrame.y + 3 * p.baseFrame.h, "uses the still row");
});

test("a normal step on solid ground still animates the walk cycle", () => {
  const p = tickMidStep(1); // on a grass tile
  assert.equal(p.moving, true, "moving should be true on a normal step");
  // 'right' moving row is offset 2.
  const frame = getPlayerSpriteFrame(p);
  assert.equal(frame.y, p.baseFrame.y + 2 * p.baseFrame.h, "uses the moving row");
});
