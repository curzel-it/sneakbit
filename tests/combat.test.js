// Combat helpers — pure functions plus an integration test driving
// tickCombat on a minimal zone. We can't import combat.js directly
// without DOM (it imports playerHealth via combat.js, but combat.js also
// imports audio.js transitively for playSfx). The audio module touches
// `new Audio()` at load time inside loadAudio(), but not at import time
// — so the import should succeed in node. We import dynamically.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";
import { BIOME } from "../js/biomes.js";
import { CONSTRUCTION } from "../js/constructions.js";

loadSpeciesData([
  { id: 7000, entity_type: "Bullet", sprite_sheet_id: 1014,
    dps: 1800, base_speed: 7,
    sprite_frame: { x: 4, y: 0, w: 1, h: 1 } },
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  // Explosive barrel: a rigid StaticObject bullets can destroy (id 1038 is
  // one of the explosive ids hard-coded in explosives.js). hp omitted → the
  // combat default of 100 applies.
  { id: 1038, entity_type: "StaticObject", sprite_sheet_id: 1014,
    is_rigid: true, sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  // Sword melee bullet (the cross of bullets a swing spawns carries this id).
  { id: 1166, entity_type: "Bullet", sprite_sheet_id: 1022,
    dps: 450, base_speed: 2, sprite_frame: { x: 1, y: 61, w: 1, h: 1 } },
]);

const combat = await import("../js/combat.js");
const playerHealth = await import("../js/playerHealth.js");

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

test("rectsOverlap detects intersection and gap", () => {
  const a = { x: 0, y: 0, w: 1, h: 1 };
  const b = { x: 0.5, y: 0.5, w: 1, h: 1 };
  const c = { x: 2, y: 2, w: 1, h: 1 };
  assert.ok(combat.rectsOverlap(a, b));
  assert.ok(!combat.rectsOverlap(a, c));
});

test("bulletHitbox uses an inset perpendicular to bullet direction", () => {
  const right = combat.bulletHitbox({ direction: "Right", frame: { x: 0, y: 0, w: 1, h: 1 } });
  // Horizontal flight → narrows the vertical axis.
  assert.equal(right.y, 0.2);
  assert.equal(right.h, 0.6);
  const up = combat.bulletHitbox({ direction: "Up", frame: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(up.x, 0.2);
  assert.equal(up.w, 0.6);
});

test("bullet damages and kills an overlapping monster, then despawns", () => {
  const zone = makeZone();
  const monster = {
    species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 }, direction: "Down",
  };
  const bullet = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 6, w: 1, h: 1 }, direction: "Right",
  };
  zone.entities.push(monster, bullet);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };
  // One large dt to deal lethal damage in one go (dps 1800 × 0.2 = 360 > 200 hp).
  combat.tickCombat(zone, player, 0.2);
  // The bullet despawns immediately; the monster lingers as a dying
  // fireball (flagged _dying) until its ~1s lifespan runs out.
  assert.ok(!zone.entities.includes(bullet), "bullet removed");
  assert.ok(zone.entities.includes(monster), "monster lingers as fireball");
  assert.equal(monster._dying, true, "killed monster is dying");
  // Age past the death lifespan (1.0s) → the fireball is removed.
  combat.tickCombat(zone, player, 1.1);
  assert.equal(zone.entities.length, 0, "fireball removed after lifespan");
});

test("point-blank bullet destroys a rigid barrel instead of being eaten by the wall check", () => {
  // Regression: the bullet spawns one tile ahead of the shooter, so when the
  // player is adjacent to a barrel it starts on the barrel's own (rigid,
  // non-walkable) tile. The damage pass must run before bulletHitsWall, or the
  // bullet despawns against the rigid tile having dealt no damage (ammo spent,
  // barrel intact).
  const zone = makeZone();
  const barrel = {
    species_id: 1038, frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Down",
  };
  const bullet = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right",
  };
  zone.entities.push(barrel, bullet);
  const player = { x: 4, y: 5, tileX: 4, tileY: 5 };
  // dps 1800 × 0.2 = 360 > 100 default hp → destroyed in one tick.
  combat.tickCombat(zone, player, 0.2);
  assert.ok(!zone.entities.includes(bullet), "bullet consumed by the hit");
  assert.equal(barrel._dying, true, "barrel destroyed point-blank");
});

test("bullet hitting a wall is consumed without applying damage", () => {
  const zone = makeZone();
  zone.construction[5][5] = CONSTRUCTION.STONE_WALL; // solid wall at (5,5)
  const bullet = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right",
  };
  zone.entities.push(bullet);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };
  combat.tickCombat(zone, player, 0.05);
  assert.equal(zone.entities.length, 0);
});

