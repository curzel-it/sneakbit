// botCombat survival decisions. These monsters are non-rigid, unkillable
// bullet-sponges, so the layer is purely defensive: flee only when HURT and a
// monster is close, and expose a halo so navigation routes around them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorldFromDisk } from "../tools/autoplayWorld.mjs";
import { decideCombat, monsterHalo } from "../js/autoplay/botCombat.js";
import { setPlayerHp, getPlayerMaxHp, resetPlayerHealth } from "../js/playerHealth.js";

loadWorldFromDisk(); // registers species so getSpecies(4003)=CloseCombatMonster

const CHOKEBERRY = 4003; // a CloseCombatMonster species
const max = getPlayerMaxHp(0);

// An open zone (all walkable) with one monster at a given tile.
function zoneWithMonster(mx, my) {
  const cols = 12, rows = 12;
  const collision = Array.from({ length: rows }, () => new Array(cols).fill(false));
  return {
    cols, rows, collision,
    entities: [{ species_id: CHOKEBERRY, frame: { x: mx, y: my, w: 1, h: 1 } }],
  };
}

test("healthy with a monster adjacent → no reaction (push through / route around)", () => {
  resetPlayerHealth(0);
  setPlayerHp(max, 0);
  const state = { player: { tileX: 5, tileY: 5, direction: "down", index: 0 }, zone: zoneWithMonster(5, 6) };
  assert.equal(decideCombat(state), null);
});

test("hurt with a monster close → flee away", () => {
  resetPlayerHealth(0);
  setPlayerHp(Math.floor(max * 0.2), 0);
  const state = { player: { tileX: 5, tileY: 5, direction: "down", index: 0 }, zone: zoneWithMonster(5, 6) };
  const intent = decideCombat(state);
  assert.ok(intent && (intent.flee || intent.hold), "should flee or brace when hurt and threatened");
  if (intent.flee) {
    // Fleeing should not step toward the monster (which is below at y=6).
    assert.notEqual(intent.flee, "down");
  }
});

test("hurt but the monster is far → no reaction", () => {
  resetPlayerHealth(0);
  setPlayerHp(Math.floor(max * 0.2), 0);
  const state = { player: { tileX: 1, tileY: 1, direction: "down", index: 0 }, zone: zoneWithMonster(10, 10) };
  assert.equal(decideCombat(state), null);
});

test("monsterHalo blocks the monster tile and its neighbors", () => {
  const halo = monsterHalo(zoneWithMonster(5, 6), { tileX: 5, tileY: 5 });
  assert.ok(halo.has("5,6"), "monster tile is in the halo");
  assert.ok(halo.has("5,7") && halo.has("4,6") && halo.has("6,6"), "neighbors are in the halo");
});

// Always reset so a low HP set here can't leak into other suites' shared
// playerHealth singleton.
resetPlayerHealth(0);
