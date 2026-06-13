// Tower Defense board: the goal tile, the enemy spawn tiles, the hero spawn
// tiles, and the cached flow-field the horde follows toward the goal.
//
// Goal / spawns / hero spawns are authored as a `td` metadata block on the
// board zone JSON (data/1401.json) and read off the raw zone at boot — no
// special loader, the board loads through the normal loadZone → buildZone
// path like any other zone. The flow-field is rebuilt from the live zone's
// walkable grid whenever a barricade changes it; at runtime enemies just read
// the arrow on their tile.

import { isWalkable } from "./zone.js";
import { computeFlowField } from "./flowField.js";
import { TD_ZONE_ID } from "./constants.js";

let goal = null;          // { x, y }
let spawns = [];          // [{ x, y }] — enemy entry tiles
let heroSpawns = [];      // [{ x, y }] — where the squad starts
let field = null;         // cached flow field; rebuilt on barricade changes

// Adapt a runtime zone into the flow-field's tiny grid abstraction. The maze
// walls live on the construction layer (zone.collision via isWalkable), so the
// field automatically routes the horde around whatever forest has grown in.
function gridFor(zone) {
  return {
    cols: zone.cols,
    rows: zone.rows,
    isBlocked: (x, y) => !isWalkable(zone, x, y),
  };
}

// Read the board's TD metadata off the raw zone JSON and compute the initial
// field. Falls back to sensible defaults (centre goal, left-edge spawn band)
// if the metadata is missing, so a hand-edited board still boots.
export function initBoard(rawZone, zone) {
  const td = rawZone?.td || {};
  goal = td.goal ? { x: td.goal.x | 0, y: td.goal.y | 0 }
    : { x: zone.cols - 4, y: Math.floor(zone.rows / 2) };
  spawns = Array.isArray(td.spawns) && td.spawns.length
    ? td.spawns.map((s) => ({ x: s.x | 0, y: s.y | 0 }))
    : defaultSpawns(zone);
  heroSpawns = Array.isArray(td.heroSpawns) && td.heroSpawns.length
    ? td.heroSpawns.map((s) => ({ x: s.x | 0, y: s.y | 0 }))
    : [{ x: goal.x - 6, y: goal.y - 2 }, { x: goal.x - 6, y: goal.y + 2 }];
  recomputeField(zone);
}

function defaultSpawns(zone) {
  const out = [];
  const mid = Math.floor(zone.rows / 2);
  for (let dy = -6; dy <= 6; dy++) out.push({ x: 2, y: mid + dy });
  return out;
}

// Recompute the horde's flow field toward the goal. Callers may pass a custom
// grid — Tower Defense passes a path-only grid (tdMaze.pathGrid) so the field
// keeps the horde locked to the sand track; with no grid we fall back to the
// plain walkable grid.
export function recomputeField(zone, grid) {
  if (!goal) return null;
  field = computeFlowField(grid || gridFor(zone), goal);
  return field;
}

export function getGoal() { return goal; }
export function getSpawns() { return spawns; }
export function getHeroSpawns() { return heroSpawns; }
export function getField() { return field; }

export function isTdBoardZone(zoneId) {
  return zoneId === TD_ZONE_ID;
}

export function resetBoard() {
  goal = null;
  spawns = [];
  heroSpawns = [];
  field = null;
}