test("bullet flies over water and lava instead of stopping", () => {
  // Regression: water/lava block walking but must not stop a thrown kunai.
  // The old check used the walk-collision mask, so a bullet died on the
  // first liquid tile.
  for (const liquid of [BIOME.WATER, BIOME.LAVA, BIOME.DARK_WATER]) {
    const zone = makeZone();
    zone.biome[5][5] = liquid;
    zone.collision[5][5] = true;          // liquids are walk-blocking
    const bullet = {
      species_id: 7000, _spawned: true, _vx: 7, _vy: 0, _lifespan: 1.0,
      frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right",
    };
    zone.entities.push(bullet);
    const player = { x: 1, y: 1, tileX: 1, tileY: 1 };
    combat.tickCombat(zone, player, 0.02);
    assert.ok(zone.entities.includes(bullet), `bullet survives over ${liquid}`);
  }
});

test("bullet flies over a wooden fence but stops at a forest", () => {
  // Both block walking; only the forest stops bullets in the original.
  const fenceZone = makeZone();
  fenceZone.construction[5][5] = CONSTRUCTION.WOODEN_FENCE;
  const overFence = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right",
  };
  fenceZone.entities.push(overFence);
  combat.tickCombat(fenceZone, { x: 1, y: 1, tileX: 1, tileY: 1 }, 0.02);
  assert.ok(fenceZone.entities.includes(overFence), "bullet clears a wooden fence");

  const forestZone = makeZone();
  forestZone.construction[5][5] = CONSTRUCTION.FOREST;
  const atForest = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right",
  };
  forestZone.entities.push(atForest);
  combat.tickCombat(forestZone, { x: 1, y: 1, tileX: 1, tileY: 1 }, 0.02);
  assert.ok(!forestZone.entities.includes(atForest), "bullet stops at a forest");
});

test("melee monster overlapping the player applies damage", () => {
  playerHealth.resetPlayerHealth();
  const zone = makeZone();
  const monster = { species_id: 4004, frame: { x: 1, y: 0, w: 1, h: 2 }, direction: "Down" };
  zone.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  combat.tickCombat(zone, player, 0.1); // 100 dps × 0.1 = 10 damage
  const after = playerHealth.getPlayerHp();
  assert.ok(after < before, `hp should drop (was ${before}, now ${after})`);
});

test("melee monster on adjacent tile (just under 0.9 away) damages player", () => {
  playerHealth.resetPlayerHealth();
  const zone = makeZone();
  // Monster on tile (2, 1), player on tile (1, 1). Centres 1.0 apart —
  // outside range. Now slide the monster 0.2 towards the player: centre
  // becomes 0.8 away.
  const monster = { species_id: 4004, frame: { x: 1.8, y: 0, w: 1, h: 2 }, direction: "Left" };
  zone.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  combat.tickCombat(zone, player, 0.05);
  assert.ok(playerHealth.getPlayerHp() < before, "should take damage at 0.8 tile distance");
});

test("melee monster more than 0.9 tiles away does not damage", () => {
  playerHealth.resetPlayerHealth();
  const zone = makeZone();
  const monster = { species_id: 4004, frame: { x: 3, y: 0, w: 1, h: 2 }, direction: "Left" };
  zone.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  combat.tickCombat(zone, player, 0.1);
  assert.equal(playerHealth.getPlayerHp(), before, "no damage when out of range");
});

test("continuous damage from a melee monster stacks every tick (no invuln)", () => {
  playerHealth.resetPlayerHealth();
  const zone = makeZone();
  const monster = { species_id: 4004, frame: { x: 1, y: 0, w: 1, h: 2 }, direction: "Down" };
  zone.entities.push(monster);
  const player = { x: 1, y: 1, tileX: 1, tileY: 1 };

  const before = playerHealth.getPlayerHp();
  // 10 small ticks back-to-back. With the old invuln gate only the first
  // would have landed; now they should all bite.
  for (let i = 0; i < 10; i++) combat.tickCombat(zone, player, 0.05);
  const after = playerHealth.getPlayerHp();
  // 100 dps × 0.5 s = 50 damage (allow a small slack).
  assert.ok(before - after >= 30, `expected ≥30 hp lost, lost ${before - after}`);
});

