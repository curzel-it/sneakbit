// Mob AI uses pure helpers we can test directly. The full tick imports
// zone.js (no DOM) so we can run it end-to-end too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData, getSpecies } from "../js/species.js";
import { entityHittableFrame } from "../js/entityVisibility.js";
import { tickMobs, chaseDirections, canEnter } from "../js/mobs.js";

// Minimal species table: one chase monster, one wandering NPC, one wall.
loadSpeciesData([
  { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
    movement_directions: "FindHero", dps: 100, hp: 200,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 4001, entity_type: "Npc", sprite_sheet_id: 1014,
    movement_directions: "Free",
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

function makeZone(walk = () => true) {
  return { cols: 20, rows: 20, entities: [], collision: makeCollision(20, 20, walk) };
}

function makeCollision(rows, cols, walk) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(!walk(c, r));
    grid.push(row);
  }
  return grid;
}

test("chaseDirections returns nothing when player is out of vision range", () => {
  const e = { _ai: { tileX: 0, tileY: 0, h: 1 } };
  const player = { tileX: 12, tileY: 0 };
  assert.deepEqual(chaseDirections(e, player), []);
});

test("chaseDirections targets the longer-axis direction first", () => {
  const e = { _ai: { tileX: 5, tileY: 5, h: 1 } };
  const right = { tileX: 8, tileY: 6 };  // dx 3, dy 1 → right first
  assert.deepEqual(chaseDirections(e, right), ["right", "down"]);
  const up = { tileX: 4, tileY: 1 };     // dy 4, dx -1 → up first
  assert.deepEqual(chaseDirections(e, up), ["up", "left"]);
});

function tickFor(zone, players, seconds, dt = 1 / 60, each = () => {}) {
  for (let t = 0; t < seconds; t += dt) { tickMobs(zone, players, dt); each(); }
}

const feetDist = (mob, p) => Math.hypot(mob.frame.x + 0.5 - (p.x + 0.5), mob.frame.y + 1.5 - (p.y + 0.5));

test("FindHero mob steers smoothly toward the player", () => {
  const zone = makeZone();
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 }, direction: "Down" };
  zone.entities.push(mob);
  const player = { tileX: 8, tileY: 7, x: 8.3, y: 7.4 };
  tickMobs(zone, player, 0.05);
  assert.ok(mob._ai, "ai state created");
  assert.equal(mob._ai.step, null, "no tile step while chasing");
  assert.equal(mob.moving, true);
  assert.ok(mob.frame.x > 5 && mob.frame.y > 5, "moved diagonally toward the player");
  assert.ok(mob.frame.x % 1 !== 0, "off the grid");
  assert.equal(mob.direction, "Right");
  let reached = false, bumped = false;
  tickFor(zone, player, 3, 1 / 60, () => {
    const d = feetDist(mob, player);
    if (d <= 0.9) reached = true;
    else if (reached && mob._ai.step?.hop) bumped = true;
  });
  assert.ok(reached, "got into melee range");
  assert.ok(bumped, "recoils after the bump");
});

test("FindHero mob wanders when the player is out of vision range", () => {
  const zone = makeZone();
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  zone.entities.push(mob);
  // Player far away (Manhattan distance > VISION_TILES=6).
  const player = { tileX: 19, tileY: 19, x: 19, y: 19 };
  tickMobs(zone, player, 0.02);
  assert.ok(mob._ai.step, "wander step started even though player is out of vision");
});

