import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js?v=20260528h");

loadSpeciesData([
  { id: 1171, entity_type: "WeaponMelee", sprite_sheet_id: 1022,
    received_damage_reduction: 0.5,
    sprite_frame: { x: 49, y: 1, w: 4, h: 4 } },
]);

const { setEquipped, clearEquipped, SLOT_MELEE, SLOT_RANGED } =
  await import("../js/equipment.js?v=20260528h");
const { applyPlayerContinuousDamage, applyPlayerDamage, getPlayerHp,
        resetPlayerHealth } = await import("../js/playerHealth.js?v=20260528h");

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