test("melee monster only damages the player(s) actually in range", () => {
  playerHealth.resetPlayerHealth();
  const zone = makeZone();
  const monster = { species_id: 4004, frame: { x: 1, y: 0, w: 1, h: 2 }, direction: "Down" };
  zone.entities.push(monster);
  // P1 is right next to the monster (in range); P2 is far across the map.
  const p1 = { index: 0, x: 1, y: 1, tileX: 1, tileY: 1 };
  const p2 = { index: 1, x: 15, y: 15, tileX: 15, tileY: 15 };

  combat.tickCombat(zone, [p1, p2], 0.1);
  assert.ok(playerHealth.getPlayerHp(0) < 100, "P1 took damage");
  assert.equal(playerHealth.getPlayerHp(1), 100, "P2 untouched");
});

test("friendly fire OFF: a P1-owned bullet flying through P2 does no damage", async () => {
  playerHealth.resetPlayerHealth();
  const zone = makeZone();
  // Bullet owned by P1 sits exactly on top of P2.
  const bullet = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    _playerIndex: 0,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right",
  };
  zone.entities.push(bullet);
  const p1 = { index: 0, x: 1, y: 1, tileX: 1, tileY: 1 };
  const p2 = { index: 1, x: 5, y: 5, tileX: 5, tileY: 5 };

  // friendlyFire default is false → P2 takes no damage.
  const { saveSettings } = await import("../js/settings.js");
  saveSettings({ friendlyFire: false });
  combat.tickCombat(zone, [p1, p2], 0.05);
  assert.equal(playerHealth.getPlayerHp(1), 100, "no friendly fire");
});

test("friendly fire ON: a P1-owned bullet damages P2 but not P1", async () => {
  playerHealth.resetPlayerHealth();
  const zone = makeZone();
  const bullet = {
    species_id: 7000, _spawned: true, _vx: 0, _vy: 0, _lifespan: 1.0,
    _playerIndex: 0,
    frame: { x: 5, y: 5, w: 1, h: 1 }, direction: "Right",
  };
  zone.entities.push(bullet);
  const p1 = { index: 0, x: 1, y: 1, tileX: 1, tileY: 1 };
  const p2 = { index: 1, x: 5, y: 5, tileX: 5, tileY: 5 };

  const { saveSettings } = await import("../js/settings.js");
  saveSettings({ friendlyFire: true });
  combat.tickCombat(zone, [p1, p2], 0.05);
  assert.ok(playerHealth.getPlayerHp(1) < 100, "P2 took friendly fire damage");
  assert.equal(playerHealth.getPlayerHp(0), 100, "shooter (P1) untouched");
  // Restore default so other tests run with friendly fire off.
  saveSettings({ friendlyFire: false });
});

test("PvP melee hits an enemy player continuously and passes through (not a one-frame burst)", async () => {
  // Regression: in PvP players have 1000 HP and the bullet-vs-player path is a
  // single dt-scaled burst that despawns the bullet + sets a 0.4s invuln. A
  // sword swing (5 short-lived bullets, dps 450) would chip only ~one frame
  // (~7.5) and then be gone — i.e. "no damage". Melee bullets must instead
  // deal continuous dps*dt every frame and pass through (mirrors the Rust core).
  const gm = await import("../js/gameMode.js");
  gm.setGameMode(gm.GAME_MODE.pvp, { realtime: true });
  playerHealth.resetPlayerHealth();
  const zone = makeZone();
  const attacker = { index: 0, x: 0, y: 0, tileX: 0, tileY: 0 };
  const victim = { index: 1, x: 5, y: 5, tileX: 5, tileY: 5 };
  // A stationary melee bullet sitting on the victim, owned by the attacker.
  const bullet = {
    id: -1, species_id: 1166, _spawned: true, _melee: true,
    _dpsOverride: 450, _playerIndex: 0, _vx: 0, _vy: 0, _lifespan: 1.0,
    direction: "Down", frame: { x: 5, y: 5, w: 1, h: 1 },
  };
  zone.entities.push(bullet);

  const hp0 = playerHealth.getPlayerHp(1);
  combat.tickCombat(zone, [attacker, victim], 1 / 60);
  const hp1 = playerHealth.getPlayerHp(1);
  assert.ok(hp1 < hp0, "melee damages the enemy player");
  assert.ok(zone.entities.includes(bullet), "melee bullet passes through (not despawned on a player hit)");

  // Continuous: a second frame keeps biting — the burst path's 0.4s invuln
  // would have made this a no-op.
  combat.tickCombat(zone, [attacker, victim], 1 / 60);
  assert.ok(playerHealth.getPlayerHp(1) < hp1, "melee keeps damaging frame over frame (no i-frame gate)");

  // ...and it never touches the swinger.
  assert.equal(playerHealth.getPlayerHp(0), playerHealth.getPlayerMaxHp(), "swinger is unharmed");
  gm.setGameMode(gm.GAME_MODE.coop);
});
