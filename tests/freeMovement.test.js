import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlayer, updatePlayer, inputVector, facingFor, heroSpeed } from "../js/player.js";
import { moveHero, canHeroOccupy, canHeroSweep } from "../js/heroCollision.js";
import { loadSpeciesData } from "../js/species.js";
import { stickVector } from "../js/gamepad.js";
import { vectorForOffset } from "../js/touchJoystick.js";

// `walls` is a set of "x,y" blocked tiles.
function makeZone(cols, rows, walls = new Set(), entities = []) {
  const collision = [];
  const biome = [];
  for (let y = 0; y < rows; y++) {
    collision.push([]);
    biome.push([]);
    for (let x = 0; x < cols; x++) {
      collision[y].push(walls.has(`${x},${y}`));
      biome[y].push(1);
    }
  }
  return { cols, rows, collision, biome, entities };
}

function playerAt(x, y, direction = "down") {
  const p = createPlayer();
  p.x = x; p.y = y; p.tileX = Math.round(x); p.tileY = Math.round(y);
  p.direction = direction;
  return p;
}

const held = (...dirs) => ({ events: [], held: new Set(dirs) });

test("held directions combine into a normalised 8-way vector", () => {
  assert.deepEqual(inputVector(held("right")), { x: 1, y: 0 });
  const d = inputVector(held("right", "down"));
  assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9);
  assert.ok(d.x > 0 && d.y > 0);
  assert.deepEqual(inputVector(held("left", "right")), { x: 0, y: 0 });
});

test("an analog vector wins over held keys and keeps its magnitude", () => {
  const v = inputVector({ events: [], held: new Set(["up"]), ax: 0.3, ay: 0.4 });
  assert.equal(v.x, 0.3);
  assert.equal(v.y, 0.4);
});

test("stick and touch vectors are zero inside their dead zone and capped at 1", () => {
  assert.deepEqual(stickVector(0.1, 0.1), { x: 0, y: 0 });
  const full = stickVector(1, 0);
  assert.ok(Math.abs(full.x - 1) < 1e-9);
  assert.deepEqual(vectorForOffset(5, 5), { x: 0, y: 0 });
  const t = vectorForOffset(100, 0);
  assert.equal(t.x, 1);
});

test("facing is four-way, and a diagonal keeps the current axis", () => {
  assert.equal(facingFor(1, 0, "down"), "right");
  assert.equal(facingFor(0.2, -1, "down"), "up");
  assert.equal(facingFor(1, 1, "down"), "down");
  assert.equal(facingFor(1, 1, "right"), "right");
  assert.equal(facingFor(1, 1, "up"), "right");
});

test("the hero walks at its species speed and diagonals are no faster", () => {
  loadSpeciesData([{ id: 1001, entity_type: "Hero", base_speed: 4 }]);
  const zone = makeZone(20, 20);
  const p = playerAt(5, 5);
  updatePlayer(p, held("right"), 0.1, zone);
  assert.ok(Math.abs(p.x - 5 - heroSpeed(p) * 0.1) < 1e-9);
  assert.equal(heroSpeed(p), 4.5);
  const q = playerAt(5, 5);
  updatePlayer(q, held("right", "down"), 0.1, zone);
  assert.ok(Math.abs(Math.hypot(q.x - 5, q.y - 5) - 0.45) < 1e-9);
});

test("positions are floats; tileX/tileY is the tile under the hitbox centre", () => {
  const zone = makeZone(20, 20);
  const p = playerAt(5, 5);
  for (let i = 0; i < 3; i++) updatePlayer(p, held("right", "down"), 0.03, zone);
  assert.ok(p.x % 1 !== 0 && p.y % 1 !== 0, "the hero stands mid-tile");
  assert.equal(p.tileX, Math.round(p.x));
  assert.equal(p.tileY, Math.round(p.y));
  assert.equal(p.moving, true);
});

test("a wall stops the hero flush, and it slides along it on a diagonal", () => {
  const walls = new Set(["6,4", "6,5", "6,6", "6,7"]);
  const zone = makeZone(20, 20, walls);
  const p = playerAt(5, 5);
  for (let i = 0; i < 30; i++) updatePlayer(p, held("right", "down"), 0.016, zone);
  assert.ok(p.x <= 5.2 + 1e-6, `held at the wall, x=${p.x}`);
  assert.ok(p.x > 5.15, "flush against it");
  assert.ok(p.y > 5.5, `slid down along the wall, y=${p.y}`);
});

test("a hero clipping a corner is nudged into the corridor", () => {
  // Corridor one tile wide at row 5, walls above and below from x=7 on.
  const walls = new Set();
  for (let x = 7; x < 15; x++) { walls.add(`${x},4`); walls.add(`${x},6`); }
  const zone = makeZone(20, 20, walls);
  const p = playerAt(5, 5.3);
  for (let i = 0; i < 60; i++) updatePlayer(p, held("right"), 0.016, zone);
  assert.ok(p.x > 7.5, `entered the corridor, x=${p.x}`);
  assert.ok(Math.abs(p.y - 5) <= 0.2 + 1e-6, "fits the corridor");
});

test("moveHero reports the blocked tile on each axis", () => {
  const zone = makeZone(10, 10, new Set(["6,5"]));
  const body = { x: 5.19, y: 5 };
  const { blockedX, blockedY } = moveHero(zone, body, 0.1, 0);
  assert.deepEqual(blockedX, [6, 5]);
  assert.equal(blockedY, null);
});

test("a hero overlapping a blocker may move out of it but not deeper into others", () => {
  const zone = makeZone(10, 10, new Set(["5,5", "4,5"]));
  assert.ok(canHeroOccupy(zone, 5, 5, 5, 5.5), "leaving the blocked tile is allowed");
  assert.ok(!canHeroOccupy(zone, 5, 5, 4.5, 5), "stepping into another blocker is not");
});

test("canHeroSweep refuses a straight line through a wall", () => {
  const zone = makeZone(10, 10, new Set(["5,5"]));
  assert.equal(canHeroSweep(zone, 4, 5, 6, 5), false);
  assert.equal(canHeroSweep(zone, 4, 4, 6, 4), true);
});

test("walking into a pushable shoves it one tile along the walk", () => {
  loadSpeciesData([
    { id: 1001, entity_type: "Hero", base_speed: 4 },
    { id: 7000, entity_type: "PushableObject", is_rigid: true, sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  ]);
  const rock = { id: 1, species_id: 7000, frame: { x: 6, y: 5, w: 1, h: 1 } };
  const zone = makeZone(20, 20, new Set(), [rock]);
  const p = playerAt(5, 5, "right");
  for (let i = 0; i < 10; i++) updatePlayer(p, held("right"), 0.016, zone);
  assert.equal(rock.frame.x, 7, "the rock moved one tile right");
  assert.deepEqual(p._pushed, { x: 6, y: 5, d: "right" });
});
