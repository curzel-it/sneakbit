// Piercing bullets — the cannonball (species 1170, supports_bullet_piercing).
// A piercing round is immortal: it ignores its lifespan, survives its own
// kills and mows through everything lined up in front of it. Only a wall or
// the edge of the zone stops it.
//
// Two owners, one behaviour: shooting.js tags the bullet at spawn and skips
// the lifespan cull, combat.js keeps it alive through kills.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";
import { BIOME } from "../js/biomes.js";
import { CONSTRUCTION } from "../js/constructions.js";

// installShooting registers a window keydown listener; the unit env has no DOM.
globalThis.window = globalThis.window || { addEventListener() {} };

loadSpeciesData([
  // Cannon → cannonball. The weapon's 2s bullet_lifespan is what the piercing
  // flag overrides.
  { id: 1167, entity_type: "WeaponRanged", sprite_sheet_id: 1022,
    bullet_species_id: 1170, cooldown_after_use: 0.5, bullet_lifespan: 2.0,
    sprite_frame: { x: 33, y: 1, w: 4, h: 4 } },
  { id: 1170, entity_type: "Bullet", sprite_sheet_id: 1022,
    base_speed: 8, dps: 5000, supports_bullet_piercing: true,
    sprite_frame: { x: 33, y: 61, w: 1, h: 1 } },
  // Kunai, the non-piercing control.
  { id: 7000, entity_type: "Bullet", sprite_sheet_id: 1014,
    base_speed: 7, dps: 1800,
    sprite_frame: { x: 4, y: 0, w: 1, h: 1 } },
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
]);

const combat = await import("../js/combat.js");
const shooting = await import("../js/shooting.js");
const inventory = await import("../js/inventory.js");
const equipment = await import("../js/equipment.js");
const storage = await import("../js/storage.js");

function makeZone() {
  // 20x20 all-walkable grass map, no constructions.
  const collision = [], biome = [], construction = [];
  for (let r = 0; r < 20; r++) {
    const cRow = [], bRow = [], kRow = [];
    for (let c = 0; c < 20; c++) {
      cRow.push(false);
      bRow.push(BIOME.GRASS);
      kRow.push(CONSTRUCTION.NOTHING);
    }
    collision.push(cRow); biome.push(bRow); construction.push(kRow);
  }
  return { cols: 20, rows: 20, entities: [], collision, biome, construction };
}

function monsterAt(x, y) {
  return { species_id: 4004, frame: { x, y, w: 1, h: 2 }, direction: "Down" };
}

function makeState(tileX) {
  return {
    zone: makeZone(),
    player: { index: 0, tileX, tileY: 5, direction: "right" },
  };
}

// Fires one shot into a fresh state. weaponId null → no ranged weapon
// equipped, which falls back to the kunai bullet.
function fire(state, weaponId, bulletId) {
  storage._resetStorageForTesting();
  if (weaponId) equipment.setEquipped(equipment.SLOT_RANGED, weaponId, 0);
  else equipment.clearEquipped(equipment.SLOT_RANGED, 0);
  inventory.addAmmo(bulletId, 5, 0);
  shooting.installShooting(() => state);
  // The firing cooldown is module state that outlives a test — drain it, or
  // the previous test's shot blocks this one. The state is fresh, so this
  // moves nothing.
  shooting.tickShooting(1);
  shooting.tryShootForPlayer(state.player);
  return state.zone.entities.find(e => e._spawned && e.species_id === bulletId);
}

test("the cannon spawns a piercing bullet, the kunai doesn't", () => {
  const ball = fire(makeState(5), 1167, 1170);
  assert.equal(ball._piercing, true);

  const kunai = fire(makeState(5), null, 7000);
  assert.equal(kunai._piercing, undefined);
});