test("FindHero mob is blocked across the full width of a tall obstacle's base", () => {
  // A 4-wide × 4-tall rigid building. Its hittable (feet) rect covers the
  // bottom rows across all four columns, so a mob can't slip past on the
  // right edge — every column of the base blocks.
  loadSpeciesData([
    { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
      movement_directions: "FindHero", dps: 100, hp: 200,
      sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
    { id: 1100, entity_type: "Building", is_rigid: true, sprite_sheet_id: 1014,
      sprite_frame: { x: 0, y: 0, w: 4, h: 4 } },
  ]);
  const zone = makeZone();
  // Building covers (10..13, 10..13). Place the mob next to its east wall.
  zone.entities.push({ species_id: 1100, frame: { x: 10, y: 10, w: 4, h: 4 } });
  const mob = { species_id: 4004, frame: { x: 14, y: 12, w: 1, h: 2 } };
  zone.entities.push(mob);
  // Player is two tiles west — chase wants 'left' onto the building's base
  // row (13, 13). That tile is inside the feet rect and must be blocked.
  const player = { tileX: 12, tileY: 13, x: 12, y: 13 };
  tickFor(zone, player, 0.5);
  const base = entityHittableFrame(zone.entities[0], getSpecies(1100));
  assert.ok(mob.frame.x + 0.2 >= base.x + base.w - 1e-6, `mob clipped into the building base, x=${mob.frame.x}`);
});

test("a tall obstacle's top row does not block a mover (walk-behind)", () => {
  loadSpeciesData([
    { id: 1100, entity_type: "Building", is_rigid: true, sprite_sheet_id: 1014,
      sprite_frame: { x: 0, y: 0, w: 1, h: 3 } },
  ]);
  const zone = makeZone();
  // Building at (10,10) is 1×3: feet rect covers its bottom two rows
  // (11, 12); its head row (10) is walk-behind, like every tall sprite.
  zone.entities.push({ species_id: 1100, frame: { x: 10, y: 10, w: 1, h: 3 } });
  const mover = { _ai: { tileX: 0, tileY: 0, w: 1, h: 1 } };
  assert.ok(canEnter(zone, mover, 10, 10), "head row should be walkable");
  assert.ok(!canEnter(zone, mover, 10, 11), "base row should block");
  assert.ok(!canEnter(zone, mover, 10, 12), "base row should block");
});

test("2x2 mover: only the feet row collides, full width is checked", () => {
  loadSpeciesData([
    { id: 1137, entity_type: "Npc", sprite_sheet_id: 1016,
      movement_directions: "Free", sprite_frame: { x: 0, y: 0, w: 2, h: 2 } },
  ]);
  // Wall at the mover's RIGHT foot tile (11, 5); its left foot (10, 5) is clear.
  const zone = makeZone((c, r) => !(c === 11 && r === 5));
  const mover = { _ai: { tileX: 0, tileY: 0, w: 2, h: 2 } };
  // Stepping so feet land on row 5 must fail — pre-fix code only checked the
  // bottom-left tile and would have let the right half clip the wall.
  assert.ok(!canEnter(zone, mover, 10, 4), "right foot tile must be checked");
  // A wall on the mover's HEAD row (top) must NOT block — feet are on row 6.
  const headWall = makeZone((c, r) => !(c === 10 && r === 5));
  assert.ok(canEnter(headWall, mover, 10, 5), "head row should not collide");
});

test("2x2 mover walks behind another 2x2 humanoid's head row", () => {
  loadSpeciesData([
    { id: 1137, entity_type: "Npc", sprite_sheet_id: 1016,
      movement_directions: "Free", sprite_frame: { x: 0, y: 0, w: 2, h: 2 } },
  ]);
  const zone = makeZone();
  // An idle 2×2 humanoid obstacle at (10,10): its feet rect is row 11.
  zone.entities.push({ species_id: 1137, frame: { x: 10, y: 10, w: 2, h: 2 } });
  const mover = { _ai: { tileX: 0, tileY: 0, w: 2, h: 2 } };
  // Mover whose feet land on the obstacle's HEAD row (10) may pass...
  assert.ok(canEnter(zone, mover, 10, 9), "head row of a 2x2 must not block");
  // ...but feet overlapping the obstacle's feet row (11) are blocked.
  assert.ok(!canEnter(zone, mover, 10, 10), "feet row of a 2x2 must block");
});

test("FindHero mob targets the closest live player in co-op", () => {
  loadSpeciesData([
    { id: 4004, entity_type: "CloseCombatMonster", sprite_sheet_id: 1023,
      movement_directions: "FindHero", dps: 100, hp: 200,
      sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  ]);
  const zone = makeZone();
  const mob = { species_id: 4004, frame: { x: 5, y: 5, w: 1, h: 2 } };
  zone.entities.push(mob);
  // P1 is far (out of vision), P2 is close: the mob chases P2.
  const p1 = { tileX: 18, tileY: 18, x: 18, y: 18 };
  const p2 = { tileX: 9, tileY: 6, x: 9, y: 6 };
  tickMobs(zone, [p1, p2], 0.05);
  assert.equal(mob._ai.step, null);
  assert.ok(mob.frame.x > 5, "heading for P2");
  assert.ok(mob.frame.y === 5, "P2 is level with the mob's feet");
});

test("FindHero mob gets around a wall between it and the player", () => {
  // A wall at column 8 from row 0 to row 9, open below. The mob starts west
  // of it, the player east: steering alone would pin the mob on the wall.
  const zone = makeZone((c, r) => !(c === 8 && r <= 9));
  const mob = { species_id: 4004, frame: { x: 6, y: 4, w: 1, h: 2 } };
  zone.entities.push(mob);
  const player = { tileX: 10, tileY: 5, x: 10, y: 5 };
  let best = Infinity;
  tickFor(zone, player, 8, 1 / 60, () => { best = Math.min(best, feetDist(mob, player)); });
  assert.ok(best <= 0.9, `reached the player, closest=${best} at ${mob.frame.x},${mob.frame.y}`);
});
