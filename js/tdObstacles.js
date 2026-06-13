// Tower Defense scenery: scatters a handful of lone trees across the open arena
// every time the board boots, so no two runs look alike.
//
// The trees are real construction obstacles (rigid, flow-field-blocking), woven
// into the raw construction grid BEFORE buildZone — so collision, neighbour
// auto-tiling and the horde's flow field all treat them exactly like the
// surrounding woods, with no extra wiring. The input rawZone is never mutated
// (the loader caches it), so each boot re-randomises.
//
// Placement stays sparse and well-spaced ("lone" trees, never clumps) and every
// tree sits on fully-open ground — all 8 neighbours walkable — which keeps the
// spawn pocket, the exit tunnel and the arena edges clear and, because no two
// trees ever touch, guarantees the horde always has a way around.

import { constructionFromChar, constructionIsObstacle } from "./constructions.js";

// Various kinds: broadleaf, spoiled, wine, purple-broadleaf, bamboo. Each is an
// obstacle whose isolated (no same-type neighbour) sprite is a single lone tree.
const TREE_CHARS = ["F", "J", "K", "N", "9"];
const COUNT_MIN = 10;
const COUNT_MAX = 18;
const SPACING = 2;          // min Chebyshev gap between trees → no clumps, no pinch
const CLEAR_PORTALS = 2;    // tiles kept clear around every spawn tile + the goal
const CLEAR_HEROES = 3;     // breathing room around the squad's start tiles

// A shallow clone of rawZone whose construction grid has random lone trees
// scattered through the open arena. rawZone is left untouched.
export function withRandomObstacles(rawZone) {
  const td = rawZone?.td || {};
  const rows = rawZone.construction_tiles.tiles.map((r) => r.split(""));
  const H = rows.length;
  const W = rows[0]?.length || 0;

  // The board's biome is uniform grass, so walkability is purely the
  // construction layer here.
  const walkable = (x, y) =>
    x >= 0 && y >= 0 && x < W && y < H &&
    !constructionIsObstacle(constructionFromChar(rows[y][x]));
  const surroundedByFloor = (x, y) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (!walkable(x + dx, y + dy)) return false;
    return true;
  };
  const within = (x, y, pts, r) =>
    pts.some((p) => Math.abs((p.x | 0) - x) <= r && Math.abs((p.y | 0) - y) <= r);

  const goalPts = td.goal ? [td.goal] : [];
  const spawnPts = Array.isArray(td.spawns) ? td.spawns : [];
  const heroPts = Array.isArray(td.heroSpawns) ? td.heroSpawns : [];

  const candidates = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!surroundedByFloor(x, y)) continue;
      if (within(x, y, goalPts, CLEAR_PORTALS)) continue;
      if (within(x, y, spawnPts, CLEAR_PORTALS)) continue;
      if (within(x, y, heroPts, CLEAR_HEROES)) continue;
      candidates.push({ x, y });
    }
  }

  shuffle(candidates);
  const target = COUNT_MIN + Math.floor(Math.random() * (COUNT_MAX - COUNT_MIN + 1));
  const placed = [];
  for (const c of candidates) {
    if (placed.length >= target) break;
    if (placed.some((p) => Math.abs(p.x - c.x) <= SPACING && Math.abs(p.y - c.y) <= SPACING)) continue;
    rows[c.y][c.x] = TREE_CHARS[Math.floor(Math.random() * TREE_CHARS.length)];
    placed.push(c);
  }

  const tiles = rows.map((r) => r.join(""));
  return { ...rawZone, construction_tiles: { ...rawZone.construction_tiles, tiles } };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