test("a piercing bullet outlives its lifespan and only dies at the zone edge", () => {
  const state = makeState(2);
  const ball = fire(state, 1167, 1170);

  // Past the cannon's 2s bullet_lifespan but still inside the 20-wide zone
  // (spawned at x=3, speed 8 → x=19.8).
  shooting.tickShooting(2.1);
  assert.ok(ball._lifespan < 0, "its lifespan did run out");
  assert.ok(state.zone.entities.includes(ball), "piercing bullet ignores lifespan");

  // It's still flying: keep ticking and it leaves the zone and is culled.
  shooting.tickShooting(1);
  assert.ok(!state.zone.entities.includes(ball), "culled past the zone edge");

  // Control: an ordinary kunai fired the same way dies on lifespan alone,
  // well short of the zone edge.
  const kunaiState = makeState(2);
  const kunai = fire(kunaiState, null, 7000);
  shooting.tickShooting(1.7); // > the 1.6s fallback lifespan; x would be 14.9
  assert.ok(!kunaiState.zone.entities.includes(kunai), "kunai expires on lifespan");
});

test("a piercing bullet kills a whole line of monsters in one pass", () => {
  const zone = makeZone();
  const line = [monsterAt(7, 5), monsterAt(9, 5), monsterAt(11, 5)];
  const ball = {
    species_id: 1170, _spawned: true, _piercing: true, _playerIndex: 0,
    _vx: 8, _vy: 0, _lifespan: 2.0,
    frame: { x: 6, y: 6, w: 1, h: 1 }, direction: "Right",
  };
  zone.entities.push(...line, ball);
  const player = { x: 5, y: 6, tileX: 5, tileY: 6 };

  const realRandom = Math.random;
  Math.random = () => 0.5; // pin the loot roll (see combat.test.js)
  try {
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      ball.frame.x += ball._vx * dt;
      combat.tickCombat(zone, player, dt);
    }
  } finally {
    Math.random = realRandom;
  }
  for (const m of line) {
    assert.ok(m._dying || !zone.entities.includes(m), `monster at ${m.frame.x} killed`);
  }
});

test("a non-piercing bullet stops at the first kill", () => {
  const zone = makeZone();
  const line = [monsterAt(7, 5), monsterAt(9, 5)];
  const kunai = {
    species_id: 7000, _spawned: true, _playerIndex: 0,
    _vx: 7, _vy: 0, _lifespan: 2.0,
    frame: { x: 6, y: 6, w: 1, h: 1 }, direction: "Right",
  };
  zone.entities.push(...line, kunai);
  const player = { x: 5, y: 6, tileX: 5, tileY: 6 };

  const realRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      kunai.frame.x += kunai._vx * dt;
      combat.tickCombat(zone, player, dt);
    }
  } finally {
    Math.random = realRandom;
  }
  assert.ok(line[0]._dying, "first monster killed");
  assert.ok(!line[1]._dying, "second monster untouched — the kunai was consumed");
  assert.ok(!zone.entities.includes(kunai), "kunai despawned on the kill");
});

test("a wall still stops a piercing bullet", () => {
  const zone = makeZone();
  for (let r = 0; r < 20; r++) zone.construction[r][10] = CONSTRUCTION.STONE_WALL;
  const ball = {
    species_id: 1170, _spawned: true, _piercing: true, _playerIndex: 0,
    _vx: 8, _vy: 0, _lifespan: 2.0,
    frame: { x: 6, y: 6, w: 1, h: 1 }, direction: "Right",
  };
  zone.entities.push(ball);
  const player = { x: 5, y: 6, tileX: 5, tileY: 6 };

  const dt = 1 / 60;
  for (let i = 0; i < 60 && zone.entities.includes(ball); i++) {
    ball.frame.x += ball._vx * dt;
    combat.tickCombat(zone, player, dt);
  }
  assert.ok(!zone.entities.includes(ball), "piercing bullet stopped by the wall");
  // bulletHitsWall tests the bullet's centre tile, so it dies as its middle
  // crosses into column 10 — not tiles later.
  assert.equal(Math.floor(ball.frame.x + 0.5), 10, `stopped on the wall tile, got ${ball.frame.x}`);
});
