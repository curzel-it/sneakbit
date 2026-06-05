// The on-screen attack button draws a cooldown ring from
// shooting.getShootCooldownProgress(): null when ready, else the fraction of
// the cooldown still remaining (1.0 just after firing, draining to 0).

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";

// installShooting registers a window keydown listener; the unit env has no DOM,
// so give it a no-op window before importing the module's installer.
globalThis.window = globalThis.window || { addEventListener() {} };

// Only the kunai bullet is needed: with no WeaponRanged species loaded the
// shooter falls back to the default kunai bullet (7000), which must exist or
// shoot() bails before touching the cooldown.
loadSpeciesData([
  { id: 7000, entity_type: "Bullet", sprite_sheet_id: 1022,
    dps: 100, base_speed: 9,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

const shooting = await import("../js/shooting.js");
const inventory = await import("../js/inventory.js");
const storage = await import("../js/storage.js");

test("getShootCooldownProgress: null before firing", () => {
  storage._resetStorageForTesting();
  assert.equal(shooting.getShootCooldownProgress(0), null);
});

test("getShootCooldownProgress: 0..1 after a shot, draining to null", () => {
  storage._resetStorageForTesting();
  inventory.addAmmo(7000, 5, 0);
  const state = {
    zone: { entities: [] },
    player: { index: 0, tileX: 5, tileY: 5, direction: "down" },
  };
  shooting.installShooting(() => state);

  shooting.tryShootForPlayer(state.player);
  const p0 = shooting.getShootCooldownProgress(0);
  assert.ok(p0 > 0 && p0 <= 1, `expected 0..1 right after firing, got ${p0}`);

  // Partway through the 0.35s fallback cooldown it shrinks but isn't ready yet.
  shooting.tickShooting(0.2);
  const p1 = shooting.getShootCooldownProgress(0);
  assert.ok(p1 != null && p1 < p0, `expected to drain below ${p0}, got ${p1}`);

  // Past the cooldown it reads ready again.
  shooting.tickShooting(0.2);
  assert.equal(shooting.getShootCooldownProgress(0), null);
});
