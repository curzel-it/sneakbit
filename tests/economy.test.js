// Coin economy: the drop roll (coinDrops.rollCoinDrop) and the wallet store
// (wallet.js). Both are DOM-free, so we import them directly under node. The
// combat-side spawn hook and the pickups-side credit are exercised by the
// existing combat/pickup harness shapes; here we lock the pure logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData, getSpecies } from "../js/species.js";
import { rollCoinDrop, coinRenderOffset, COIN_SPECIES_ID } from "../js/coinDrops.js";
import {
  getCoins,
  addCoins,
  clearWallet,
  seedStartingCoins,
  _resetWalletForTesting,
} from "../js/wallet.js";
import { _resetStorageForTesting } from "../js/storage.js";

loadSpeciesData([
  // A monster with no coin fields → decorate fills the defaults (0.5 / 1).
  { id: 4003, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023, hp: 80 },
  // A monster tuned to drop more.
  {
    id: 4006, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023, hp: 900,
    coin_drop_chance: 0.8, coin_drop_amount: 5,
  },
  // A non-monster pickup must never drop coins.
  { id: 2010, entity_type: "PickableObject", sprite_sheet_id: 1012 },
]);

// Deterministic rng stub: returns each queued value in turn (then 0).
function seq(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

test("species defaults: a monster with no coin fields reads 0.5 / 1", () => {
  const sp = getSpecies(4003);
  assert.equal(sp.coin_drop_chance, 0.5);
  assert.equal(sp.coin_drop_amount, 1);
});

test("rollCoinDrop: roll below chance drops the configured amount", () => {
  // chance 0.8 → a roll of 0.1 succeeds, amount 5.
  assert.equal(rollCoinDrop(getSpecies(4006), seq(0.1)), 5);
});

test("rollCoinDrop: roll at/above chance drops nothing", () => {
  assert.equal(rollCoinDrop(getSpecies(4006), seq(0.8)), 0);
  assert.equal(rollCoinDrop(getSpecies(4006), seq(0.95)), 0);
});

test("rollCoinDrop: default species drops 1 on a successful roll", () => {
  assert.equal(rollCoinDrop(getSpecies(4003), seq(0.0)), 1);
  assert.equal(rollCoinDrop(getSpecies(4003), seq(0.5)), 0); // 0.5 >= 0.5
});

test("rollCoinDrop: non-monster species never drops", () => {
  assert.equal(rollCoinDrop(getSpecies(2010), seq(0.0)), 0);
  assert.equal(rollCoinDrop(null, seq(0.0)), 0);
});

test("wallet: addCoins accumulates and getCoins reads back", () => {
  _resetStorageForTesting();
  _resetWalletForTesting();
  assert.equal(getCoins(0), 0);
  addCoins(3, 0);
  addCoins(2, 0);
  assert.equal(getCoins(0), 5);
});

test("wallet: balance persists through storage (survives the in-memory reset)", () => {
  _resetStorageForTesting();
  _resetWalletForTesting();
  addCoins(7, 0);
  // Drop the wallet's in-memory mirror but keep storage — it must re-read 7.
  _resetWalletForTesting();
  assert.equal(getCoins(0), 7);
});

test("wallet: never goes negative", () => {
  _resetStorageForTesting();
  _resetWalletForTesting();
  addCoins(2, 0);
  addCoins(-10, 0);
  assert.equal(getCoins(0), 0);
});

test("wallet: network co-op keeps per-player balances independent", () => {
  _resetStorageForTesting();
  _resetWalletForTesting();
  addCoins(4, 0);
  addCoins(9, 1);
  assert.equal(getCoins(0), 4);
  assert.equal(getCoins(1), 9);
});

test("wallet: clearWallet zeroes a player's balance", () => {
  _resetStorageForTesting();
  _resetWalletForTesting();
  addCoins(5, 0);
  clearWallet(0);
  assert.equal(getCoins(0), 0);
});

test("wallet: seedStartingCoins grants the starting purse once", () => {
  _resetStorageForTesting();
  _resetWalletForTesting();
  assert.equal(getCoins(0), 0);
  seedStartingCoins(0);
  assert.equal(getCoins(0), 50);
});

test("wallet: seedStartingCoins is idempotent — no second grant", () => {
  _resetStorageForTesting();
  _resetWalletForTesting();
  seedStartingCoins(0);
  seedStartingCoins(0);
  assert.equal(getCoins(0), 50);
});

test("wallet: seedStartingCoins doesn't re-grant after spending to zero", () => {
  _resetStorageForTesting();
  _resetWalletForTesting();
  seedStartingCoins(0);
  addCoins(-50, 0); // spend it all
  assert.equal(getCoins(0), 0);
  // Drop the in-memory mirror to simulate a reload, then re-seed: the persisted
  // seed flag must keep the broke player at 0.
  _resetWalletForTesting();
  seedStartingCoins(0);
  assert.equal(getCoins(0), 0);
});

test("coinRenderOffset: null for non-coins, stable & distinct for coins", () => {
  assert.equal(coinRenderOffset(null), null);
  assert.equal(coinRenderOffset({ species_id: 4006, id: -1 }), null);

  const a = coinRenderOffset({ species_id: COIN_SPECIES_ID, id: -2_000_000 });
  const b = coinRenderOffset({ species_id: COIN_SPECIES_ID, id: -2_000_001 });
  // Stable: same id → same offset.
  assert.deepEqual(coinRenderOffset({ species_id: COIN_SPECIES_ID, id: -2_000_000 }), a);
  // Distinct: consecutive coin ids don't render on top of each other.
  assert.notDeepEqual(a, b);
  // Bounded to a sub-tile range.
  for (const o of [a, b]) {
    assert.ok(Math.abs(o.x) <= 0.25 && Math.abs(o.y) <= 0.2);
  }
});
