// Grid path-finding: breadth-first search over walkable tiles. The only
// consumer today is afterDialogue.js's "WalkToNearestExit" behavior, which
// routes a departing NPC to the closest reachable teleporter — but the
// primitive is deliberately game-agnostic so anything tile-locked can reuse
// it.
//
// Walkability is delegated to zone.js::isWalkable (the static collision grid).
// Rigid entities aren't considered — for a scaffold an NPC clipping past
// another prop on its way out is acceptable; tighten with isEntityBlocked
// later if it matters.

import { isWalkable } from "./zone.js";

const NEIGHBOURS = [
  [ 0, -1],
  [ 0,  1],
  [-1,  0],
  [ 1,  0],
];

// BFS from (startX, startY) to whichever of `goals` is reachable in the
// fewest steps. `goals` is an array of { x, y } tiles. Returns the path as
// an array of tiles from the first step up to and including the goal
// (the start tile itself is omitted), or null if no goal is reachable.
// The start tile need not be walkable — an NPC standing on a non-walkable
// footprint can still leave it.
export function findPathToNearest(zone, startX, startY, goals) {
  if (!zone || !Array.isArray(goals) || goals.length === 0) return null;
  const sx = startX | 0;
  const sy = startY | 0;
  const goalKeys = new Set(goals.map((g) => `${g.x | 0},${g.y | 0}`));

  const seen = new Set([`${sx},${sy}`]);
  const cameFrom = new Map();
  let queue = [[sx, sy]];

  while (queue.length) {
    const next = [];
    for (const [x, y] of queue) {
      if (goalKeys.has(`${x},${y}`) && !(x === sx && y === sy)) {
        return reconstruct(cameFrom, x, y);
      }
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        if (!isWalkable(zone, nx, ny)) continue;
        seen.add(key);
        cameFrom.set(key, [x, y]);
        next.push([nx, ny]);
      }
    }
    queue = next;
  }
  return null;
}

// Flood-fill every walkable tile reachable from any of `starts` (4-directional,
// matching player movement). `starts` is an array of { x, y } seed tiles; a
// seed need not itself be walkable (a teleporter can sit on a door tile), but
// only walkable tiles are collected and expanded through. Returns a Set of
// "x,y" keys. Use it to separate "walkable" from "actually reachable" — a
// walled-off pocket of floor is walkable yet the player can never stand on it.
export function reachableTiles(zone, starts) {
  const reached = new Set();
  if (!zone || !Array.isArray(starts) || starts.length === 0) return reached;

  let queue = [];
  for (const s of starts) {
    const key = `${s.x | 0},${s.y | 0}`;
    if (reached.has(key)) continue;
    reached.add(key);
    queue.push([s.x | 0, s.y | 0]);
  }

  while (queue.length) {
    const next = [];
    for (const [x, y] of queue) {
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (reached.has(key)) continue;
        if (!isWalkable(zone, nx, ny)) continue;
        reached.add(key);
        next.push([nx, ny]);
      }
    }
    queue = next;
  }
  return reached;
}

function reconstruct(cameFrom, gx, gy) {
  const path = [{ x: gx, y: gy }];
  let key = `${gx},${gy}`;
  while (cameFrom.has(key)) {
    const [px, py] = cameFrom.get(key);
    path.push({ x: px, y: py });
    key = `${px},${py}`;
  }
  path.pop(); // drop the start tile — the walker is already there
  path.reverse();
  return path;
}
