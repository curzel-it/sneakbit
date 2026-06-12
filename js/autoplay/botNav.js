// Tile-level navigation for the autoplay bot. Plain breadth-first search
// over the LIVE engine zone (ground truth — no analysis-model overlay).
// The caller may pass a monster-halo avoid set; it's advisory, with a
// fall-through to the un-avoided path when the halo seals a corridor, so
// it can't reproduce the discarded prototype's avoid-halo oscillation
// (and botCombat engages anything that close regardless). Converts the
// next path tile into a held-direction input and detects stalls so the
// orchestrator can replan.
//
// Walkability mirrors player.js::canEnter for the no-push / no-key case:
// an enterable teleporter overrides everything; otherwise a tile must be
// terrain-walkable and free of blocking entities. Pushables, closed gates
// and locked teleporters all read as blocked here, so the walk-only bot
// routes around them (botPush handles pushables in M2).

import { isWalkable, isEntityBlocked, hasEnterableTeleporter } from "../zone.js";
import { walkPath } from "./puzzleSolver.js";

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
// tile); every OTHER tile must pass isNavWalkable. `avoid` (optional Set of
// "x,y") is treated as blocked EXCEPT for goal tiles — used to route around
// monster halos; the caller retries without it when avoidance dead-ends.
export function findPath(zone, start, goalSet, avoid = null) {
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
      if (!isGoal && (!isNavWalkable(zone, nx, ny) || (avoid && avoid.has(key)))) continue;
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

// Stateful navigator for PUZZLE movement, following an engine-true walk path
// from the solver (puzzleSolver.walkPath) so it can thread self-weight gates,
// box bridges and pinned-box climbs that a plain live-collision BFS misses.
// tick() takes the live box layout (a Map<entityId,{x,y}>) since gate state
// depends on where the boxes currently sit. Recomputes only on stall / leaving
// the path, so the (cheap) flood runs rarely.
export function makePuzzleNav(model) {
  let goalTiles = null;
  let path = null;
  let lastTileKey = null;
  let stallTicks = 0;
  let recomputes = 0;

  function setGoal(tiles) {
    goalTiles = tiles.map((t) => ({ x: t.x, y: t.y }));
    path = null;
    lastTileKey = null;
    stallTicks = 0;
    recomputes = 0;
  }

  function tick(player, boxLayout) {
    if (!goalTiles || goalTiles.length === 0) return { status: "blocked", dir: null };
    if (goalTiles.some((t) => t.x === player.tileX && t.y === player.tileY)) {
      return { status: "arrived", dir: null };
    }
    const tk = `${player.tileX},${player.tileY}`;
    if (tk !== lastTileKey) { lastTileKey = tk; stallTicks = 0; recomputes = 0; }
    else if (!player.step) stallTicks++;

    const needRecompute = !path
      || !path.some((t) => t.x === player.tileX && t.y === player.tileY)
      || stallTicks >= STALL_TICKS;
    if (needRecompute) {
      if (stallTicks >= STALL_TICKS) {
        recomputes++;
        stallTicks = 0;
        if (recomputes > MAX_RECOMPUTES) return { status: "blocked", dir: null };
      }
      path = walkPath(model, { x: player.tileX, y: player.tileY }, goalTiles, { pushableStarts: boxLayout, barrelsBlock: true, avoidTeleporters: true });
      if (!path) return { status: "blocked", dir: null };
    }
    const idx = path.findIndex((t) => t.x === player.tileX && t.y === player.tileY);
    const next = path[idx + 1];
    if (!next) return { status: "arrived", dir: null };
    return { status: "moving", dir: stepDirection({ x: player.tileX, y: player.tileY }, next) };
  }

  return { setGoal, tick };
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

  // Returns { status: "moving"|"arrived"|"blocked", dir }. `avoid` (optional
  // Set of "x,y") routes the path around monster halos; if avoidance leaves
  // no path we fall back to the un-avoided route (push through — the hero
  // out-runs and out-heals the chip damage rather than wedging).
  function tick(player, zone, avoid = null) {
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
      const start = { x: player.tileX, y: player.tileY };
      path = findPath(zone, start, goalSet, avoid)
        ?? findPath(zone, start, goalSet, null);
      if (!path) return { status: "blocked", dir: null };
    }

    let idx = path.findIndex((t) => t.x === player.tileX && t.y === player.tileY);
    let next = path[idx + 1];
    // A monster may have drifted onto the cached path since it was computed
    // — stepping into the live halo is how the bot used to walk straight
    // into roamers. Recompute around the current halo before committing the
    // step; if the halo seals the corridor, keep the un-avoided step (the
    // combat layer engages anything that close anyway).
    if (next && avoid && avoid.has(`${next.x},${next.y}`) && !goalSet.has(`${next.x},${next.y}`)) {
      const start = { x: player.tileX, y: player.tileY };
      const detour = findPath(zone, start, goalSet, avoid);
      if (detour) {
        path = detour;
        idx = 0;
        next = path[1];
      }
    }
    if (!next) return { status: "arrived", dir: null };
    return { status: "moving", dir: stepDirection({ x: player.tileX, y: player.tileY }, next) };
  }

  return { setGoal, tick };
}
