// Tower Defense maps — the per-map generator and the runtime tile mutators.
// Pure node (no DOM): the live path-locking + obstacle reveal run end-to-end in
// tests/e2e/towerDefense.test.mjs. Here we prove the generated sand path always
// connects every spawn to the goal, obstacles never touch it, difficulty scales
// with the map index, and setConstructionTile / setBiomeTile flip the grids.

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateMap, obstacleBatch } from "../js/tdMaze.js";
import { buildZone, isWalkable, setConstructionTile, setBiomeTile } from "../js/zone.js";
import { computeFlowField, allReachable } from "../js/flowField.js";
import { CONSTRUCTION, constructionFromChar, constructionIsObstacle } from "../js/constructions.js";
import { BIOME } from "../js/biomes.js";
import { loadSpeciesData } from "../js/species.js";

loadSpeciesData([]);

// A grass arena (biome "1") with a forest border (construction "8") and an open
// interior, mirroring the real TD board: a left spawn band and a goal punched
// through the right border.
const W = 24, H = 14;
const GOAL = { x: W - 1, y: 7 };
const SPAWNS = [{ x: 2, y: 6 }, { x: 2, y: 7 }, { x: 2, y: 8 }];

function makeRaw() {
  const con = [];
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      const goalGap = x === GOAL.x && y === GOAL.y;
      row += border && !goalGap ? "8" : "0";
    }
    con.push(row);
  }
  return {
    id: 1401,
    biome_tiles: { sheet_id: 1002, tiles: con.map((r) => "1".repeat(W)) },
    construction_tiles: { sheet_id: 1003, tiles: con },
    entities: [],
    td: { goal: GOAL, spawns: SPAWNS },
  };
}

const key = (x, y) => `${x},${y}`;
const pathGrid = (path) => ({ cols: W, rows: H, isBlocked: (x, y) => !path.has(key(x, y)) });

test("the sand path connects every spawn to the goal", () => {
  const { path } = generateMap(makeRaw(), 0);
  for (const s of SPAWNS) assert.ok(path.has(key(s.x, s.y)), `spawn ${s.x},${s.y} on the path`);
  assert.ok(path.has(key(GOAL.x, GOAL.y)), "goal on the path");
  const field = computeFlowField(pathGrid(path), GOAL);
  assert.ok(allReachable(field, SPAWNS), "every spawn reaches the goal along the path");
});

test("every path tile is walkable open ground (never on the border / an obstacle)", () => {
  const raw = makeRaw();
  const { path } = generateMap(raw, 2);
  for (const k of path) {
    const [x, y] = k.split(",").map(Number);
    const c = constructionFromChar(raw.construction_tiles.tiles[y][x]);
    assert.ok(!constructionIsObstacle(c), `path tile ${k} is open`);
  }
});

test("obstacles are always off the path (the route is never blocked)", () => {
  const { path, fillOrder } = generateMap(makeRaw(), 3);
  for (const t of fillOrder) assert.ok(!path.has(key(t.x, t.y)), `obstacle ${t.x},${t.y} off-path`);
  // Even with every obstacle revealed, the path-only field still routes spawns
  // to the goal (obstacles can't touch the path).
  const field = computeFlowField(pathGrid(path), GOAL);
  assert.ok(allReachable(field, SPAWNS), "path stays solvable with all obstacles up");
});

test("hero starts sit on the path", () => {
  const { path, heroSpawns } = generateMap(makeRaw(), 0);
  assert.equal(heroSpawns.length, 2);
  for (const h of heroSpawns) assert.ok(path.has(key(h.x, h.y)), `hero start ${h.x},${h.y} on the path`);
});

test("difficulty scales with the map index — longer path, denser obstacles", () => {
  assert.ok(obstacleBatch(3) > obstacleBatch(0), "later maps reveal more obstacles per wave");
  const easy = generateMap(makeRaw(), 0).path.size;
  const hard = generateMap(makeRaw(), 4).path.size;
  assert.ok(hard > easy, `harder map has a longer path (${hard} > ${easy})`);
});

test("setConstructionTile blocks the tile and refreshes the autotiling row", () => {
  const zone = buildZone(makeRaw());
  const x = 5, y = 5;
  assert.ok(isWalkable(zone, x, y), "interior starts walkable");
  setConstructionTile(zone, x, y, CONSTRUCTION.FOREST);
  assert.equal(zone.construction[y][x], CONSTRUCTION.FOREST);
  assert.ok(!isWalkable(zone, x, y), "forest tile now blocks");
  assert.ok(zone.constructionRow[y][x] > 0, "autotiling row recomputed for the new tile");
});

test("setBiomeTile repaints the biome and keeps open ground walkable", () => {
  const zone = buildZone(makeRaw());
  const x = 6, y = 6;
  setBiomeTile(zone, x, y, BIOME.DESERT);
  assert.equal(zone.biome[y][x], BIOME.DESERT);
  assert.ok(isWalkable(zone, x, y), "sand over open ground stays walkable");
});
