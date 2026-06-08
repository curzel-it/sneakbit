// Tower Defense flow-field: a BFS out from the goal tile over the walkable
// grid, producing a per-tile "next step toward the goal" gradient. Every TD
// enemy reads the arrow on its current tile and steps that way, so the horde
// routes around whatever barricades the player has placed — without each mob
// running its own path search. Recompute only when the walkable grid changes
// (a barricade placed/removed); at runtime it's a table read.
//
// Generalises pathfinding.js's single-target BFS into a full field. Kept pure
// and grid-agnostic — it takes a tiny grid abstraction, not a zone — so it's
// trivially unit-testable and has no dependency on the rest of the engine.
//
//   grid = { cols, rows, isBlocked(x, y) }   // isBlocked === not walkable
//   goal = { x, y }
//
// The anti-wall-off rule (you can't fully seal the goal off from the spawns)
// falls straight out of the field: if a spawn tile has no finite distance to
// the goal, the placement that produced this field is illegal.

const DIR_DELTA = {
  up:    [0, -1],
  down:  [0,  1],
  left:  [-1, 0],
  right: [1,  0],
};
// Cardinal from a tile to the neighbour it was discovered from. The four
// neighbours are visited in this fixed order during BFS so the resulting
// gradient is deterministic for a given grid + goal.
const NEIGHBOURS = [
  ["up",    0, -1],
  ["down",  0,  1],
  ["left", -1,  0],
  ["right", 1,  0],
];

// The direction that points back toward where a tile was reached from — i.e.
// one step closer to the goal. If you step `dir` you move toward the goal.
const TOWARD_GOAL = { up: "down", down: "up", left: "right", right: "left" };

// Build the flow field. Returns { cols, rows, goal, dist, dir } where:
//   dist[i] — BFS distance (in steps) from tile i to the goal, or Infinity.
//   dir[i]  — cardinal direction to step from tile i to get one step closer
//             to the goal, or null at the goal itself / on unreachable tiles.
export function computeFlowField(grid, goal) {
  const { cols, rows } = grid;
  const n = cols * rows;
  const dist = new Array(n).fill(Infinity);
  const dir = new Array(n).fill(null);
  const idx = (x, y) => y * cols + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;

  const field = { cols, rows, goal: { x: goal.x, y: goal.y }, dist, dir };

  if (!inBounds(goal.x, goal.y) || grid.isBlocked(goal.x, goal.y)) return field;

  dist[idx(goal.x, goal.y)] = 0;
  let frontier = [[goal.x, goal.y]];
  while (frontier.length) {
    const next = [];
    for (const [x, y] of frontier) {
      const d = dist[idx(x, y)];
      for (const [name, dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (dist[ni] !== Infinity) continue;
        if (grid.isBlocked(nx, ny)) continue;
        dist[ni] = d + 1;
        // We reached (nx, ny) from (x, y), which is one step closer to the
        // goal. From (nx, ny) you step toward (x, y) — the reverse of the
        // neighbour direction we walked.
        dir[ni] = TOWARD_GOAL[name];
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return field;
}

export function fieldDistance(field, x, y) {
  if (!field || x < 0 || y < 0 || x >= field.cols || y >= field.rows) return Infinity;
  return field.dist[y * field.cols + x];
}

// The cardinal direction a TD enemy on (x, y) should step to approach the
// goal, or null if it's on the goal or can't reach it.
export function fieldDirection(field, x, y) {
  if (!field || x < 0 || y < 0 || x >= field.cols || y >= field.rows) return null;
  return field.dir[y * field.cols + x];
}

export function isReachable(field, x, y) {
  return Number.isFinite(fieldDistance(field, x, y));
}

// Reachability check: true only if EVERY tile in `tiles` (e.g. the spawn
// tiles) can still reach the goal in this field — i.e. the goal isn't sealed
// off from any of them.
export function allReachable(field, tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) return true;
  for (const t of tiles) {
    if (!isReachable(field, t.x, t.y)) return false;
  }
  return true;
}

// Step delta for a direction name — re-exported so consumers don't redefine
// the table.
export function dirDelta(name) {
  return DIR_DELTA[name] || null;
}
