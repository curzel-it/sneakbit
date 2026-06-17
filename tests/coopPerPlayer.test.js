// Cross-feature sanity tests for the local co-op port: per-player HP,
// per-player inventory, and the camera averaging rule.

import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

// Minimal species: the shield (used by playerHealth damage reduction) +
// the kunai launcher default + a kunai bullet.
loadSpeciesData([
  { id: 1171, entity_type: "WeaponMelee", sprite_sheet_id: 1022,
    received_damage_reduction: 0.5,
    sprite_frame: { x: 49, y: 1, w: 4, h: 4 } },
  { id: 1160, entity_type: "WeaponRanged", sprite_sheet_id: 1000,
    bullet_species_id: 7000, cooldown_after_use: 0.35,
    bullet_lifespan: 1.6,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 7000, entity_type: "Bullet", sprite_sheet_id: 1014,
    base_speed: 9, dps: 100,
    sprite_frame: { x: 4, y: 0, w: 1, h: 1 } },
]);

const playerHealth = await import("../js/playerHealth.js");
const inventory = await import("../js/inventory.js");
const equipment = await import("../js/equipment.js");
const wallet = await import("../js/wallet.js");
const storage = await import("../js/storage.js");
const coopMode = await import("../js/coopMode.js");
const { updateCamera, createCamera, cameraRectFor } = await import("../js/camera.js");

function freshAll() {
  storage._resetStorageForTesting();
  playerHealth.resetPlayerHealth();
  inventory.clearInventory();
  wallet._resetWalletForTesting();
  coopMode._setCoopModeForTesting(false);
}

test("per-player HP is independent (damage to P1 doesn't touch P2)", () => {
  freshAll();
  playerHealth.applyPlayerContinuousDamage(20, 0);
  assert.equal(playerHealth.getPlayerHp(0), 80);
  assert.equal(playerHealth.getPlayerHp(1), 100);
});

test("burst invulnerability is per-player", () => {
  freshAll();
  // P1 takes a burst → P1 invuln, P2 untouched
  playerHealth.applyPlayerDamage(10, 0);
  assert.equal(playerHealth.isPlayerInvulnerable(0), true);
  assert.equal(playerHealth.isPlayerInvulnerable(1), false);
  // P2 should still be hittable while P1 is in their invuln window
  playerHealth.applyPlayerDamage(10, 1);
  assert.equal(playerHealth.getPlayerHp(1), 90);
});

test("per-player HP reset can target only one player", () => {
  freshAll();
  playerHealth.applyPlayerContinuousDamage(30, 0);
  playerHealth.applyPlayerContinuousDamage(40, 1);
  assert.equal(playerHealth.getPlayerHp(0), 70);
  assert.equal(playerHealth.getPlayerHp(1), 60);
  playerHealth.resetPlayerHealth(1);
  assert.equal(playerHealth.getPlayerHp(0), 70, "P1 unaffected by single-player reset");
  assert.equal(playerHealth.getPlayerHp(1), 100, "P2 fully restored");
});

test("per-player equipped damage reduction only applies to that player", () => {
  freshAll();
  equipment.setEquipped(equipment.SLOT_MELEE, 1171, 0); // P1 has the shield
  playerHealth.applyPlayerContinuousDamage(10, 0);
  playerHealth.applyPlayerContinuousDamage(10, 1);
  assert.equal(playerHealth.getPlayerHp(0), 95, "P1: 10 reduced to 5");
  assert.equal(playerHealth.getPlayerHp(1), 90, "P2: full 10 lands");
});

test("per-player inventory is independent", () => {
  freshAll();
  inventory.addAmmo(7000, 5, 0);
  inventory.addAmmo(7000, 2, 1);
  assert.equal(inventory.getAmmo(7000, 0), 5);
  assert.equal(inventory.getAmmo(7000, 1), 2);
  // Removing from P1 doesn't touch P2
  inventory.removeAmmo(7000, 3, 0);
  assert.equal(inventory.getAmmo(7000, 0), 2);
  assert.equal(inventory.getAmmo(7000, 1), 2);
});

test("per-player equipped weapon is independent (P1 ≠ P2)", () => {
  freshAll();
  // P1 picks up the AR15 (via the equipment setter); P2 stays on default.
  equipment.setEquipped(equipment.SLOT_RANGED, 1154, 0);
  assert.equal(equipment.getEquipped(equipment.SLOT_RANGED, 0), 1154);
  // P2 hasn't equipped anything → defaults to kunai launcher.
  assert.equal(equipment.getEquipped(equipment.SLOT_RANGED, 1),
               equipment.DEFAULT_RANGED_WEAPON_ID);
});

test("camera averages two live players in co-op", () => {
  const camera = createCamera();
  // Zone large enough to avoid the zone-bounds clamp pulling the
  // camera back at either edge. Both players sit deep inside.
  const zone = { cols: 1000, rows: 1000 };
  const p1 = { x: 100, y: 100 };
  const p2 = { x: 120, y: 108 };
  updateCamera(camera, [p1, p2], zone);
  const camCenterX = camera.x + camera.w / 2;
  const camCenterY = camera.y + camera.h / 2;
  assert.ok(Math.abs(camCenterX - 110.5) < 0.001, `camCenterX=${camCenterX}`);
  assert.ok(Math.abs(camCenterY - 104.5) < 0.001, `camCenterY=${camCenterY}`);
});

