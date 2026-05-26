// Tests for the three unlockable combat skills: piercing knife (2x kunai
// damage), boomerang (bullets bounce on stop), bullet catcher (refunded
// ammo on a caught return).

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";

loadSpeciesData([
  { id: 7000, entity_type: "Bullet", sprite_sheet_id: 1014,
    dps: 1800, base_speed: 7,
    supports_bullet_boomerang: true, supports_bullet_catching: true,
    sprite_frame: { x: 4, y: 0, w: 1, h: 1 } },
  // A second bullet species that does NOT support catching/boomerang.
  { id: 1170, entity_type: "Bullet", sprite_sheet_id: 1014,
    dps: 500, base_speed: 8,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
]);

const combat = await import("../js/combat.js");
const skills = await import("../js/skills.js");
const inventory = await import("../js/inventory.js");

function makeWorld() {
  const collision = [];
  for (let r = 0; r < 20; r++) {
    const row = []; for (let c = 0; c < 20; c++) row.push(false);
    collision.push(row);
  }
  return { cols: 20, rows: 20, entities: [], collision };
}

function resetAllSkills() {
  skills.setSkill("piercing", false);
  skills.setSkill("boomerang", false);
  skills.setSkill("catcher", false);
}

test("piercing skill doubles kunai damage", () => {
  resetAllSkills();
  const world = makeWorld();
  // Half-hp monster: 100/200 hp. dps*dt = 1800*0.05 = 90 → no kill.
  const m1 = { species_id: 4004, _hp: 100,
    frame: { x: 5, y: 5, w: 1, h: 2 }, direction: "Down" };
  const b1 = { species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 6, w: 1, h: 1 }, direction: "Right" };
  world.entities.push(m1, b1);
  combat.tickCombat(world, null, 0.05);
  assert.ok(world.entities.includes(m1), "monster not yet dead without piercing");

  // Same setup but piercing → 1800*2*0.05 = 180 > 100 → kill.
  skills.setSkill("piercing", true);
  const world2 = makeWorld();
  const m2 = { species_id: 4004, _hp: 100,
    frame: { x: 5, y: 5, w: 1, h: 2 }, direction: "Down" };
  const b2 = { species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 6, w: 1, h: 1 }, direction: "Right" };
  world2.entities.push(m2, b2);
  combat.tickCombat(world2, null, 0.05);
  assert.ok(!world2.entities.includes(m2), "piercing should one-shot the monster");
});

test("boomerang reverses kunai direction on wall hit", () => {
  resetAllSkills();
  skills.setSkill("boomerang", true);
  const world = makeWorld();
  world.collision[5][5] = true; // wall directly in front
  const b = { species_id: 7000, _spawned: true, _vx: 7, _vy: 0, _lifespan: 0.5,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right" };
  world.entities.push(b);
  combat.tickCombat(world, null, 0.01);
  assert.ok(world.entities.includes(b), "bullet survives the bounce");
  assert.equal(b.direction, "Left");
  assert.equal(Math.sign(b._vx), -1);
  assert.ok(b._bounced, "marked as bounced");
});

test("boomerang does NOT apply if bullet species lacks support", () => {
  resetAllSkills();
  skills.setSkill("boomerang", true);
  const world = makeWorld();
  world.collision[5][5] = true;
  const b = { species_id: 1170, _spawned: true, _vx: 7, _vy: 0, _lifespan: 0.5,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right" };
  world.entities.push(b);
  combat.tickCombat(world, null, 0.01);
  assert.equal(world.entities.length, 0, "bullet despawned, no bounce");
});

test("bounced bullet caught by player refunds ammo with catcher skill", () => {
  resetAllSkills();
  skills.setSkill("catcher", true);
  inventory.clearInventory();
  const world = makeWorld();
  const player = { x: 5, y: 5, tileX: 5, tileY: 5 };
  // Stage a bounced bullet sitting right on top of the player tile.
  const b = { species_id: 7000, _spawned: true, _bounced: true,
    _vx: -7, _vy: 0, _lifespan: 0.5,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Left" };
  world.entities.push(b);
  combat.tickCombat(world, player, 0.01);
  assert.equal(world.entities.length, 0, "bullet despawned on catch");
  assert.equal(inventory.getAmmo(7000), 1, "ammo refunded");
});

test("unlockSkillFromGameplay flips the read flag", async () => {
  const storage = await import("../js/storage.js");
  storage._resetStorageForTesting();
  skills.setSkill("piercing", null);
  assert.equal(skills.hasPiercingKnifeSkill(), false);
  skills.unlockSkillFromGameplay("piercing");
  assert.equal(skills.hasPiercingKnifeSkill(), true);
});

test("devtools override pins skill on regardless of dialogue state", async () => {
  const storage = await import("../js/storage.js");
  storage._resetStorageForTesting();
  skills.setSkill("boomerang", true);
  assert.equal(skills.hasBoomerangSkill(), true);
  skills.setSkill("boomerang", null);
  assert.equal(skills.hasBoomerangSkill(), false);
});

test("bounced bullet on player without catcher skill just despawns", () => {
  resetAllSkills();
  inventory.clearInventory();
  const world = makeWorld();
  const player = { x: 5, y: 5, tileX: 5, tileY: 5 };
  const b = { species_id: 7000, _spawned: true, _bounced: true,
    _vx: -7, _vy: 0, _lifespan: 0.5,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Left" };
  world.entities.push(b);
  combat.tickCombat(world, player, 0.01);
  assert.equal(world.entities.length, 0);
  assert.equal(inventory.getAmmo(7000), 0, "no refund without skill");
});
