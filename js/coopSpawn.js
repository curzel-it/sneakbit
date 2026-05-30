// Picks the spawn tile for a co-op partner (local P2 or a freshly
// joined network guest) relative to a reference player. Starts from
// the four cardinal neighbours and expands outward in BFS order so a
// reference player standing in a tight pocket (every cardinal walled
// or occupied) still ends up with the partner on a distinct, nearby
// walkable tile instead of overlapping. The four-direction BFS is
// seeded in [facing, ...rest] order, which preserves the prior
// "prefer the tile in front" behaviour for the common open-corridor
// case while only widening the search when the immediate neighbours
// are unavailable.

import { isWalkable, isEntityBlocked } from "./zone.js?v=20260531a";

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};
const DIRS = ["up", "down", "left", "right"];

// Hard cap on tiles examined. Zones top out around ~80×80, so this is
// generous enough to escape any reachable pocket while still bounding
// the worst-case fully-walled-off scenario (would otherwise scan the
// whole grid before returning the fallback).
const MAX_VISITED = 4096;

export function pickCoopSpawn(reference, zone) {
  if (!zone || !reference) {
    return { x: reference?.tileX ?? 0, y: reference?.tileY ?? 0 };
  }
  const startX = reference.tileX | 0;
  const startY = reference.tileY | 0;
  const order = orderedDirs(reference.direction);

  const visited = new Set();
  visited.add(key(startX, startY));
  const queue = [];
  for (const d of order) {
    const [dx, dy] = DIR_DELTA[d];
    enqueue(queue, visited, startX + dx, startY + dy, zone);
  }
  while (queue.length > 0 && visited.size < MAX_VISITED) {
    const { x, y } = queue.shift();
    if (isSpawnableTile(zone, x, y)) return { x, y };
    for (const d of order) {
      const [dx, dy] = DIR_DELTA[d];
      enqueue(queue, visited, x + dx, y + dy, zone);
    }
  }
  return { x: startX, y: startY };
}

function isSpawnableTile(zone, x, y) {
  if (x < 0 || y < 0 || x >= zone.cols || y >= zone.rows) return false;
  if (!isWalkable(zone, x, y)) return false;
  if (isEntityBlocked(zone, x, y)) return false;
  return true;
}

function orderedDirs(facing) {
  if (!facing || !DIR_DELTA[facing]) return DIRS;
  return [facing, ...DIRS.filter((d) => d !== facing)];
}

function enqueue(queue, visited, x, y, zone) {
  if (x < 0 || y < 0 || x >= zone.cols || y >= zone.rows) return;
  const k = key(x, y);
  if (visited.has(k)) return;
  visited.add(k);
  queue.push({ x, y });
}

function key(x, y) { return `${x},${y}`; }
