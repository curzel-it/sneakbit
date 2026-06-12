// botCombat decisions. Armed with ammo, the bot fights: it rotates onto a
// cardinal firing line and shoots (one kunai pass out-damages any early
// monster). Out of ammo it falls back to the defensive layer: flee only
// when HURT and a monster is close, and expose a halo so navigation routes
// around them. An equipped-but-dry weapon (pickups auto-equip whatever was
// walked over) is swapped for one with rounds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorldFromDisk } from "../tools/autoplayWorld.mjs";
import { decideCombat, monsterHalo } from "../js/autoplay/botCombat.js";
import { setPlayerHp, getPlayerMaxHp, resetPlayerHealth } from "../js/playerHealth.js";
import { addAmmo, removeAmmo, getAmmo } from "../js/inventory.js";
import { setEquipped, SLOT_RANGED, DEFAULT_RANGED_WEAPON_ID } from "../js/equipment.js";

loadWorldFromDisk(); // registers species so getSpecies(4003)=CloseCombatMonster

const CHOKEBERRY = 4003;   // a CloseCombatMonster species
const KUNAI = 7000;        // default ranged ammo
const AR15 = 1154;         // WeaponRanged whose bullet (1169) we never stock
const max = getPlayerMaxHp(0);

function drainKunai() {
  const n = getAmmo(KUNAI, 0);
  if (n > 0) removeAmmo(KUNAI, n, 0);
}

// An open zone (all walkable) with one monster at a given tile.
function zoneWithMonster(mx, my) {
  const cols = 12, rows = 12;
  const collision = Array.from({ length: rows }, () => new Array(cols).fill(false));
  return {
    cols, rows, collision,
    entities: [{ id: 77, species_id: CHOKEBERRY, frame: { x: mx, y: my, w: 1, h: 1 } }],
  };
}

function playerAt(x, y, direction = "down") {
  return { tileX: x, tileY: y, direction, index: 0 };
}

function fullReset() {
  resetPlayerHealth(0);
  setPlayerHp(max, 0);
  drainKunai();
  setEquipped(SLOT_RANGED, DEFAULT_RANGED_WEAPON_ID, 0);
}

test("armed + aligned + facing → shoot", () => {
  fullReset();
  addAmmo(KUNAI, 5, 0);
  const state = { player: playerAt(5, 5, "down"), zone: zoneWithMonster(5, 8) };
  const intent = decideCombat(state);
  assert.ok(intent?.shoot, "should fire at an aligned monster it faces");
  assert.equal(intent.target, 77);
});

test("armed + aligned but facing away → rotate first", () => {
  fullReset();
  addAmmo(KUNAI, 5, 0);
  const state = { player: playerAt(5, 5, "up"), zone: zoneWithMonster(5, 8) };
  assert.deepEqual(decideCombat(state), { face: "down" });
});

test("armed + close diagonal → sidestep onto the firing line", () => {
  fullReset();
  addAmmo(KUNAI, 5, 0);
  const state = { player: playerAt(5, 5, "down"), zone: zoneWithMonster(6, 7) };
  const intent = decideCombat(state);
  assert.ok(intent?.move, "should sidestep to align");
  // Zeroing the smaller axis first: dx=1 ≤ dy=2 → step right onto x=6.
  assert.equal(intent.move, "right");
});

test("armed but a wall blocks the line → no shot, no panic while healthy", () => {
  fullReset();
  addAmmo(KUNAI, 5, 0);
  const zone = zoneWithMonster(5, 9);
  zone.collision[7][5] = true; // wall between player (5,5) and monster (5,9)
  const state = { player: playerAt(5, 5, "down"), zone };
  assert.equal(decideCombat(state), null);
});

test("equipped weapon dry but kunai in stock → re-equip intent", () => {
  fullReset();
  addAmmo(KUNAI, 5, 0);
  setEquipped(SLOT_RANGED, AR15, 0); // pickups auto-equip; its 1169 ammo is empty
  const state = { player: playerAt(5, 5, "down"), zone: zoneWithMonster(5, 7) };
  assert.deepEqual(decideCombat(state), { equip: DEFAULT_RANGED_WEAPON_ID });
});

test("unarmed + healthy with a monster adjacent → no reaction (route around)", () => {
  fullReset();
  const state = { player: playerAt(5, 5, "down"), zone: zoneWithMonster(5, 6) };
  assert.equal(decideCombat(state), null);
});

test("unarmed + hurt with a monster close → flee away", () => {
  fullReset();
  setPlayerHp(Math.floor(max * 0.2), 0);
  const state = { player: playerAt(5, 5, "down"), zone: zoneWithMonster(5, 6) };
  const intent = decideCombat(state);
  assert.ok(intent && (intent.flee || intent.hold), "should flee or brace when hurt and threatened");
  if (intent.flee) {
    // Fleeing should not step toward the monster (which is below at y=6).
    assert.notEqual(intent.flee, "down");
  }
});

test("unarmed + hurt but the monster is far → no reaction", () => {
  fullReset();
  setPlayerHp(Math.floor(max * 0.2), 0);
  const state = { player: playerAt(1, 1, "down"), zone: zoneWithMonster(10, 10) };
  assert.equal(decideCombat(state), null);
});

test("monsterHalo blocks the monster tile and its neighbors", () => {
  const halo = monsterHalo(zoneWithMonster(5, 6), { tileX: 5, tileY: 5 });
  assert.ok(halo.has("5,6"), "monster tile is in the halo");
  assert.ok(halo.has("5,7") && halo.has("4,6") && halo.has("6,6"), "neighbors are in the halo");
});

// Always reset so low HP / test ammo / a test loadout can't leak into other
// suites' shared singletons.
fullReset();
