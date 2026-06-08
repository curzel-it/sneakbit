// Ammo drops: the loot gate (lootDrops.rollLootCategory — coins vs ammo vs
// nothing, mutually exclusive), the drop amount, weapon-aware type selection,
// and the scatter. All DOM-free, imported directly under node like the coin
// economy tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData, getSpecies } from "../js/species.js";
import { rollLootCategory, maybeDropLoot } from "../js/lootDrops.js";
import { ammoDropAmount, pickAmmoType, dropAmmo, makeAmmoDrop } from "../js/ammoDrops.js";
import { addAmmo, clearInventory } from "../js/inventory.js";
import { _resetStorageForTesting } from "../js/storage.js";

const KUNAI = 7000, AR15 = 1169, CANNON = 1170, COIN = 2010;

loadSpeciesData([
  // Monsters with varying coin amounts (ammo = ½, floored at 1).
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023, hp: 100, coin_drop_amount: 2 },
  { id: 4007, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023, hp: 900, coin_drop_amount: 6 },
  { id: 4008, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023, hp: 9999, coin_drop_amount: 20 },
  // A barrel (id is in the explosive set).
  { id: 1038, entity_type: "StaticObject", sprite_sheet_id: 1012 },
  // A plain pickup — never drops loot.
  { id: COIN, entity_type: "PickableObject", sprite_sheet_id: 1012 },
  // Ranged weapons + the AR-15 pickup that grants ownership.
  { id: 1160, entity_type: "WeaponRanged", sprite_sheet_id: 1012, bullet_species_id: KUNAI },  // default launcher
  { id: 1154, entity_type: "WeaponRanged", sprite_sheet_id: 1012, bullet_species_id: AR15 },
  { id: 1162, entity_type: "PickableObject", sprite_sheet_id: 1012, associated_weapon: 1154 }, // AR-15 pickup
]);

// Deterministic rng stub: returns each queued value in turn, then 0.
function seq(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

function openZone(rows = 12, cols = 12) {
  const collision = Array.from({ length: rows }, () => new Array(cols).fill(false));
  return { rows, cols, collision, entities: [] };
}

// ---- the gate ---------------------------------------------------------

test("rollLootCategory: monster split is 40% nothing / 40% coin / 20% ammo", () => {
  const m = getSpecies(4004);
  assert.equal(rollLootCategory(m, seq(0.0)), "nothing");
  assert.equal(rollLootCategory(m, seq(0.39)), "nothing");
  assert.equal(rollLootCategory(m, seq(0.40)), "coin");
  assert.equal(rollLootCategory(m, seq(0.79)), "coin");
  assert.equal(rollLootCategory(m, seq(0.80)), "ammo");
  assert.equal(rollLootCategory(m, seq(0.99)), "ammo");
});

test("rollLootCategory: barrel split is 60% nothing / 30% coin / 10% ammo", () => {
  const b = getSpecies(1038);
  assert.equal(rollLootCategory(b, seq(0.59)), "nothing");
  assert.equal(rollLootCategory(b, seq(0.60)), "coin");
  assert.equal(rollLootCategory(b, seq(0.89)), "coin");
  assert.equal(rollLootCategory(b, seq(0.90)), "ammo");
});

test("rollLootCategory: non-monster, non-barrel never drops", () => {
  assert.equal(rollLootCategory(getSpecies(COIN), seq(0.99)), "nothing");
  assert.equal(rollLootCategory(null, seq(0.99)), "nothing");
});

// ---- amount -----------------------------------------------------------

test("ammoDropAmount: barrels give 1; monsters give half their coin amount (floored at 1)", () => {
  assert.equal(ammoDropAmount(getSpecies(1038)), 1);   // barrel
  assert.equal(ammoDropAmount(getSpecies(4004)), 1);   // ½ of 2
  assert.equal(ammoDropAmount(getSpecies(4007)), 3);   // ½ of 6
  assert.equal(ammoDropAmount(getSpecies(4008)), 10);  // ½ of 20
  assert.equal(ammoDropAmount(null), 0);
});

// ---- weapon-aware type ------------------------------------------------

test("pickAmmoType: defaults to kunai when only the launcher is owned", () => {
  _resetStorageForTesting();
  clearInventory(0);
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    assert.equal(pickAmmoType(0, seq(r)), KUNAI);
  }
});

test("pickAmmoType: only drops ammo for weapons the killer owns", () => {
  _resetStorageForTesting();
  clearInventory(0);
  addAmmo(1162, 1, 0); // own the AR-15 (its pickup grants the weapon)
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(pickAmmoType(0, seq(i / 50)));
  assert.ok(seen.has(KUNAI), "kunai should appear");
  assert.ok(seen.has(AR15), "ar15 should appear once owned");
  assert.ok(!seen.has(CANNON), "cannon never drops without its weapon");
});

// ---- scatter ----------------------------------------------------------

test("dropAmmo: scatters one bullet species in the generated id band, ephemeral", () => {
  _resetStorageForTesting();
  clearInventory(0);
  const zone = openZone();
  const corpse = { species_id: 4007, frame: { x: 5, y: 5, w: 1, h: 1 } }; // amount 3
  dropAmmo(zone, corpse, 0, seq(0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5));
  const drops = zone.entities;
  assert.equal(drops.length, 3, "gooseberry drops ½×6 = 3 rounds");
  const type = drops[0].species_id;
  for (const d of drops) {
    assert.equal(d.species_id, type, "all rounds are the same picked type");
    assert.equal(d.species_id, KUNAI, "only kunai owned ⇒ kunai");
    assert.equal(d._ephemeral, true);
    assert.ok(d.id <= -8_000_000 && d.id > -9_000_000, `id ${d.id} in ammo band`);
    assert.equal(d.frame.w, 1);
  }
});

// ---- end-to-end gate: coins and ammo are mutually exclusive -----------

test("maybeDropLoot: an ammo roll yields ammo and no coins", () => {
  _resetStorageForTesting();
  clearInventory(0);
  const zone = openZone();
  // monster roll ≥0.80 ⇒ ammo; remaining values feed the scatter.
  maybeDropLoot(zone, { species_id: 4004, frame: { x: 4, y: 4, w: 1, h: 1 } }, 0, seq(0.9, 0.5, 0.5));
  assert.ok(zone.entities.length > 0);
  assert.ok(zone.entities.every((e) => e.species_id !== COIN), "no coins on an ammo roll");
  assert.ok(zone.entities.every((e) => e.species_id === KUNAI));
});

test("maybeDropLoot: a coin roll yields coins and no ammo", () => {
  _resetStorageForTesting();
  clearInventory(0);
  const zone = openZone();
  // monster roll in [0.40,0.80) ⇒ coins.
  maybeDropLoot(zone, { species_id: 4004, frame: { x: 4, y: 4, w: 1, h: 1 } }, 0, seq(0.5, 0.5, 0.5));
  assert.ok(zone.entities.length > 0);
  assert.ok(zone.entities.every((e) => e.species_id === COIN), "only coins on a coin roll");
});

test("maybeDropLoot: a nothing roll drops nothing", () => {
  const zone = openZone();
  maybeDropLoot(zone, { species_id: 4004, frame: { x: 4, y: 4, w: 1, h: 1 } }, 0, seq(0.1));
  assert.equal(zone.entities.length, 0);
});
