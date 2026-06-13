// Tower Defense maps: a Bloons-style run is a sequence of maps. Each map has a
// fixed, immediately-visible SAND PATH (a serpentine track painted in the
// desert biome over the grass) that the horde is hard-locked to — the flow
// field is computed once per map over the path tiles only, so monsters never
// leave the sand. Between that map's waves, batches of off-path FOREST
// obstacles pop up to crowd the heroes' movement (the monsters are unaffected).
//
// After a few waves the controller advances to the next map: a fresh, harder
// path (more lanes → longer/twistier) with a denser obstacle schedule. Higher
// `mapIndex` ⇒ more complexity.
//
// Generation is pure (Math.random only) and never mutates the raw zone; the
// controller builds the zone, then this module paints the path and reveals
// obstacle batches at runtime via setBiomeTile / setConstructionTile, evicting
// the zone's baked canvas once per batch.

import { constructionFromChar, constructionIsObstacle, CONSTRUCTION } from "./constructions.js";
import { BIOME } from "./biomes.js";
import { setConstructionTile, setBiomeTile } from "./zone.js";
import { evictZoneCache } from "./zoneCache.js";
import { computeFlowField, fieldDirection, isReachable, dirDelta } from "./flowField.js";

// — Forest theme ——————————————————————————————————————————————————————————
// The one level we ship today is a forest, so obstacles are dense woods (an
// obstacle that also stops bullets) and the path reads as a desert trail. A
// second theme would become a one-line table keyed on the board here.
const WALL_TYPE = CONSTRUCTION.FOREST;
const PATH_BIOME = BIOME.DESERT;

// — Generation tuning —————————————————————————————————————————————————————
const BASE_LANES = 3;       // winding waypoints on map 0; +1 per map
const MAX_LANES = 7;
const CLEAR_PORTAL = 1;     // tiles kept obstacle-free around spawns + goal
const OBSTACLES_BASE = 8;   // off-path tiles revealed per wave on map 0 …
const OBSTACLES_PER_MAP = 6; // … plus this much per map

// — Per-map runtime state —————————————————————————————————————————————————
let path = new Set();       // "x,y" of every track tile (sand; the monster route)
let fillOrder = [];         // [{x,y}] off-path obstacle schedule (shuffled)
let cursor = 0;             // next index in fillOrder to reveal

export function resetMaze() {
  path = new Set();
  fillOrder = [];
  cursor = 0;
}

export function installMap(map) {
  path = map?.path || new Set();
  fillOrder = Array.isArray(map?.fillOrder) ? map.fillOrder.slice() : [];
  cursor = 0;
}

// Flow-field grid where ONLY the path is walkable, so the monster field keeps
// the horde on the sand no matter what obstacles have grown off-path. Computed
// once per map (the path never changes), so obstacle reveals skip the recompute.
export function monsterGrid(zone) {
  return {
    cols: zone.cols,
    rows: zone.rows,
    isBlocked: (x, y) => !path.has(key(x, y)),
  };
}

// Paint the installed path into the desert biome so the track is visible from
// the start, then re-bake the zone canvas once.
export function paintPath(zone) {
  if (!zone) return;
  for (const k of path) {
    const [x, y] = k.split(",");
    setBiomeTile(zone, x | 0, y | 0, PATH_BIOME);
  }
  evictZoneCache(zone);
}

// Reveal the next `count` scheduled obstacles as forest, then re-bake once. No
// field recompute — the monster field is path-only and obstacles never touch
// the path; heroes read the live collision grid (allyAI builds it per call).
export function revealNextObstacles(zone, count) {
  if (!zone) return 0;
  let n = 0;
  while (cursor < fillOrder.length && n < count) {
    const t = fillOrder[cursor++];
    setConstructionTile(zone, t.x, t.y, WALL_TYPE);
    n++;
  }
  if (n > 0) evictZoneCache(zone);
  return n;
}

export function revealAll(zone) {
  return revealNextObstacles(zone, Infinity);
}

export function mazeProgress() {
  return { revealed: cursor, total: fillOrder.length };
}

// Off-path tiles to reveal per wave — denser on later maps.
export function obstacleBatch(mapIndex) {
  return OBSTACLES_BASE + Math.max(0, mapIndex | 0) * OBSTACLES_PER_MAP;
}

