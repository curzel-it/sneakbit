import { test } from "node:test";
import assert from "node:assert/strict";

const inventory = await import("../js/inventory.js");
const storage = await import("../js/storage.js");
const health = await import("../js/playerHealth.js");
const {
  isConsumable, consumableVerb, canUseConsumable, useConsumable,
} = await import("../js/consumables.js");

const HEALTH_POTION = 2020;
const RED_PILL = 2028;

function reset() {
  storage._resetStorageForTesting();
  inventory.clearInventory();
  health.resetPlayerHealth();
}

test("isConsumable: only items with a registered effect", () => {
  assert.equal(isConsumable(HEALTH_POTION), true);
  assert.equal(isConsumable(2021), false); // purple potion: no effect yet
  assert.equal(consumableVerb(HEALTH_POTION), "Drink");
});

test("drinking a potion consumes one and queues the heal", () => {
  reset();
  inventory.addAmmo(HEALTH_POTION, 2);
  health.applyPlayerContinuousDamage(40); // hp = 60
  assert.equal(health.getPlayerHp(), 60);
  assert.equal(canUseConsumable(HEALTH_POTION), true);
  assert.equal(useConsumable(HEALTH_POTION), true);
  assert.equal(inventory.getAmmo(HEALTH_POTION), 1); // one drunk
  // Heal is queued, not instant — drains over ~0.5s.
  assert.equal(health.getPlayerHp(), 60);
  health.tickPlayerHealth(0.5);
  assert.ok(Math.abs(health.getPlayerHp() - 100) < 1e-6);
});

test("the red pill restores all health", () => {
  reset();
  inventory.addAmmo(RED_PILL, 1);
  health.applyPlayerContinuousDamage(80); // hp = 20
  assert.equal(health.getPlayerHp(), 20);
  assert.equal(consumableVerb(RED_PILL), "Take");
  assert.equal(canUseConsumable(RED_PILL), true);
  assert.equal(useConsumable(RED_PILL), true);
  assert.equal(inventory.getAmmo(RED_PILL), 0); // one taken
  // The full heal is queued like a potion; drain it and we're back to max.
  health.tickPlayerHealth(10);
  assert.ok(Math.abs(health.getPlayerHp() - health.getPlayerMaxHp()) < 1e-6);
});

test("can't drink at full HP — the potion isn't wasted", () => {
  reset();
  inventory.addAmmo(HEALTH_POTION, 1);
  assert.equal(canUseConsumable(HEALTH_POTION), false); // already full
  assert.equal(useConsumable(HEALTH_POTION), false);
  assert.equal(inventory.getAmmo(HEALTH_POTION), 1);    // still held
});

test("can't drink with none in inventory", () => {
  reset();
  health.applyPlayerContinuousDamage(40); // hurt, but nothing to drink
  assert.equal(canUseConsumable(HEALTH_POTION), false);
  assert.equal(useConsumable(HEALTH_POTION), false);
});

test("non-consumable items are never usable", () => {
  reset();
  inventory.addAmmo(9999, 5); // some arbitrary pickup
  assert.equal(canUseConsumable(9999), false);
  assert.equal(useConsumable(9999), false);
  assert.equal(inventory.getAmmo(9999), 5);
});
