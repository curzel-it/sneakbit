// Infers a per-tile elevation field for the iso renderer from the slope tiles
// authored in the construction grid. Slopes wrap elevated ground: each ramp is
// a local height constraint — it rises one tier from its low edge to its high
// edge — and integrating those constraints across the map recovers the terraced
// height field (peaks, basins and nested terraces all keep their sign, because
// we read each ramp's uphill direction rather than assuming enclosed == higher).
//
// Read-only over the zone: results are memoised per zone object.

import { CONSTRUCTION } from "./constructions.js";

const UP = [-1, 0], DOWN = [1, 0], LEFT = [0, -1], RIGHT = [0, 1];

// Uphill neighbour directions per slope orientation (the +1 side). Perpendicular
// neighbours of an edge ramp are intentionally absent from both tables: the ramp
// is level along that axis, so it must not constrain them.
const HIGH_DIRS = {
  T: [UP], B: [DOWN], L: [LEFT], R: [RIGHT],
  TL: [UP, LEFT], TR: [UP, RIGHT], BR: [DOWN, RIGHT], BL: [DOWN, LEFT],
};
const LOW_DIRS = {
  T: [DOWN], B: [UP], L: [RIGHT], R: [LEFT],
  TL: [DOWN, RIGHT], TR: [DOWN, LEFT], BR: [UP, LEFT], BL: [UP, RIGHT],
};

// slope construction id -> orientation code (TL/TR/BR/BL/T/B/L/R).
const SLOPE_ORIENT = {};
for (const [name, id] of Object.entries(CONSTRUCTION)) {
  const m = /^SLOPE_(?:GREEN|ROCK|SAND|DARKROCK)_(TL|TR|BR|BL|T|B|L|R)$/.exec(name);
  if (m) SLOPE_ORIENT[id] = m[1];
}

export function slopeOrient(id) { return SLOPE_ORIENT[id] ?? null; }
export function isSlope(id) { return SLOPE_ORIENT[id] !== undefined; }

// Height delta implied when stepping from a slope (base level) toward `dir`:
// +1 uphill, 0 downhill, null for perpendicular (unconstrained — skip the edge).
function slopeDelta(orient, dir) {
  const dr = dir[0], dc = dir[1];
  const has = (list) => list.some((d) => d[0] === dr && d[1] === dc);
  if (has(HIGH_DIRS[orient])) return 1;
  if (has(LOW_DIRS[orient])) return 0;
  return null;
}

const DIRS = [UP, DOWN, LEFT, RIGHT];

// The integer elevation between two 4-adjacent tiles, `dir` pointing A -> B.
// A slope stores its base (low) level; a floor stores its ground level. Returns
// the value B must hold given A's value, or null if the edge is unconstrained.
function edgeTarget(aId, bId, aVal, dir) {
  const aSlope = SLOPE_ORIENT[aId];
  const bSlope = SLOPE_ORIENT[bId];
  if (aSlope && bSlope) return aVal;          // ring tiles share a base level
  if (aSlope) {
    const d = slopeDelta(aSlope, dir);
    return d === null ? null : aVal + d;
  }
  if (bSlope) {
    // From B's view the step is B -> A (reverse dir); B.base = A - delta.
    const d = slopeDelta(bSlope, [-dir[0], -dir[1]]);
    return d === null ? null : aVal - d;
  }
  return aVal;                                 // floor to floor: same level
}

const cache = new WeakMap();

// elev[r][c] = integer height tier, normalised so the lowest tile is 0.
export function elevationFor(zone) {
  let elev = cache.get(zone);
  if (elev) return elev;
  elev = computeElevation(zone);
  cache.set(zone, elev);
  return elev;
}

function computeElevation(zone) {
  const { rows, cols, construction } = zone;
  const elev = Array.from({ length: rows }, () => new Array(cols).fill(null));
  if (!rows || !cols) return elev;

  // BFS relaxation across the whole grid (first-writer-wins on contradictions).
  // The grid is fully 4-connected through floor edges, so one sweep fills it.
  const queue = [[0, 0]];
  elev[0][0] = 0;
  let min = 0;
  for (let head = 0; head < queue.length; head++) {
    const [r, c] = queue[head];
    const v = elev[r][c];
    const id = construction[r][c];
    for (const dir of DIRS) {
      const nr = r + dir[0], nc = c + dir[1];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (elev[nr][nc] !== null) continue;
      const target = edgeTarget(id, construction[nr][nc], v, dir);
      if (target === null) continue;
      elev[nr][nc] = target;
      if (target < min) min = target;
      queue.push([nr, nc]);
    }
  }

  // Any tile only reachable through unconstrained (perpendicular) edges stays
  // null; drop it to the floor so nothing renders in mid-air.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      elev[r][c] = (elev[r][c] === null ? min : elev[r][c]) - min;
    }
  }
  return elev;
}
