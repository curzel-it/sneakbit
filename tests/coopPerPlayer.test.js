// Cross-feature sanity tests for the local co-op port: per-player HP,
// per-player inventory, and the camera averaging rule.

import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js?v=20260530c");

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

const playerHealth = await import("../js/playerHealth.js?v=20260530c");
const inventory = await import("../js/inventory.js?v=20260530c");
const equipment = await import("../js/equipment.js?v=20260530c");
const storage = await import("../js/storage.js?v=20260530c");
const coopMode = await import("../js/coopMode.js?v=20260530c");
const { updateCamera, createCamera, cameraRectFor } = await import("../js/camera.js?v=20260530c");

function freshAll() {
  storage._resetStorageForTesting();
  playerHealth.resetPlayerHealth();
  inventory.clearInventory();
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

test("local co-op folds P2 inventory onto P1 (shared kunai pool)", () => {
  freshAll();
  coopMode._setCoopModeForTesting(true);
  inventory.addAmmo(7000, 5, 0);
  // P2 deposit goes into the same pool as P1; the HUD reads index 0 and
  // shows the combined count, so P1 isn't stuck with 0 kunai because P2
  // happened to step on the pickup first.
  inventory.addAmmo(7000, 3, 1);
  assert.equal(inventory.getAmmo(7000, 0), 8);
  assert.equal(inventory.getAmmo(7000, 1), 8);
  // Either player removing decrements the shared pool.
  inventory.removeAmmo(7000, 2, 1);
  assert.equal(inventory.getAmmo(7000, 0), 6);
  coopMode._setCoopModeForTesting(false);
});

test("local co-op folds P2 equipment onto P1 (shared loadout)", () => {
  freshAll();
  coopMode._setCoopModeForTesting(true);
  // P2 picks up the AR15 — equipment.js routes the write to index 0.
  equipment.setEquipped(equipment.SLOT_RANGED, 1154, 1);
  assert.equal(equipment.getEquipped(equipment.SLOT_RANGED, 0), 1154);
  assert.equal(equipment.getEquipped(equipment.SLOT_RANGED, 1), 1154);
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

test("camera ignores dead players (caller filters them) — empty array is a no-op", () => {
  const camera = createCamera();
  camera.x = 42; camera.y = 99;
  updateCamera(camera, [], { cols: 1000, rows: 1000 });
  // Empty input → no change. Last frame's position is preserved so the
  // viewport doesn't snap to (0, 0) when everyone is dead.
  assert.equal(camera.x, 42);
  assert.equal(camera.y, 99);
});
