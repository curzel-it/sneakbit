// Knockback Aura — the passive trigger + effect. Driven through the public
// tickKnockbackAura with a minimal walkable zone and one melee monster, the
// same shape combat/skills tests use. Pure node (audio/loot guard themselves
// against the missing DOM at call time).

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";
import { BIOME } from "../js/biomes.js";
import { CONSTRUCTION } from "../js/constructions.js";

loadSpeciesData([
  // 1×1 melee monster, 200 base HP → a 25% blast strips 50.
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200, base_speed: 1.4,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

const aura = await import("../js/knockbackAura.js");
const skills = await import("../js/skills.js");
const playerHealth = await import("../js/playerHealth.js");

function makeZone() {
  const collision = [], biome = [], construction = [];
  for (let r = 0; r < 20; r++) {
    const cRow = [], bRow = [], kRow = [];
    for (let c = 0; c < 20; c++) {
      cRow.push(false);
      bRow.push(BIOME.GRASS);
      kRow.push(CONSTRUCTION.NOTHING);
    }
    collision.push(cRow); biome.push(bRow); construction.push(kRow);
  }
  return { cols: 20, rows: 20, entities: [], collision, biome, construction };
}

function monsterAt(x, y) {
  return { id: 1, species_id: 4004, direction: "Down", frame: { x, y, w: 1, h: 1 } };
}

function player() {
  return { index: 0, x: 5, y: 5, tileX: 5, tileY: 5, direction: "down" };
}

function reset() {
  aura.resetKnockbackAura();
  playerHealth.resetPlayerHealth();
  skills.setSkill("aura", true); // pin the skill on for the trigger checks
}

const DT = 0.016;

test("fires at <10% HP with an enemy in range: 25% base-HP blast + cooldown + immunity", () => {
  reset();
  const zone = makeZone();
  const mob = monsterAt(5, 5); // on the player's tile → within radius
  zone.entities.push(mob);
  playerHealth.setPlayerHp(5, 0); // 5/100 = 5% < 10%

  aura.tickKnockbackAura(zone, player(), DT);

  // Monster survives (200 → 150) and took exactly 25% of base HP.
  assert.equal(mob._hp, 150);
  // Animation is playing and the player is fully immune during it.
  assert.ok(aura.getAuraAnimRemaining(0) > 0);
  assert.equal(playerHealth.applyPlayerDamage(20, 0), "ignored");
  assert.equal(playerHealth.applyPlayerContinuousDamage(20, 0), "ignored");
  assert.equal(playerHealth.getPlayerHp(0), 5);
});

test("does not re-fire while on cooldown", () => {
  reset();
  const zone = makeZone();
  const mob = monsterAt(5, 5);
  zone.entities.push(mob);
  playerHealth.setPlayerHp(5, 0);

  aura.tickKnockbackAura(zone, player(), DT);
  assert.equal(mob._hp, 150);
  aura.tickKnockbackAura(zone, player(), DT); // same frame, still on cooldown
  assert.equal(mob._hp, 150); // unchanged — no second blast
});

test("does not fire above the HP threshold", () => {
  reset();
  const zone = makeZone();
  const mob = monsterAt(5, 5);
  zone.entities.push(mob);
  playerHealth.setPlayerHp(50, 0); // 50% > 10%

  aura.tickKnockbackAura(zone, player(), DT);
  assert.equal(mob._hp, undefined);
  assert.equal(aura.getAuraAnimRemaining(0), 0);
});

test("does not fire with no enemy in range", () => {
  reset();
  const zone = makeZone();
  const mob = monsterAt(15, 15); // far away
  zone.entities.push(mob);
  playerHealth.setPlayerHp(5, 0);

  aura.tickKnockbackAura(zone, player(), DT);
  assert.equal(mob._hp, undefined);
  assert.equal(aura.getAuraAnimRemaining(0), 0);
});

test("does not fire without the skill", () => {
  reset();
  skills.setSkill("aura", false);
  const zone = makeZone();
  const mob = monsterAt(5, 5);
  zone.entities.push(mob);
  playerHealth.setPlayerHp(5, 0);

  aura.tickKnockbackAura(zone, player(), DT);
  assert.equal(mob._hp, undefined);
  assert.equal(aura.getAuraAnimRemaining(0), 0);
});

test("an in-range enemy that dies from the blast is removed/killed (low HP)", () => {
  reset();
  const zone = makeZone();
  const mob = monsterAt(5, 5);
  mob._hp = 10; // 25% of base (50) exceeds this → dies
  zone.entities.push(mob);
  playerHealth.setPlayerHp(5, 0);

  aura.tickKnockbackAura(zone, player(), DT);
  assert.ok(mob._hp <= 0);
  assert.equal(mob._dying, true); // turned into a death animation
});

test("getAuraAnimProgress reads networked auraAnim off the render player", () => {
  reset();
  assert.equal(aura.getAuraAnimProgress({ index: 1, auraAnim: 0.5 }), 0.5);
  assert.equal(aura.getAuraAnimProgress({ index: 1, auraAnim: 0 }), null);
  assert.equal(aura.getAuraAnimProgress({ index: 1, auraAnim: null }), null);
});
