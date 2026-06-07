import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

loadSpeciesData([
  { id: 1171, entity_type: "WeaponMelee", sprite_sheet_id: 1022,
    received_damage_reduction: 0.5,
    sprite_frame: { x: 49, y: 1, w: 4, h: 4 } },
]);

const { setEquipped, clearEquipped, SLOT_MELEE, SLOT_RANGED } =
  await import("../js/equipment.js");
const { applyPlayerContinuousDamage, applyPlayerDamage, applyPlayerHeal,
        getPlayerHp, resetPlayerHealth, tickPlayerHealth } =
  await import("../js/playerHealth.js");

function freshHealthAndUnequipped() {
  clearEquipped(SLOT_MELEE);
  clearEquipped(SLOT_RANGED);
  resetPlayerHealth();
}

test("no equipped reduction → full damage applied", () => {
  freshHealthAndUnequipped();
  applyPlayerContinuousDamage(10);
  assert.equal(getPlayerHp(), 90);
});

test("equipped shield halves continuous damage", () => {
  freshHealthAndUnequipped();
  setEquipped(SLOT_MELEE, 1171);
  applyPlayerContinuousDamage(10);
  assert.equal(getPlayerHp(), 95);
});

test("equipped shield halves burst damage (applyPlayerDamage)", () => {
  freshHealthAndUnequipped();
  setEquipped(SLOT_MELEE, 1171);
  applyPlayerDamage(10);
  assert.equal(getPlayerHp(), 95);
});

test("damage reduction never makes amount negative", () => {
  freshHealthAndUnequipped();
  setEquipped(SLOT_MELEE, 1171);
  applyPlayerContinuousDamage(0.0001);
  // ~0.00005 damage actually applied; HP still very near 100.
  assert.ok(getPlayerHp() > 99.99);
});

test("potion heal climbs over ~0.5s, not instantly", () => {
  freshHealthAndUnequipped();
  applyPlayerContinuousDamage(60); // hp = 40
  assert.equal(getPlayerHp(), 40);
  applyPlayerHeal(50);
  // Queued, not applied yet.
  assert.equal(getPlayerHp(), 40);
  // 0.1s at 100 HP/s → +10.
  tickPlayerHealth(0.1);
  assert.ok(Math.abs(getPlayerHp() - 50) < 1e-6);
  // Drain the rest of the 0.5s; lands on 90 (40 + 50).
  tickPlayerHealth(0.4);
  assert.ok(Math.abs(getPlayerHp() - 90) < 1e-6);
  // Pool empty: no further climb beyond slow natural regen.
  tickPlayerHealth(0.01);
  assert.ok(getPlayerHp() < 90.1);
});

test("potion heal never overheals past max", () => {
  freshHealthAndUnequipped();
  applyPlayerContinuousDamage(10); // hp = 90
  applyPlayerHeal(50);             // only 10 of room left
  for (let i = 0; i < 100; i++) tickPlayerHealth(0.1);
  assert.equal(getPlayerHp(), 100);
});

test("potion heal is a no-op on a dead player", () => {
  freshHealthAndUnequipped();
  applyPlayerContinuousDamage(100); // hp = 0
  assert.equal(getPlayerHp(), 0);
  assert.equal(applyPlayerHeal(50), 0);
  tickPlayerHealth(0.5);
  assert.equal(getPlayerHp(), 0);
});
