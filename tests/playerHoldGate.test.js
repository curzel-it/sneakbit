// The zone-entry hold gate. Walking into a staircase drops the player one
// tile in front of the matching staircase on the other floor — which leads
// straight back. With the movement key still held, the player used to step
// back onto it the very next frame and bounce between the two floors for as
// long as they held the key. transitions.movePlayerTo sets `_holdGate`; this
// covers what player.js does with it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlayer, updatePlayer } from "../js/player.js";
import { BIOME } from "../js/biomes.js";

// 1×3 column of plain grass: the player stands in the middle and can walk
// either way.
function makeZone() {
  return {
    cols: 1,
    rows: 3,
    biome: [[BIOME.GRASS], [BIOME.GRASS], [BIOME.GRASS]],
    collision: [[0], [0], [0]],
    entities: [],
  };
}

// A player freshly placed by a zone transition: facing up, gate armed.
function justArrived() {
  const p = createPlayer();
  p.tileX = 0; p.tileY = 1; p.x = 0; p.y = 1;
  p.direction = "up";
  p._holdGate = true;
  return p;
}

test("a direction held through the transition does not step on arrival", () => {
  const zone = makeZone();
  const p = justArrived();
  const held = new Set(["up"]);

  // Several frames of "key still down, no new press" — key repeat produces
  // no press events, which is exactly what the old held-key retry acted on.
  for (let i = 0; i < 5; i++) updatePlayer(p, { events: [], held }, 0.016, zone);
  assert.equal(p.step, null, "held input must not carry the player back in");
  assert.equal(p.tileY, 1, "player stayed put");
  assert.equal(p._holdGate, true, "gate stays armed while the key is down");
});

test("releasing the key disarms the gate; the next hold walks again", () => {
  const zone = makeZone();
  const p = justArrived();

  updatePlayer(p, { events: [], held: new Set() }, 0.016, zone);
  assert.equal(p._holdGate, false, "an empty held set clears the gate");

  const held = new Set(["up"]);
  updatePlayer(p, { events: [], held }, 0.016, zone);
  assert.ok(p.step, "movement resumes once the gate is cleared");
  assert.equal(p.step.toY, 0);
});

test("a fresh press goes through immediately — one keypress to head back", () => {
  const zone = makeZone();
  const p = justArrived();
  const held = new Set(["up"]);

  updatePlayer(p, { events: ["up"], held }, 0.016, zone);
  assert.equal(p._holdGate, false, "a real press clears the gate");
  assert.ok(p.step, "pressing the faced direction commits a step at once");
  assert.equal(p.step.toY, 0);
});

test("the gate only bites once per arrival", () => {
  const zone = makeZone();
  const p = justArrived();
  const held = new Set(["down"]);

  updatePlayer(p, { events: ["down"], held }, 0.016, zone);
  assert.equal(p._holdGate, false);
  // Finish the step, then keep holding: normal chaining is untouched.
  for (let i = 0; i < 40 && p.tileY !== 2; i++) {
    updatePlayer(p, { events: [], held }, 0.016, zone);
  }
  assert.equal(p.tileY, 2, "the player kept walking on the held key");
});
