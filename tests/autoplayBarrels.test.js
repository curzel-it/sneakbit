// botBarrels: opportunistic barrel-smashing. The bot only targets barrels when
// it owns a sword, picks the nearest within a short detour, aims the swing at
// the barrel's FEET tile (its only hittable tile), and skips ones already given
// up on this zone entry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorldFromDisk } from "../tools/autoplayWorld.mjs";
import { planBarrel, faceDirToBarrel, nearbyBarrels, hasSword } from "../js/autoplay/botBarrels.js";
import { setEquipped, clearEquipped, SLOT_MELEE } from "../js/equipment.js";

loadWorldFromDisk();

const SWORD = 1159;        // a WeaponMelee species
const BARREL = 1073;       // an isExplosive StaticObject (1×2)

// An open zone (all walkable) with one barrel. A barrel's frame.y is the TOP
// tile; its feet (the blocking + hittable tile) are one below.
function zoneWithBarrel(topX, topY, id = 90) {
  const cols = 24, rows = 24;
  const collision = Array.from({ length: rows }, () => new Array(cols).fill(false));
  return {
    cols, rows, collision,
    entities: [{ id, species_id: BARREL, frame: { x: topX, y: topY, w: 1, h: 2 } }],
  };
}

function playerAt(x, y) {
  return { tileX: x, tileY: y, direction: "down", index: 0 };
}

function equipSword() {
  setEquipped(SLOT_MELEE, SWORD, 0);
}

test("nearbyBarrels reports the barrel at its feet tile", () => {
  const zone = zoneWithBarrel(5, 5);
  const found = nearbyBarrels(zone);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].tile, { x: 5, y: 6 }); // feet = top + (h-1)
});

test("hasSword: true when a melee weapon is equipped, false otherwise", () => {
  clearEquipped(SLOT_MELEE, 0);
  assert.equal(hasSword(0), false);
  equipSword();
  assert.equal(hasSword(0), true);
});

test("planBarrel finds the nearest reachable barrel when armed with a sword", () => {
  equipSword();
  const zone = zoneWithBarrel(5, 5);
  const target = planBarrel(zone, playerAt(5, 10), new Set());
  assert.ok(target, "should target a nearby barrel");
  assert.equal(target.entity.id, 90);
  assert.deepEqual(target.barrelTile, { x: 5, y: 6 });
  assert.ok(target.standTiles.length > 0, "should expose stand tiles");
  // Every stand tile is a cardinal neighbour of the FEET tile, never the empty
  // top tile (a swing there can't damage the barrel).
  for (const s of target.standTiles) {
    assert.equal(Math.abs(s.x - 5) + Math.abs(s.y - 6), 1, `stand tile ${s.x},${s.y} adjacent to feet`);
  }
});

test("planBarrel returns null with no sword", () => {
  clearEquipped(SLOT_MELEE, 0);
  const zone = zoneWithBarrel(5, 5);
  assert.equal(planBarrel(zone, playerAt(5, 10), new Set()), null);
  equipSword();
});

test("planBarrel skips a barrel parked in the blocked set", () => {
  equipSword();
  const zone = zoneWithBarrel(5, 5);
  const skip = new Set(["barrel:90"]);
  assert.equal(planBarrel(zone, playerAt(5, 10), skip), null);
});

test("planBarrel ignores barrels beyond the detour cap", () => {
  equipSword();
  const zone = zoneWithBarrel(20, 20); // feet at (20,21), ~30 tiles away
  assert.equal(planBarrel(zone, playerAt(1, 1), new Set()), null);
});

test("faceDirToBarrel points at the feet tile from each side", () => {
  const feet = { x: 5, y: 6 };
  assert.equal(faceDirToBarrel(playerAt(5, 7), feet), "up");
  assert.equal(faceDirToBarrel(playerAt(5, 5), feet), "down");
  assert.equal(faceDirToBarrel(playerAt(6, 6), feet), "left");
  assert.equal(faceDirToBarrel(playerAt(4, 6), feet), "right");
  assert.equal(faceDirToBarrel(playerAt(7, 8), feet), null); // not adjacent
});
