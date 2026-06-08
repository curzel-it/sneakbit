// Procedural monster placement: determinism (the co-op-safety property),
// density, exclusions, spacing, species split, and opt-out.

import { test } from "node:test";
import assert from "node:assert/strict";

const { generateMonsters } = await import("../js/spawnMonsters.js");

const SPECIES_BLACKBERRY = 4004;
const SPECIES_CHOKEBERRY = 4003;
const TELEPORTER_SPECIES_ID = 1019;

// A bare open zone: every tile walkable, no authored entities.
function openZone(id, rows, cols) {
  const collision = Array.from({ length: rows }, () => new Array(cols).fill(false));
  return { id, rows, cols, collision, entities: [] };
}

function dist(a, b) {
  return Math.hypot(a.frame.x - b.frame.x, a.frame.y - b.frame.y);
}

test("same zone + same seed is byte-identical (co-op safety)", () => {
  const z = openZone(1002, 40, 40);
  const raw = { monster_spawn: { density: 0.05 } };
  const a = generateMonsters(z, raw);
  const b = generateMonsters(z, raw);
  assert.ok(a.length > 0);
  assert.deepEqual(a, b);
});

test("different zone ids produce different layouts", () => {
  const raw = { monster_spawn: { density: 0.05 } };
  const a = generateMonsters(openZone(1002, 40, 40), raw);
  const b = generateMonsters(openZone(1003, 40, 40), raw);
  assert.notDeepEqual(a.map((e) => [e.frame.x, e.frame.y]), b.map((e) => [e.frame.x, e.frame.y]));
});

test("count tracks density (within spacing tolerance)", () => {
  const z = openZone(1002, 60, 60); // 3600 eligible tiles
  const g = generateMonsters(z, { monster_spawn: { density: 0.01 } });
  // target ~36; spacing may trim it, but it should be in a sane band.
  assert.ok(g.length >= 25 && g.length <= 36, `got ${g.length}`);
});

test("no monster on a blocked tile", () => {
  const z = openZone(1002, 30, 30);
  // Wall off the left half.
  for (let y = 0; y < 30; y++) for (let x = 0; x < 15; x++) z.collision[y][x] = true;
  const g = generateMonsters(z, { monster_spawn: { density: 0.1 } });
  assert.ok(g.length > 0);
  for (const m of g) assert.equal(z.collision[m.frame.y][m.frame.x], false);
});

test("keeps clear of teleporters and authored footprints", () => {
  const z = openZone(1002, 30, 30);
  const raw = {
    monster_spawn: { density: 0.2 },
    entities: [
      { species_id: TELEPORTER_SPECIES_ID, frame: { x: 15, y: 15, w: 1, h: 1 } },
      { species_id: 9999, frame: { x: 2, y: 2, w: 3, h: 3 } }, // an authored NPC/building
    ],
  };
  const g = generateMonsters(z, raw);
  assert.ok(g.length > 0);
  for (const m of g) {
    // never inside the authored footprint
    const inNpc = m.frame.x >= 2 && m.frame.x < 5 && m.frame.y >= 2 && m.frame.y < 5;
    assert.ok(!inNpc, `monster inside authored footprint at ${m.frame.x},${m.frame.y}`);
    // never within the teleporter clear radius (4)
    assert.ok(Math.hypot(m.frame.x - 15, m.frame.y - 15) >= 4, `monster too close to teleporter`);
  }
});

test("never spawns in a walkable-but-unreachable pocket", () => {
  const z = openZone(1002, 20, 20);
  // Wall off column x=10 top-to-bottom, sealing the right half (x>10) into a
  // walkable pocket the player can never reach.
  for (let y = 0; y < 20; y++) z.collision[y][10] = true;
  const raw = {
    monster_spawn: { density: 0.5 },
    // A wired teleporter (has a destination) on the LEFT half seeds the flood.
    entities: [
      { species_id: TELEPORTER_SPECIES_ID, destination: { world: 1003, x: 0, y: 0 }, frame: { x: 2, y: 2, w: 1, h: 1 } },
    ],
  };
  const g = generateMonsters(z, raw);
  assert.ok(g.length > 0);
  for (const m of g) assert.ok(m.frame.x < 10, `monster in sealed pocket at ${m.frame.x},${m.frame.y}`);
});

test("no teleporter to seed from leaves placement unfiltered", () => {
  const z = openZone(1002, 20, 20);
  for (let y = 0; y < 20; y++) z.collision[y][10] = true;
  // No wired teleporter → can't compute reachability → both halves stay eligible.
  const g = generateMonsters(z, { monster_spawn: { density: 0.5 } });
  assert.ok(g.some((m) => m.frame.x > 10), "expected spawns on both sides when unfiltered");
});

test("respects minimum spacing between generated monsters", () => {
  const z = openZone(1002, 40, 40);
  const g = generateMonsters(z, { monster_spawn: { density: 0.1 } });
  assert.ok(g.length > 1);
  for (let i = 0; i < g.length; i++)
    for (let j = i + 1; j < g.length; j++)
      assert.ok(dist(g[i], g[j]) >= 4, `pair ${i},${j} closer than 4`);
});

test("species split honours chokeberry_chance", () => {
  const z = openZone(1002, 40, 40);
  const all4004 = generateMonsters(z, { monster_spawn: { density: 0.05, chokeberry_chance: 0 } });
  assert.ok(all4004.every((e) => e.species_id === SPECIES_BLACKBERRY));

  const all4003 = generateMonsters(z, { monster_spawn: { density: 0.05, chokeberry_chance: 1 } });
  assert.ok(all4003.every((e) => e.species_id === SPECIES_CHOKEBERRY));
});

test("tolerates authored entities at sub-tile (fractional) positions", () => {
  const z = openZone(1002, 30, 30);
  const raw = {
    monster_spawn: { density: 0.2 },
    // Decorations are placed with fractional x/y; the exclusion mask must
    // floor/ceil rather than index the grid with a fractional row (which threw).
    entities: [{ species_id: 1030, frame: { x: 10.15, y: 12.30875, w: 1, h: 1 } }],
  };
  let g;
  assert.doesNotThrow(() => { g = generateMonsters(z, raw); });
  assert.ok(g.length > 0);
  // The integer tiles the fractional footprint overlaps stay clear.
  for (const m of g) {
    const onDecor = m.frame.x >= 10 && m.frame.x <= 11 && m.frame.y >= 12 && m.frame.y <= 13;
    assert.ok(!onDecor, `monster on fractional footprint at ${m.frame.x},${m.frame.y}`);
  }
});

test("opt-out: no monster_spawn field generates nothing", () => {
  const z = openZone(1002, 40, 40);
  assert.deepEqual(generateMonsters(z, {}), []);
  assert.deepEqual(generateMonsters(z, { monster_spawn: { density: 0 } }), []);
});

test("generated monsters are marked ephemeral with distinct negative ids", () => {
  const z = openZone(1002, 40, 40);
  const g = generateMonsters(z, { monster_spawn: { density: 0.05 } });
  const ids = new Set();
  for (const m of g) {
    assert.equal(m._generated, true);
    assert.ok(m.id <= -9_000_000, `id ${m.id} not in generated band`);
    assert.ok(!ids.has(m.id), "duplicate id");
    ids.add(m.id);
  }
});
