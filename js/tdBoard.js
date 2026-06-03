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
import { computeFlowField, allReachable } from "./flowField.js";
import { tdObstacleAt } from "./tdObstacles.js";
import { TD_ZONE_ID } from "./constants.js";

let goal = null;          // { x, y }
let spawns = [];          // [{ x, y }] — enemy entry tiles
let heroSpawns = [];      // [{ x, y }] — where the squad starts
let field = null;         // cached flow field; rebuilt on barricade changes

// Adapt a runtime zone into the flow-field's tiny grid abstraction. Stone-wall
// barricades land on the construction layer (zone.collision via isWalkable);
// placed barrels are rigid entities, so we also fold in tdObstacleAt. Either
// way the field automatically routes the horde around what the player built.
function gridFor(zone) {
  return {
    cols: zone.cols,
    rows: zone.rows,
    isBlocked: (x, y) => !isWalkable(zone, x, y) || tdObstacleAt(zone, x, y),
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

export function recomputeField(zone) {
  if (!goal) return null;
  field = computeFlowField(gridFor(zone), goal);
  return field;
}

export function getGoal() { return goal; }
export function getSpawns() { return spawns; }
export function getHeroSpawns() { return heroSpawns; }
export function getField() { return field; }

// True if every spawn tile can still reach the goal in the current field —
// the anti-wall-off invariant. tdBuild calls recomputeField then this
// against a trial placement and rejects any that seals a spawn off.
export function spawnsReachGoal() {
  return allReachable(field, spawns);
}

export function isTdBoardZone(zoneId) {
  return zoneId === TD_ZONE_ID;
}

export function resetBoard() {
  goal = null;
  spawns = [];
  heroSpawns = [];
  field = null;
}
