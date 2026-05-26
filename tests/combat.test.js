// Combat helpers — pure functions plus an integration test driving
// tickCombat on a minimal world. We can't import combat.js directly
// without DOM (it imports playerHealth via combat.js, but combat.js also
// imports audio.js transitively for playSfx). The audio module touches
// `new Audio()` at load time inside loadAudio(), but not at import time
// — so the import should succeed in node. We import dynamically.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";

loadSpeciesData([
  { id: 7000, entity_type: "Bullet", sprite_sheet_id: 1014,
    dps: 1800, base_speed: 7,
    sprite_frame: { x: 4, y: 0, w: 1, h: 1 } },
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
]);

const combat = await import("../js/combat.js");
const playerHealth = await import("../js/playerHealth.js");

function makeWorld() {
  // 20x20 all-walkable map.
  const collision = [];
  for (let r = 0; r < 20; r++) {
    const row = []; for (let c = 0; c < 20; c++) row.push(false);
    collision.push(row);
  }
  return { cols: 20, rows: 20, entities: [], collision };
}

test("rectsOverlap detects intersection and gap", () => {
  const a = { x: 0, y: 0, w: 1, h: 1 };
  const b = { x: 0.5, y: 0.5, w: 1, h: 1 };
  const c = { x: 2, y: 2, w: 1, h: 1 };
  assert.ok(combat.rectsOverlap(a, b));
  assert.ok(!combat.rectsOverlap(a, c));
});

test("bulletHitbox uses an inset perpendicular to bullet direction", () => {
  const right = combat.bulletHitbox({ direction: "Right", frame: { x: 0, y: 0, w: 1, h: 1 } });
  // Horizontal flight → narrows the vertical axis.
  assert.equal(right.y, 0.2);
  assert.equal(right.h, 0.6);
  const up = combat.bulletHitbox({ direction: "Up", frame: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(up.x, 0.2);
  assert.equal(up.w, 0.6);
});

test("bullet damages and kills an overlapping monster, then despawns", () => {
  const world = makeWorld();
  const monster = {
    species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 }, direction: "Down",
  };
  const bullet = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 6, w: 1, h: 1 }, direction: "Right",
  };
  world.entities.push(monster, bullet);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };
  // One large dt to deal lethal damage in one go (dps 1800 × 0.2 = 360 > 200 hp).
  combat.tickCombat(world, player, 0.2);
  assert.equal(world.entities.length, 0, "both monster and bullet removed");
});

test("bullet hitting a wall is consumed without applying damage", () => {
  const world = makeWorld();
  world.collision[5][5] = true;            // wall at (5,5)
  const bullet = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right",
  };
  world.entities.push(bullet);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };
  combat.tickCombat(world, player, 0.05);
  assert.equal(world.entities.length, 0);
});

test("melee monster overlapping the player applies damage", () => {
  playerHealth.resetPlayerHealth();
  const world = makeWorld();
  const monster = { species_id: 4004, frame: { x: 1, y: 0, w: 1, h: 2 }, direction: "Down" };
  world.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  combat.tickCombat(world, player, 0.1); // 100 dps × 0.1 = 10 damage
  const after = playerHealth.getPlayerHp();
  assert.ok(after < before, `hp should drop (was ${before}, now ${after})`);
});

test("melee monster on adjacent tile (just under 0.9 away) damages player", () => {
  playerHealth.resetPlayerHealth();
  const world = makeWorld();
  // Monster on tile (2, 1), player on tile (1, 1). Centres 1.0 apart —
  // outside range. Now slide the monster 0.2 towards the player: centre
  // becomes 0.8 away.
  const monster = { species_id: 4004, frame: { x: 1.8, y: 0, w: 1, h: 2 }, direction: "Left" };
  world.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  combat.tickCombat(world, player, 0.05);
  assert.ok(playerHealth.getPlayerHp() < before, "should take damage at 0.8 tile distance");
});

test("melee monster more than 0.9 tiles away does not damage", () => {
  playerHealth.resetPlayerHealth();
  const world = makeWorld();
  const monster = { species_id: 4004, frame: { x: 3, y: 0, w: 1, h: 2 }, direction: "Left" };
  world.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  combat.tickCombat(world, player, 0.1);
  assert.equal(playerHealth.getPlayerHp(), before, "no damage when out of range");
});

test("continuous damage from a melee monster stacks every tick (no invuln)", () => {
  playerHealth.resetPlayerHealth();
  const world = makeWorld();
  const monster = { species_id: 4004, frame: { x: 1, y: 0, w: 1, h: 2 }, direction: "Down" };
  world.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  // 10 small ticks back-to-back. With the old invuln gate only the first
  // would have landed; now they should all bite.
  for (let i = 0; i < 10; i++) combat.tickCombat(world, player, 0.05);
  const after = playerHealth.getPlayerHp();
  // 100 dps × 0.5 s = 50 damage (allow a small slack).
  assert.ok(before - after >= 30, `expected ≥30 hp lost, lost ${before - after}`);
});
