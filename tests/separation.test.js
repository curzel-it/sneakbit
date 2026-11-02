import { test } from "node:test";
import assert from "node:assert/strict";

import { tickSeparation } from "../js/separation.js";
import { loadSpeciesData } from "../js/species.js";

loadSpeciesData([
  { id: 4004, entity_type: "CloseCombatMonster", movement_directions: "FindHero",
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
]);

function makeZone(entities = []) {
  const n = 20;
  return {
    cols: n, rows: n, entities,
    collision: Array.from({ length: n }, () => Array(n).fill(false)),
    biome: Array.from({ length: n }, () => Array(n).fill(1)),
  };
}

function run(zone, players, isRemote, frames = 60) {
  for (let i = 0; i < frames; i++) tickSeparation(zone, players, 1 / 60, isRemote);
}

test("stacked local players drift apart", () => {
  const a = { x: 5, y: 5 }, b = { x: 5, y: 5 };
  run(makeZone(), [a, b]);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 0.55, "pushed apart");
});

test("a remote avatar is never moved; the local one yields", () => {
  const local = { x: 5, y: 5 }, remote = { x: 5.2, y: 5, playerId: "g" };
  run(makeZone(), [local, remote], (p) => !!p.playerId);
  assert.equal(remote.x, 5.2);
  assert.ok(remote.x - local.x > 0.55);
});

test("a monster on top of a player is shoved out, but stays in melee reach", () => {
  const mob = { species_id: 4004, frame: { x: 5, y: 4, w: 1, h: 2 } };
  const p = { x: 5.1, y: 5 };
  run(makeZone([mob]), [p]);
  const d = Math.hypot(mob.frame.x + 0.5 - (p.x + 0.5), mob.frame.y + 1.5 - (p.y + 0.5));
  assert.ok(d > 0.55 && d < 0.9, `separated to ${d}`);
  assert.equal(p.x, 5.1, "players aren't pushed by monsters");
});

test("players don't get pushed into walls", () => {
  const zone = makeZone();
  zone.collision[5][4] = true;
  const a = { x: 5, y: 5 }, b = { x: 5.05, y: 5 };
  run(zone, [a, b]);
  assert.ok(a.x >= 4.8 - 1e-9, `a stayed out of the wall, x=${a.x}`);
});
