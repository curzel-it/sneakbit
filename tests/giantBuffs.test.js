// The Giant Pill is more than cosmetic: while transformed the hero gets two
// combat buffs — triple max HP (playerHealth) and bare-handed melee that hits
// harder and reaches further than a normal swing (melee). These tests pin both,
// plus the clamp-down when the (lazily-expiring) giant timer lapses.

import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

// The giant fist reuses the sword bullet (1166) as an invisible, dps-overridden
// carrier — load it so the swing has a valid species to spawn.
loadSpeciesData([
  { id: 1166, entity_type: "Bullet", sprite_sheet_id: 1022,
    dps: 450, base_speed: 0, sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

const giant = await import("../js/giantMode.js");
const {
  getPlayerHp, getPlayerMaxHp, applyPlayerHeal, applyPlayerContinuousDamage,
  resetPlayerHealth, tickPlayerHealth,
} = await import("../js/playerHealth.js");
const melee = await import("../js/melee.js");

test("giant triples a player's max HP", () => {
  giant._clearGiantsForTesting();
  resetPlayerHealth();
  assert.equal(getPlayerMaxHp(0), 100);
  giant.triggerGiant(0);
  assert.equal(getPlayerMaxHp(0), 300);
});

test("giant can be healed up into the tripled headroom", () => {
  giant._clearGiantsForTesting();
  resetPlayerHealth(); // hp = 100/100
  giant.triggerGiant(0); // max now 300; hp still 100
  assert.equal(getPlayerHp(0), 100);
  // Topping off toward the new max climbs past the old 100 cap.
  applyPlayerHeal(getPlayerMaxHp(0), 0);
  for (let i = 0; i < 30; i++) tickPlayerHealth(0.1);
  assert.equal(getPlayerHp(0), 300);
});

test("HP clamps back down to 100 the moment the giant timer lapses", () => {
  giant._clearGiantsForTesting();
  resetPlayerHealth();
  giant._armForTesting("local:0", 5000); // giant for 5s
  applyPlayerHeal(300, 0);
  for (let i = 0; i < 30; i++) tickPlayerHealth(0.1); // fill to 300
  assert.equal(getPlayerHp(0), 300);
  // Expire the timer; the next tick must clamp the oversized HP to the
  // restored 1× cap (expiry is lazy, so the tick is where it's enforced).
  giant._armForTesting("local:0", -1);
  tickPlayerHealth(0.016);
  assert.equal(getPlayerMaxHp(0), 100);
  assert.equal(getPlayerHp(0), 100);
});

test("a non-giant with no melee weapon still can't swing", () => {
  giant._clearGiantsForTesting();
  const s = { zone: { entities: [] }, player: { index: 0, tileX: 5, tileY: 5, direction: "down" } };
  assert.equal(melee.performMeleeSwing(s, { ignoreCooldown: true }), false);
  assert.equal(s.zone.entities.length, 0);
});

test("a giant swings bare-handed (no weapon) with extended reach", () => {
  giant._clearGiantsForTesting();
  giant.triggerGiant(0); // index 0 → local:0 offline
  const s = { zone: { entities: [] }, player: { index: 0, tileX: 5, tileY: 5, direction: "down" } };
  assert.equal(melee.performMeleeSwing(s, { ignoreCooldown: true }), true);

  const bullets = s.zone.entities;
  // 9 fist-impacts: the giant's footprint cross plus a two-tile reach arm.
  assert.equal(bullets.length, 9);
  for (const b of bullets) {
    assert.equal(b._melee, true);
    assert.equal(b._dpsOverride, 700); // fists hit harder than a 450-dps sword
    assert.equal(b.species_id, 1166);
  }
  // Reach extends two tiles out (a normal swing only ever spans one).
  const reach = Math.max(...bullets.map(b => Math.abs(b.frame.y - s.player.tileY)));
  assert.equal(reach, 2);
});
