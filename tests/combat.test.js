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
  // Wait out the invuln so subsequent applyDamage can land.
  while (playerHealth.isPlayerInvulnerable()) playerHealth.tickPlayerHealth(0.1);

  const world = makeWorld();
  const monster = { species_id: 4004, frame: { x: 1, y: 0, w: 1, h: 2 }, direction: "Down" };
  world.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  combat.tickCombat(world, player, 0.1); // 100 dps × 0.1 = 10 damage
  const after = playerHealth.getPlayerHp();
  assert.ok(after < before, `hp should drop (was ${before}, now ${after})`);
});
