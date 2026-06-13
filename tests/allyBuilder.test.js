// Tower Defense ally BUILDER — the pure between-waves decision core. Drives an
// idle ally to herd loose stones toward the exit. The live squad behaviour runs
// in tests/e2e/towerDefense.test.mjs; here we exercise planBuilderMove on small
// synthetic boards (no tdBoard singletons), mirroring tests/allyAI.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import { planBuilderMove } from "../js/allyBuilder.js";
import { STONE_SPECIES } from "../js/tdStones.js";
import { loadSpeciesData } from "../js/species.js";
import { computeFlowField } from "../js/flowField.js";
import { isWalkable } from "../js/zone.js";
import { stoneBlocksTile } from "../js/tdStones.js";

// stoneBlocksTile / isPushable look the boulder up by species, so register it.
loadSpeciesData([{ id: STONE_SPECIES, entity_type: "PushableObject", sprite_sheet_id: 1010 }]);

const hero = (tileX, tileY, index = 1) => ({ tileX, tileY, index });

// A TD-shaped zone: collision[y][x], stones as PushableObject entities. Mirrors
// tdZone in tests/allyAI.test.js.
function tdZone(cols, rows, { walls = [], stones = [] } = {}) {
  const collision = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  for (const [x, y] of walls) collision[y][x] = true;
  const entities = stones.map(([x, y], i) => ({
    id: -100 - i, species_id: STONE_SPECIES, frame: { x, y, w: 1, h: 1 },
  }));
  return { cols, rows, collision, entities };
}

// The live flow field for a zone (walls + stones blocked), as tdBoard builds it.
function fieldFor(zone, goal) {
  return computeFlowField({
    cols: zone.cols,
    rows: zone.rows,
    isBlocked: (x, y) => !isWalkable(zone, x, y) || stoneBlocksTile(zone, x, y),
  }, goal);
}

const move = (zone, h, goal, spawns, claims = new Map()) =>
  planBuilderMove({ zone, hero: h, stones: zone.entities, field: fieldFor(zone, goal), goal, spawns, claims });

// — Navigate to the push stance, then push goal-ward ——————————————————————————

test("ally navigates toward the tile behind a loose stone", () => {
  // Open lane, goal at the right. Stone at (3,1); its push stance is (2,1).
  const zone = tdZone(7, 3, { stones: [[3, 1]] });
  const intent = move(zone, hero(0, 1), { x: 6, y: 1 }, [{ x: 0, y: 1 }]);
  assert.equal(intent.kind, "navigate");
  assert.equal(intent.dir, "right"); // step toward the stance at (2,1)
});

test("ally on the push stance shoves the stone toward the goal", () => {
  const zone = tdZone(7, 3, { stones: [[3, 1]] });
  const intent = move(zone, hero(2, 1), { x: 6, y: 1 }, [{ x: 0, y: 1 }]);
  assert.equal(intent.kind, "push");
  assert.equal(intent.dir, "right"); // shove the stone one tile toward (6,1)
});

// — Parked: already in the exit band ——————————————————————————————————————————

test("a stone within the exit standoff is parked (idle)", () => {
  // Stone at (5,1) is one tile from the goal (6,1) — inside EXIT_STANDOFF.
  const zone = tdZone(7, 3, { stones: [[5, 1]] });
  const intent = move(zone, hero(0, 1), { x: 6, y: 1 }, [{ x: 0, y: 1 }]);
  assert.equal(intent.kind, "idle");
});

// — Seal guard: never close the last gap ——————————————————————————————————————

test("a push that would seal the goal off is refused (idle)", () => {
  // A 1-wide tunnel (rows 0 and 2 walled): shoving the stone keeps it in the
  // only corridor, which seals the spawn off from the goal — so it's refused.
  const walls = [];
  for (let x = 0; x < 7; x++) { walls.push([x, 0]); walls.push([x, 2]); }
  const zone = tdZone(7, 3, { walls, stones: [[2, 1]] });
  const intent = move(zone, hero(1, 1), { x: 6, y: 1 }, [{ x: 0, y: 1 }]);
  assert.equal(intent.kind, "idle");
});

test("the same push is allowed when a parallel lane keeps the goal reachable", () => {
  // Two-wide corridor (only row 0 walled): shoving the stone in row 1 leaves
  // row 2 open, so the goal stays reachable and the push is allowed.
  const walls = [];
  for (let x = 0; x < 7; x++) walls.push([x, 0]);
  const zone = tdZone(7, 3, { walls, stones: [[2, 1]] });
  const intent = move(zone, hero(1, 1), { x: 6, y: 1 }, [{ x: 0, y: 1 }]);
  assert.equal(intent.kind, "push");
  assert.equal(intent.dir, "right");
});

// — Player-placed stones are off-limits ———————————————————————————————————————

test("a stone the player shoved (_playerPlaced) is never targeted", () => {
  const zone = tdZone(7, 3, { stones: [[3, 1]] });
  zone.entities[0]._playerPlaced = true; // the human moved this one
  const intent = move(zone, hero(0, 1), { x: 6, y: 1 }, [{ x: 0, y: 1 }]);
  assert.equal(intent.kind, "idle"); // builder leaves it to the player
});

test("a builder ignores a player-placed stone but still herds a loose one", () => {
  const zone = tdZone(7, 4, { stones: [[3, 1], [3, 2]] });
  zone.entities[0]._playerPlaced = true; // (3,1) is the player's
  const intent = move(zone, hero(2, 2), { x: 6, y: 1 }, [{ x: 0, y: 1 }]);
  assert.equal(intent.kind, "push");          // works the loose (3,2) stone
  assert.equal(intent.stoneId, zone.entities[1].id);
});

// — Two allies don't fight over the same stone ————————————————————————————————

test("two builders claim different stones via the shared claims map", () => {
  const zone = tdZone(7, 4, { stones: [[3, 1], [3, 2]] });
  const goal = { x: 6, y: 1 };
  const spawns = [{ x: 0, y: 1 }];
  const claims = new Map();
  const a = move(zone, hero(0, 1, 0), goal, spawns, claims);
  const b = move(zone, hero(0, 2, 1), goal, spawns, claims);
  assert.ok(a.stoneId != null && b.stoneId != null);
  assert.notEqual(a.stoneId, b.stoneId);
  assert.equal(claims.size, 2);
});
