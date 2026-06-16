// Procedural dungeon generator: schema validity, lock-colour discipline, and
// guaranteed solvability across seeds and room counts — with a negative
// control proving the solver actually discriminates.

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateDungeon, MAX_ROOMS } from "../js/dungeonGen.js";
import { isDungeonSolvable } from "../js/dungeonSolver.js";

const TOP_LEVEL_KEYS = [
  "id", "world_type", "biome_tiles", "construction_tiles", "entities",
  "cutscenes", "light_conditions", "soundtrack", "ephemeral_state", "revision",
];

const ENTITY_KEYS = [
  "after_dialogue", "contents", "demands_attention", "destination", "dialogues",
  "direction", "display_conditions", "frame", "id", "is_consumable",
  "lock_type", "species_id",
];

const isPlate = (e) => e.species_id >= 1050 && e.species_id <= 1055;
const isGate = (e) => e.species_id >= 1040 && e.species_id <= 1045;
const isInverseGate = (e) => e.species_id >= 1060 && e.species_id <= 1065;
const isTeleporter = (e) => e.species_id === 1019;

test("emits a schema-valid Dungeon zone", () => {
  const z = generateDungeon({ id: 9100, seed: 1, rooms: 4 });
  for (const k of TOP_LEVEL_KEYS) assert.ok(k in z, `missing top-level key ${k}`);
  assert.equal(z.id, 9100);
  assert.equal(z.world_type, "Dungeon");
  assert.equal(z.biome_tiles.tiles.length, z.construction_tiles.tiles.length);
  // Rectangular tile grid.
  const w = z.biome_tiles.tiles[0].length;
  for (const row of z.biome_tiles.tiles) assert.equal(row.length, w);
  // Every entity carries the full field set the engine expects.
  for (const e of z.entities) {
    for (const k of ENTITY_KEYS) assert.ok(k in e, `entity ${e.id} missing ${k}`);
  }
});

test("uses distinct lock colours, matched plates and gates", () => {
  const z = generateDungeon({ id: 9101, seed: 7, rooms: MAX_ROOMS });
  const plates = z.entities.filter(isPlate);
  const colours = plates.map((p) => p.lock_type);
  // One plate per colour, never a duplicate (plate state is global per colour).
  assert.equal(new Set(colours).size, colours.length);
  // Every plate colour has a matching forward gate.
  const gateColours = new Set(z.entities.filter(isGate).map((g) => g.lock_type));
  for (const c of colours) assert.ok(gateColours.has(c), `no gate for ${c}`);
});

test("always demonstrates both gate types", () => {
  for (let seed = 0; seed < 8; seed++) {
    const z = generateDungeon({ id: 9102, seed, rooms: 3 });
    assert.ok(z.entities.some(isGate), "expected a normal gate");
    assert.ok(z.entities.some(isInverseGate), "expected an inverse gate");
  }
});

test("entrance teleporter is first, exit is last", () => {
  const z = generateDungeon({ id: 9103, seed: 2, rooms: 4 });
  const teleporters = z.entities.filter(isTeleporter);
  assert.equal(teleporters.length, 2);
  assert.equal(z.entities.findIndex(isTeleporter), 0, "entrance must be first entity");
  assert.equal(z.entities.at(-1).species_id, 1019, "exit must be last entity");
});

test("every generated dungeon is solvable (room counts x seeds)", () => {
  for (let rooms = 1; rooms <= MAX_ROOMS; rooms++) {
    for (let seed = 0; seed < 12; seed++) {
      const z = generateDungeon({ id: 9200 + rooms, seed, rooms });
      assert.ok(isDungeonSolvable(z), `unsolvable: rooms=${rooms} seed=${seed}`);
    }
  }
});

test("solver discriminates: removing a box makes it unsolvable", () => {
  const z = generateDungeon({ id: 9300, seed: 3, rooms: 2 });
  assert.ok(isDungeonSolvable(z));
  // Drop the first box: the room it gated can no longer be opened.
  const broken = structuredClone(z);
  const boxIdx = broken.entities.findIndex((e) => e.species_id === 1030);
  broken.entities.splice(boxIdx, 1);
  assert.equal(isDungeonSolvable(broken), false);
});

test("is deterministic for a given seed", () => {
  const a = generateDungeon({ id: 9400, seed: 99, rooms: 4 });
  const b = generateDungeon({ id: 9400, seed: 99, rooms: 4 });
  assert.deepEqual(a, b);
});
