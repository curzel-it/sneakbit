import { test } from "node:test";
import assert from "node:assert/strict";

const inventory = await import("../js/inventory.js");
const storage = await import("../js/storage.js");
const health = await import("../js/playerHealth.js");
const speed = await import("../js/speedMode.js");
const {
  isConsumable, consumableVerb, canUseConsumable, useConsumable,
} = await import("../js/consumables.js");

const HEALTH_POTION = 2020;
const PURPLE_POTION = 2021; // full heal (formerly the red pill)
const SILVER_POTION = 2026; // 3x speed buff

function reset() {
  storage._resetStorageForTesting();
  inventory.clearInventory();
  health.resetPlayerHealth();
}

test("isConsumable: only items with a registered effect", () => {
  assert.equal(isConsumable(HEALTH_POTION), true);
  assert.equal(isConsumable(PURPLE_POTION), true); // full-heal potion
  assert.equal(isConsumable(2022), false); // green potion: no effect yet
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

test("the purple potion restores all health", () => {
  reset();
  inventory.addAmmo(PURPLE_POTION, 1);
  health.applyPlayerContinuousDamage(80); // hp = 20
  assert.equal(health.getPlayerHp(), 20);
  assert.equal(consumableVerb(PURPLE_POTION), "Drink");
  assert.equal(canUseConsumable(PURPLE_POTION), true);
  assert.equal(useConsumable(PURPLE_POTION), true);
  assert.equal(inventory.getAmmo(PURPLE_POTION), 0); // one drunk
  // The full heal is queued like a potion; drain it and we're back to max.
  health.tickPlayerHealth(10);
  assert.ok(Math.abs(health.getPlayerHp() - health.getPlayerMaxHp()) < 1e-6);
});

test("the silver potion arms the speed buff (offline) and can't be re-drunk", () => {
  reset();
  speed._clearSpeedForTesting();
  inventory.addAmmo(SILVER_POTION, 2);
  assert.equal(isConsumable(SILVER_POTION), true);
  assert.equal(consumableVerb(SILVER_POTION), "Drink");
  assert.equal(speed.isSpeedActiveIndex(0), false);
  assert.equal(canUseConsumable(SILVER_POTION), true);
  assert.equal(useConsumable(SILVER_POTION), true);
  assert.equal(inventory.getAmmo(SILVER_POTION), 1); // one drunk
  assert.equal(speed.speedMultiplier({ index: 0 }), speed.SPEED_MULTIPLIER);
  // Already sped up → the button is gated so the second potion isn't wasted.
  assert.equal(canUseConsumable(SILVER_POTION), false);
  assert.equal(useConsumable(SILVER_POTION), false);
  assert.equal(inventory.getAmmo(SILVER_POTION), 1);
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
