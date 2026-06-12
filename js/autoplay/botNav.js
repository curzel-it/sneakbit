// Tile-level navigation for the autoplay bot. Plain breadth-first search
// over the LIVE engine zone (ground truth — no analysis-model overlay, no
// monster-avoid halo: the discarded prototype's avoid-halos oscillated
// routes forever, so combat preempts nav instead, never nav avoiding
// combat). Converts the next path tile into a held-direction input and
// detects stalls so the orchestrator can replan.
//
// Walkability mirrors player.js::canEnter for the no-push / no-key case:
// an enterable teleporter overrides everything; otherwise a tile must be
// terrain-walkable and free of blocking entities. Pushables, closed gates
// and locked teleporters all read as blocked here, so the walk-only bot
// routes around them (botPush handles pushables in M2).

import { isWalkable, isEntityBlocked, hasEnterableTeleporter } from "../zone.js";

const DIR_DELTA = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

// Bot ticks (~50ms each) a tile may stay unchanged before we treat it as a
// stall. One step is ~0.22s ≈ 4-5 ticks, so this leaves slack for a step in
// flight before deciding we're wedged.
const STALL_TICKS = 12;
// Consecutive recomputes that make no progress before reporting failure up.
const MAX_RECOMPUTES = 4;

export function isNavWalkable(zone, x, y) {
  if (hasEnterableTeleporter(zone, x, y)) return true;
  if (!isWalkable(zone, x, y)) return false;
  if (isEntityBlocked(zone, x, y)) return false;
  return true;
}

// Cardinal direction to step from `from` to the adjacent tile `to`, or null
// if they're not 4-adjacent. Pure.
export function stepDirection(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return "right";
  if (dx === -1 && dy === 0) return "left";
  if (dx === 0 && dy === 1) return "down";
  if (dx === 0 && dy === -1) return "up";
  return null;
}

// BFS shortest path of tiles from `start` to the nearest goal in `goalSet`
// (a Set of "x,y" keys), inclusive of both endpoints. Returns an array of
// {x,y} or null if no goal is reachable. The start tile is always seeded
// even if it currently reads unwalkable (the player may stand on a special
// tile); every OTHER tile must pass isNavWalkable.
export function findPath(zone, start, goalSet) {
  const startKey = `${start.x},${start.y}`;
  if (goalSet.has(startKey)) return [{ x: start.x, y: start.y }];
  const prev = new Map([[startKey, null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const dir of ["up", "down", "left", "right"]) {
      const [dx, dy] = DIR_DELTA[dir];
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (prev.has(key)) continue;
      const isGoal = goalSet.has(key);
      if (!isGoal && !isNavWalkable(zone, nx, ny)) continue;
      prev.set(key, cur);
      if (isGoal) return reconstruct(prev, { x: nx, y: ny });
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

function reconstruct(prev, end) {
  const path = [];
  for (let cur = end; cur; cur = prev.get(`${cur.x},${cur.y}`)) {
    path.unshift(cur);
  }
  return path;
}

// Stateful navigator toward a set of goal tiles. Each tick it returns the
// direction to hold (or an arrived/blocked status). Owns the path cache and
// stall bookkeeping; the orchestrator owns the actual input held-set.
export function makeNavigator() {
  let goalSet = null;
  let path = null;
  let lastTileKey = null;
  let stallTicks = 0;
  let recomputes = 0;

  function setGoal(tiles) {
    goalSet = new Set(tiles.map((t) => `${t.x},${t.y}`));
    path = null;
    lastTileKey = null;
    stallTicks = 0;
    recomputes = 0;
  }

  // Returns { status: "moving"|"arrived"|"blocked", dir }.
  function tick(player, zone) {
    if (!goalSet || goalSet.size === 0) return { status: "blocked", dir: null };
    const tileKey = `${player.tileX},${player.tileY}`;
    if (goalSet.has(tileKey)) return { status: "arrived", dir: null };

    // Progress / stall accounting (only meaningful when idle — a step in
    // flight is progress even though the canonical tile hasn't snapped yet).
    if (tileKey !== lastTileKey) {
      lastTileKey = tileKey;
      stallTicks = 0;
      recomputes = 0;
    } else if (!player.step) {
      stallTicks++;
    }

    const needRecompute =
      !path ||
      !path.some((t) => t.x === player.tileX && t.y === player.tileY) ||
      stallTicks >= STALL_TICKS;
    if (needRecompute) {
      if (stallTicks >= STALL_TICKS) {
        recomputes++;
        stallTicks = 0;
        if (recomputes > MAX_RECOMPUTES) return { status: "blocked", dir: null };
      }
      path = findPath(zone, { x: player.tileX, y: player.tileY }, goalSet);
      if (!path) return { status: "blocked", dir: null };
    }

    const idx = path.findIndex((t) => t.x === player.tileX && t.y === player.tileY);
    const next = path[idx + 1];
    if (!next) return { status: "arrived", dir: null };
    return { status: "moving", dir: stepDirection({ x: player.tileX, y: player.tileY }, next) };
  }

  return { setGoal, tick };
}