test("camera with a single player matches the old single-player path", () => {
  const camera = createCamera();
  const zone = { cols: 1000, rows: 1000 };
  updateCamera(camera, { x: 100, y: 100 }, zone);
  const camCenterX = camera.x + camera.w / 2;
  const camCenterY = camera.y + camera.h / 2;
  assert.ok(Math.abs(camCenterX - 100.5) < 0.001);
  assert.ok(Math.abs(camCenterY - 100.5) < 0.001);
});

test("local co-op keeps P2 inventory dedicated (no folding onto P1)", () => {
  freshAll();
  coopMode._setCoopModeForTesting(true);
  inventory.addAmmo(7000, 5, 0);
  // P2's pickup lands in P2's own pool — it must not bleed into P1's count,
  // so a kunai P2 grabbed is P2's to throw, not added to P1's HUD total.
  inventory.addAmmo(7000, 3, 1);
  assert.equal(inventory.getAmmo(7000, 0), 5);
  assert.equal(inventory.getAmmo(7000, 1), 3);
  // Each player removes from their own pool only.
  inventory.removeAmmo(7000, 2, 1);
  assert.equal(inventory.getAmmo(7000, 0), 5);
  assert.equal(inventory.getAmmo(7000, 1), 1);
  coopMode._setCoopModeForTesting(false);
});

test("local co-op keeps P2 wallet dedicated (each player spends their own purse)", () => {
  freshAll();
  coopMode._setCoopModeForTesting(true);
  wallet.addCoins(100, 0);
  wallet.addCoins(40, 1);
  assert.equal(wallet.getCoins(0), 100);
  assert.equal(wallet.getCoins(1), 40);
  // P2 spending (a shop purchase) only draws down P2's balance.
  wallet.addCoins(-25, 1);
  assert.equal(wallet.getCoins(0), 100, "P1 purse untouched by P2's spend");
  assert.equal(wallet.getCoins(1), 15);
  coopMode._setCoopModeForTesting(false);
});

test("local co-op keeps P2 equipment dedicated (no shared loadout)", () => {
  freshAll();
  coopMode._setCoopModeForTesting(true);
  // P2 picks up the AR15 — it equips for P2 only; P1 stays on the default.
  equipment.setEquipped(equipment.SLOT_RANGED, 1154, 1);
  assert.equal(equipment.getEquipped(equipment.SLOT_RANGED, 1), 1154);
  assert.equal(equipment.getEquipped(equipment.SLOT_RANGED, 0),
               equipment.DEFAULT_RANGED_WEAPON_ID);
  coopMode._setCoopModeForTesting(false);
});

test("cameraRectFor centers an unclamped viewport on the player", () => {
  // Online co-op's per-player simulation viewport. Same +0.5 - w/2
  // centering as updateCamera, but never clamped to zone bounds — we
  // want the true region around a wandered player.
  const rect = cameraRectFor({ x: 100, y: 100 }, 30, 20);
  assert.equal(rect.w, 30);
  assert.equal(rect.h, 20);
  assert.ok(Math.abs((rect.x + rect.w / 2) - 100.5) < 0.001, `centerX=${rect.x + rect.w / 2}`);
  assert.ok(Math.abs((rect.y + rect.h / 2) - 100.5) < 0.001, `centerY=${rect.y + rect.h / 2}`);
  // Negative origin allowed (no clamp) when the player is near (0,0).
  const edge = cameraRectFor({ x: 2, y: 2 }, 30, 20);
  assert.ok(edge.x < 0 && edge.y < 0);
});

test("camera clamps to bounds only in exterior zones, not dungeons", () => {
  // A small zone with the player pressed into the top-left corner. In an
  // exterior zone the camera clamps so it can't drift off the map; in an
  // interior zone (house or dungeon) it always centers on the player,
  // matching Rust — the bug was dungeons being treated as exterior.
  const player = { x: 1, y: 1 };
  const exterior = createCamera();
  updateCamera(exterior, player, { cols: 30, rows: 20, zoneType: "Exterior" });
  assert.equal(exterior.x, 0, "exterior clamps left edge to 0");
  assert.equal(exterior.y, 0, "exterior clamps top edge to 0");

  const dungeon = createCamera();
  updateCamera(dungeon, player, { cols: 30, rows: 20, zoneType: "Dungeon" });
  assert.ok(Math.abs((dungeon.x + dungeon.w / 2) - 1.5) < 0.001, `dungeon centerX=${dungeon.x + dungeon.w / 2}`);
  assert.ok(Math.abs((dungeon.y + dungeon.h / 2) - 1.5) < 0.001, `dungeon centerY=${dungeon.y + dungeon.h / 2}`);
  assert.ok(dungeon.x < 0 && dungeon.y < 0, "dungeon does not clamp at the corner");
});

test("camera ignores dead players (caller filters them) — empty array is a no-op", () => {
  const camera = createCamera();
  camera.x = 42; camera.y = 99;
  updateCamera(camera, [], { cols: 1000, rows: 1000 });
  // Empty input → no change. Last frame's position is preserved so the
  // viewport doesn't snap to (0, 0) when everyone is dead.
  assert.equal(camera.x, 42);
  assert.equal(camera.y, 99);
});
