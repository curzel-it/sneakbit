import { test } from "node:test";
import assert from "node:assert/strict";

// The transient TD save context (storage.js + tdSave.js) and the TD fold rules
// that make a run's coins shared, but its ammo and gear per-hero — all without
// touching the real save. Pure node, no DOM.

const gameMode = await import("../js/gameMode.js");
const storage = await import("../js/storage.js");
const wallet = await import("../js/wallet.js");
const inventory = await import("../js/inventory.js");
const equipment = await import("../js/equipment.js");
const { tdShopStock } = await import("../js/tdShopStock.js");
const { enterTdSave } = await import("../js/tdSave.js");

function leaveTd() {
  gameMode.setGameMode(gameMode.GAME_MODE.coop);
  storage.exitTransientContext();
}

test("transient context isolates TD-owned keys and leaves the real save intact", () => {
  storage._resetStorageForTesting();
  storage.setValue("player.0.coins", 5);          // a real save value
  storage.setValue("settings.example", 7);        // a non-TD key

  storage.enterTransientContext();
  // TD-owned keys start empty in the run and never read the real save…
  assert.equal(storage.getValue("player.0.coins"), null);
  // …but everything else still falls through to the persistent store.
  assert.equal(storage.getValue("settings.example"), 7);

  storage.setValue("player.0.coins", 999);
  storage.setValue("player.2.equipped.ranged", 1162);
  storage.setValue("skill.knockback_aura.owned", 1);
  assert.equal(storage.getValue("player.0.coins"), 999);
  assert.equal(storage.getValue("skill.knockback_aura.owned"), 1);

  storage.exitTransientContext();
  // The run is gone; the real save is exactly as it was.
  assert.equal(storage.getValue("player.0.coins"), 5);
  assert.equal(storage.getValue("player.2.equipped.ranged"), null);
  assert.equal(storage.getValue("skill.knockback_aura.owned"), null);
});

test("enterTdSave starts an empty run: no coins, no ammo, no bought gear", () => {
  storage._resetStorageForTesting();
  storage.setValue("player.0.coins", 1234);       // a fat real-game purse
  gameMode.setGameMode(gameMode.GAME_MODE.td);
  enterTdSave();
  assert.equal(wallet.getCoins(0), 0);
  assert.equal(inventory.getAmmo(7000, 0), 0);
  assert.equal(equipment.getEquippedId(equipment.SLOT_RANGED, 0), null);
  leaveTd();
  // The real save (the persistent store) is untouched. Leaving TD reloads the
  // page in the app, which re-reads it; here we check the store directly since
  // wallet's in-memory mirror is only refreshed by that reload.
  assert.equal(storage.getValue("player.0.coins"), 1234);
});

test("TD folds coins to one squad purse but keeps ammo & gear per-hero", () => {
  storage._resetStorageForTesting();
  gameMode.setGameMode(gameMode.GAME_MODE.td);
  enterTdSave();

  // Coins: any hero spends from / earns into the shared index-0 purse.
  wallet.addCoins(100, 2);
  assert.equal(wallet.getCoins(0), 100);
  assert.equal(wallet.getCoins(2), 100);

  // Ammo: per-hero — hero 2's rounds aren't hero 0's.
  inventory.addAmmo(7000, 30, 2);
  assert.equal(inventory.getAmmo(7000, 2), 30);
  assert.equal(inventory.getAmmo(7000, 0), 0);

  // Gear: per-hero — re-arming hero 2 doesn't touch hero 0.
  equipment.setEquipped(equipment.SLOT_RANGED, 1162, 2);
  assert.equal(equipment.getEquippedId(equipment.SLOT_RANGED, 2), 1162);
  assert.equal(equipment.getEquippedId(equipment.SLOT_RANGED, 0), null);

  leaveTd();
});

test("tdShopStock is a non-cosmetic catalog: weapons, ammo, consumables, skill — no skins", () => {
  const stock = tdShopStock();
  assert.ok(stock.length > 0);
  assert.ok(stock.every((e) => !("skin" in e)), "no cosmetic skins");
  assert.ok(stock.some((e) => e.skill === "aura"), "sells the aura skill");
  assert.ok(stock.some((e) => e.item === 1162), "sells a weapon (AR-15)");
  assert.ok(stock.some((e) => e.item === 7001), "sells ammo (kunai x10)");
  assert.ok(stock.some((e) => e.item === 2020), "sells a consumable (potion)");
  assert.ok(stock.every((e) => Number.isFinite(e.price) && e.price >= 0), "valid prices");

  // Returned fresh each call so a caller (shop.js filters in place) can't
  // corrupt the shared list.
  stock[0].price = -1;
  assert.notEqual(tdShopStock()[0].price, -1);
});
