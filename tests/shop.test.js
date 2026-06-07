import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

// A small catalog mirroring real data shapes: weapon items carry
// associated_weapon; bundles carry bundle_contents; bullets are raw ammo.
loadSpeciesData([
  { id: 1159, entity_type: "WeaponMelee",  bullet_species_id: 1166 },           // sword weapon
  { id: 1164, entity_type: "PickableObject", associated_weapon: 1159 },         // sword item
  { id: 1154, entity_type: "WeaponRanged", bullet_species_id: 1169 },           // AR15 weapon
  { id: 1162, entity_type: "PickableObject", associated_weapon: 1154 },         // AR15 item
  { id: 1169, entity_type: "Bullet" },                                          // .223 round
  { id: 7000, entity_type: "Bullet" },                                          // kunai round
  { id: 7001, entity_type: "Bundle", bundle_contents: Array(10).fill(7000) },   // kunai x10
  { id: 2020, entity_type: "PickableObject" },                                  // health potion
]);

const shop = await import("../js/shopPurchase.js");
const inventory = await import("../js/inventory.js");
const wallet = await import("../js/wallet.js");
const equipment = await import("../js/equipment.js");
const storage = await import("../js/storage.js");

const SWORD = { item: 1164, price: 99 };
const AR15  = { item: 1162, price: 450 };
const KUNAI = { item: 7001, price: 10 };
// Health potion: a PickableObject, so it only stacks with the explicit
// stockentry override (mirrors data/prefabs).
const POTION = { item: 2020, price: 30, stackable: true };

function reset(coins = 0) {
  storage._resetStorageForTesting();
  inventory.clearInventory();
  wallet._resetWalletForTesting();
  if (coins) wallet.addCoins(coins);
}

test("isStackable: bundles/bullets stack, weapon items don't", () => {
  reset();
  assert.equal(shop.isStackable(KUNAI), true);
  assert.equal(shop.isStackable(SWORD), false);
  // explicit override wins over the species default
  assert.equal(shop.isStackable({ item: 1164, price: 1, stackable: true }), true);
});

test("isWeaponItem detects weapon-granting items only", () => {
  reset();
  assert.equal(shop.isWeaponItem(1164), true);
  assert.equal(shop.isWeaponItem(1162), true);
  assert.equal(shop.isWeaponItem(7001), false);
});

test("maxAffordable clamps to wallet and to the cap", () => {
  reset(50);
  assert.equal(shop.maxAffordable(10), 5);          // 50 / 10
  assert.equal(shop.maxAffordable(99), 0);          // can't afford one
  assert.equal(shop.maxAffordable(0), shop.MAX_PURCHASE_QTY); // free → cap
  reset(100000);
  assert.equal(shop.maxAffordable(1), shop.MAX_PURCHASE_QTY); // capped at 99
});

test("clampQty: weapons clamp to 0/1, ammo clamps to affordable range", () => {
  reset(50);
  assert.equal(shop.clampQty(SWORD, 5), 0);   // 99 unaffordable
  assert.equal(shop.clampQty(KUNAI, 3), 3);   // affordable
  assert.equal(shop.clampQty(KUNAI, 999), 5); // clamped to maxAffordable
  reset(120);
  assert.equal(shop.clampQty(SWORD, 5), 1);   // weapon: at most one
});

test("canBuy reasons: invalid / quantity / poor / ok", () => {
  reset(50);
  assert.equal(shop.canBuy({ item: 999999, price: 1 }, 1).reason, "invalid");
  assert.equal(shop.canBuy(KUNAI, 0).reason, "quantity");
  assert.equal(shop.canBuy(SWORD, 2).reason, "quantity"); // weapons are single
  assert.equal(shop.canBuy(SWORD, 1).reason, "poor");     // 99 > 50
  assert.equal(shop.canBuy(KUNAI, 3).ok, true);
});

test("buying a bundle expands contents and debits coins", () => {
  reset(50);
  const res = shop.buy(KUNAI, 3);
  assert.equal(res.ok, true);
  assert.equal(res.spent, 30);
  assert.equal(inventory.getAmmo(7000), 30); // 3 bundles × 10 kunai
  assert.equal(wallet.getCoins(), 20);
});

test("buying a weapon grants the item, equips it, and marks it owned", () => {
  reset(120);
  assert.equal(shop.isOwned(1164), false);
  const res = shop.buy(SWORD, 1);
  assert.equal(res.ok, true);
  assert.equal(res.spent, 99);
  assert.equal(inventory.getAmmo(1164), 1);
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE), 1159); // auto-equipped
  assert.equal(shop.isOwned(1164), true);
  assert.equal(wallet.getCoins(), 21);
});

test("an owned weapon cannot be re-bought (and isn't charged)", () => {
  reset(1000);
  shop.buy(SWORD, 1);
  const coinsAfterFirst = wallet.getCoins();
  const res = shop.buy(SWORD, 1);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "owned");
  assert.equal(wallet.getCoins(), coinsAfterFirst); // no double charge
});

test("health potion is repeatable, never owned, and stacks in inventory", () => {
  reset(100);
  // PickableObject isn't stackable by default — only via the stock override.
  assert.equal(shop.isStackable({ item: 2020, price: 30 }), false);
  assert.equal(shop.isStackable(POTION), true);
  // It's a consumable, not a weapon item, so it's never "owned".
  assert.equal(shop.isWeaponItem(2020), false);
  assert.equal(shop.isOwned(2020), false);
  const res = shop.buy(POTION, 3);
  assert.equal(res.ok, true);
  assert.equal(res.spent, 90);
  assert.equal(inventory.getAmmo(2020), 3); // carried, stackable
  assert.equal(shop.isOwned(2020), false);  // can keep buying more
  assert.equal(wallet.getCoins(), 10);
});

test("a failed purchase never spends coins", () => {
  reset(50);
  const res = shop.buy(AR15, 1); // 450 > 50
  assert.equal(res.ok, false);
  assert.equal(res.reason, "poor");
  assert.equal(wallet.getCoins(), 50);
  assert.equal(inventory.getAmmo(1162), 0);
});

test("spending never drives the wallet negative", () => {
  reset(10);
  shop.buy(KUNAI, 1); // spend 10, exactly to zero
  assert.equal(wallet.getCoins(), 0);
});