// — Generation ————————————————————————————————————————————————————————————
// Builds map `mapIndex` from the board's td.goal + td.spawns. Returns
//   { path: Set<"x,y">, fillOrder: [{x,y}], heroSpawns: [{x,y}, …] }
// without mutating rawZone (the path is painted / obstacles revealed at runtime).
export function generateMap(rawZone, mapIndex = 0) {
  const td = rawZone?.td || {};
  const rows = rawZone.construction_tiles.tiles;
  const H = rows.length;
  const W = rows[0]?.length || 0;
  const mi = Math.max(0, mapIndex | 0);

  const isOpen = (x, y) =>
    x >= 0 && y >= 0 && x < W && y < H &&
    !constructionIsObstacle(constructionFromChar(rows[y][x]));

  // Open interior bounding box (inside the forest border).
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isOpen(x, y)) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }

  const goal = td.goal ? { x: td.goal.x | 0, y: td.goal.y | 0 } : { x: maxX, y: (minY + maxY) >> 1 };
  const spawns = Array.isArray(td.spawns) && td.spawns.length ? td.spawns : [{ x: minX, y: (minY + maxY) >> 1 }];
  const sx = Math.round(spawns.reduce((s, p) => s + (p.x | 0), 0) / spawns.length);
  const sy = Math.round(spawns.reduce((s, p) => s + (p.y | 0), 0) / spawns.length);

  // The arena is an irregular blob (holes everywhere), so we don't carve a
  // geometric corridor — at width 1 a single hole would shatter it. Instead we
  // ROUTE the track over the open tiles with the flow field, so the 1-tile path
  // is connected by construction on any board shape.
  const openGrid = { cols: W, rows: H, isBlocked: (x, y) => !isOpen(x, y) };
  const goalField = computeFlowField(openGrid, goal);
  const reachable = (x, y) => isReachable(goalField, x, y);

  // Anchor on the spawn tile nearest the band centre that can actually reach the
  // goal over open ground.
  const anchor = spawns
    .map((s) => ({ x: s.x | 0, y: s.y | 0 }))
    .filter((s) => isOpen(s.x, s.y) && reachable(s.x, s.y))
    .sort((a, b) =>
      (Math.abs(a.x - sx) + Math.abs(a.y - sy)) - (Math.abs(b.x - sx) + Math.abs(b.y - sy)))[0]
    || { x: goal.x, y: goal.y };

  // The open region's top/bottom edge at a column (reachable tiles only) — the
  // turning points for the winding waypoints.
  const colExtremes = (cx) => {
    let top = -1, bot = -1;
    for (let yy = 0; yy < H; yy++) {
      if (!isOpen(cx, yy) || !reachable(cx, yy)) continue;
      if (top < 0) top = yy;
      bot = yy;
    }
    return top < 0 ? null : { top, bot };
  };

  // Winding waypoints: evenly spaced columns between the spawn and the goal,
  // alternating between the open region's top and bottom edge. More columns on
  // later maps → a longer, twistier track.
  const firstCol = clamp(anchor.x + 2, minX, goal.x - 1);
  const lastCol = Math.max(firstCol, goal.x - 1);
  const nCols = clamp(BASE_LANES + mi, 2, MAX_LANES);
  const waypoints = [anchor];
  let up = Math.random() < 0.5;
  for (let i = 0; i < nCols; i++) {
    const t = nCols === 1 ? 0 : i / (nCols - 1);
    const cx = clamp(Math.round(firstCol + t * (lastCol - firstCol)) + randInt(-1, 1), minX, lastCol);
    const ext = colExtremes(cx);
    if (!ext) continue;
    waypoints.push({ x: cx, y: up ? ext.top : ext.bot });
    up = !up;
  }
  waypoints.push({ x: goal.x, y: goal.y });

  // Stitch the waypoints into one ordered, de-duplicated 1-tile path. Each
  // segment is routed over open ground and continues from the last tile actually
  // reached, so the whole track is connected spawn→goal by construction.
  const route = routeWaypoints(openGrid, waypoints);
  const set = new Set();
  const centerLine = [];
  for (const t of route) {
    const k = key(t.x, t.y);
    if (!set.has(k)) { set.add(k); centerLine.push(t); }
  }
  // Join every enemy spawn to the track over open ground, so no monster is ever
  // stranded off the path it must follow.
  for (const s of spawns) {
    const seg = routeOpen(openGrid, { x: s.x | 0, y: s.y | 0 }, anchor);
    if (seg) for (const t of seg) set.add(key(t.x, t.y));
  }

  // Hero starts: two distinct track tiles around the centre-line midpoint.
  const mid = centerLine.length >> 1;
  const heroSpawns = [
    centerLine[mid] || { x: sx, y: sy },
    centerLine[Math.min(centerLine.length - 1, mid + 4)] || centerLine[mid] || { x: sx, y: sy },
  ].map((t) => ({ x: t.x, y: t.y }));

  // A tiny obstacle-free zone around each portal so trees don't crowd them.
  const clear = new Set();
  const stamp = (cx, cy, r) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) clear.add(key(cx + dx, cy + dy));
  };
  stamp(goal.x, goal.y, CLEAR_PORTAL);
  for (const s of spawns) stamp(s.x | 0, s.y | 0, CLEAR_PORTAL);

  // Obstacle schedule: every open interior tile that's off the path and not a
  // portal clear tile, shuffled so trees pop up scattered, then coalesce.
  const fill = [];
  for (let yy = minY; yy <= maxY; yy++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isOpen(x, yy)) continue;
      const k = key(x, yy);
      if (set.has(k) || clear.has(k)) continue;
      fill.push({ x, y: yy });
    }
  }
  shuffle(fill);

  return { path: set, fillOrder: fill, heroSpawns };
}

// Walk a chain of waypoints into one continuous tile list. Each leg is routed
// from the last tile actually reached (not the requested waypoint), so an
// unreachable waypoint is simply skipped without breaking continuity.
function routeWaypoints(grid, waypoints) {
  const out = [waypoints[0]];
  let cur = waypoints[0];
  for (let i = 1; i < waypoints.length; i++) {
    const seg = routeOpen(grid, cur, waypoints[i]);
    if (!seg) continue;
    for (let j = 1; j < seg.length; j++) out.push(seg[j]);
    cur = waypoints[i];
  }
  return out;
}

// The shortest open-tile path from `from` to `to`, as an ordered tile list
// (inclusive of both ends), or null if `to` is unreachable from `from`. Walks
// the flow-field gradient computed toward `to`.
function routeOpen(grid, from, to) {
  const field = computeFlowField(grid, to);
  if (!isReachable(field, from.x, from.y)) return null;
  const out = [{ x: from.x, y: from.y }];
  let cx = from.x, cy = from.y;
  let guard = grid.cols * grid.rows + 4;
  while ((cx !== to.x || cy !== to.y) && guard-- > 0) {
    const d = fieldDirection(field, cx, cy);
    if (!d) break;
    const [dx, dy] = dirDelta(d);
    cx += dx; cy += dy;
    out.push({ x: cx, y: cy });
  }
  return out;
}

function key(x, y) { return `${x},${y}`; }

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
