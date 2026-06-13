// Tower Defense ally AI: drives every un-possessed hero in the squad. For each
// non-active, living hero it synthesises a movement input in the same
// `{ events, held }` shape pollInput returns, so updatePlayer consumes it
// unchanged, and it triggers the hero's attack directly (shoot / melee) by
// player object. The possessed (active) hero overrides all of this — main's TD
// loop feeds it real input and never calls driveAlly for it.
//
// Shared rules (every hero, present and future):
//   • Target the closest enemy within the hero's reach; when several are
//     equally close, the one nearest the EXIT (the next to leak) wins the tie.
//   • With nothing in reach, regroup toward the visible area (the camera) so an
//     ally never strands itself off-screen.
//
// Per archetype, keyed off the loadout:
//   * Ninja (rooted shooter) — kunai fly in straight cardinal lanes, so it only
//     moves to line up on the target's row/column, and backs off to keep ≥2
//     tiles from the nearest enemy. It fires while it repositions.
//   * Barbarian (charger) — a strict priority ladder:
//       1. low HP        → take cover (back off so HP regen can resume).
//       2. enemy ≤1 tile → melee it.
//       3. enemy ≤2 tiles→ lunge into reach.
//       4. acquire       → march on the closest enemy within reach (exit-
//                          nearest breaks ties), path-finding around the maze.
//       5. commit        → keep that target until it's eliminated, switching
//                          only if a strictly closer enemy appears.

import { tryShootForPlayer } from "./shooting.js";
import { performMeleeSwing } from "./melee.js";
import { resolveLoadout } from "./sessionLoadouts.js";
import { isWalkable } from "./zone.js";
import { stoneBlocksTile } from "./tdStones.js";
import { getField } from "./tdBoard.js";
import { computeFlowField, fieldDirection, fieldDistance } from "./flowField.js";
import { getPlayerHp, getPlayerMaxHp } from "./playerHealth.js";

const CHARGER_RANGE = 10;        // tiles a charger reaches out to pick a target
const SHOOTER_RANGE = 12;        // tiles a shooter reaches out to pick a target
const MELEE_REACH = 1;           // Manhattan tiles counted as "adjacent"
const LUNGE_RANGE = 2;           // a charger steps in on a target this close
const SAFE_GAP = 2;              // a shooter keeps the nearest enemy this far off
const LOW_HP_FRAC = 0.35;        // ≤35% max HP → the charger takes cover

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const STEP_DIRS = [["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0]];

const IDLE = () => ({ events: [], held: new Set() });
const walk = (dir) => ({ events: [dir], held: new Set([dir]) });
const face = (dir) => ({ events: [dir], held: new Set() }); // rotate-only tap

// Each charger's committed march target, by hero index → enemy id. Sticky
// across frames so the Barbarian doesn't dither between equidistant foes.
// Cleared per run via resetAllyAI.
const committedTargetId = new Map();

export function resetAllyAI() { committedTargetId.clear(); }

// Drive one ally hero for this frame. Returns the movement input to hand to
// updatePlayer; attacks are fired as a side effect. `ctx` = { enemies, goal }.
export function driveAlly(state, hero, ctx) {
  const { melee, ranged } = resolveLoadout(hero);
  const isCharger = !!melee && !ranged;
  return isCharger ? driveCharger(state, hero, ctx) : driveShooter(state, hero, ctx);
}

// — Ninja: line up on a lane, keep your distance, fire while moving ———————————
function driveShooter(state, hero, ctx) {
  const enemies = ctx?.enemies || [];
  const target = selectTarget(hero, enemies, getField(), ctx?.goal, SHOOTER_RANGE);
  if (!target) return seekVisibleArea(state, hero);

  const tt = enemyTile(target);
  const closest = nearestEnemyEntity(hero, enemies);

  // Movement: spacing first (kite the crowd back to SAFE_GAP), then lane-up on
  // the target. Never a chase — once in a lane with room, hold and shoot.
  let moveDir = null;
  if (closest && heroDist(hero, closest) < SAFE_GAP) {
    moveDir = safestStep(state.zone, hero, enemies);
  } else if ((hero.tileX | 0) !== tt.x && (hero.tileY | 0) !== tt.y) {
    moveDir = alignStep(state.zone, hero, tt);
  }

  if (moveDir) {
    // Shoot while moving: the shot leaves in the step direction (fired now,
    // before updatePlayer runs), then the hero takes the step.
    hero.direction = moveDir;
    tryShootForPlayer(hero);
    return walk(moveDir);
  }
  // Planted in a lane (or boxed in) — face the target down it and fire.
  const laneDir = laneDirToward(hero, tt);
  hero.direction = laneDir;
  tryShootForPlayer(hero);
  return face(laneDir);
}

// — Barbarian: the priority ladder ———————————————————————————————————————————
function driveCharger(state, hero, ctx) {
  const enemies = ctx?.enemies || [];

  // 1. Survival first: low HP → disengage and take cover.
  if (heroIsLowHp(hero)) return takeCover(state, hero, enemies);

  // 2 & 3. Engage whatever's on top of us.
  const near = nearestEnemy(hero, enemies);
  if (near) {
    const d = tileDistance(hero, near);
    if (d <= MELEE_REACH) {
      const dir = dirToward(hero.tileX, hero.tileY, near.x, near.y);
      hero.direction = dir;
      performMeleeSwing(state, { swinger: hero });
      return face(dir);
    }
    if (d <= LUNGE_RANGE) {
      return walk(dirToward(hero.tileX, hero.tileY, near.x, near.y));
    }
  }

  // 4 & 5. March on a committed target, routing around the maze.
  const target = marchTarget(hero, enemies, getField(), ctx?.goal);
  if (!target) return seekVisibleArea(state, hero);
  const step = pathStepToward(state.zone, hero.tileX, hero.tileY, enemyTile(target));
  return step ? walk(step) : seekVisibleArea(state, hero);
}

// — Shared target selection ——————————————————————————————————————————————————

// The closest enemy to the hero among those within `range` tiles — and when
// several are equally close, the one nearest the EXIT (the next to leak) wins
// the tie. Exit-nearness is ranked by goal-ward flow-field distance (true path
// length around the maze) when a field is supplied, else straight-line to the
// goal. Returns the entity, or null if none are in range.
export function selectTarget(hero, enemies, field, goal, range) {
  let best = null;
  let bestHero = Infinity;
  let bestExit = Infinity;
  for (const e of enemies) {
    if (e._dying) continue;
    const hd = heroDist(hero, e);
    if (hd > range) continue;
    const xd = exitDistOf(e, field, goal);
    if (hd < bestHero || (hd === bestHero && xd < bestExit)) {
      best = e; bestHero = hd; bestExit = xd;
    }
  }
  return best;
}

// Priority 5 — keep the charger committed to a march target. Stay on it until
// it's eliminated (killed, leaked, gone), switching only when a strictly closer
// enemy turns up (a more immediate threat). Returns the target entity, or null
// if nothing's in range.
export function marchTarget(hero, enemies, field, goal) {
  const idx = hero.index | 0;
  const committed = liveEnemyById(enemies, committedTargetId.get(idx));
  if (committed) {
    const best = selectTarget(hero, enemies, field, goal, CHARGER_RANGE);
    if (best && best !== committed && heroDist(hero, best) < heroDist(hero, committed)) {
      committedTargetId.set(idx, best.id);
      return best;
    }
    return committed;
  }
  const pick = selectTarget(hero, enemies, field, goal, CHARGER_RANGE);
  if (pick) committedTargetId.set(idx, pick.id);
  else committedTargetId.delete(idx);
  return pick || null;
}

function exitDistOf(e, field, goal) {
  const t = enemyTile(e);
  if (field) return fieldDistance(field, t.x, t.y);
  return goal ? manhattan(t.x, t.y, goal.x, goal.y) : 0;
}

// — Movement helpers ——————————————————————————————————————————————————————————

// One step from (fromX, fromY) toward `target`, routing around walls AND placed
// barrels — a BFS field rooted at the target over the same blocked grid the
// horde's flow field uses. Returns a cardinal name, or null if the target is
// unreachable from here. `blocked` optionally marks extra impassable tiles
// (e.g. the squad's other heroes) so the route doesn't dead-end against a tile
// updatePlayer will refuse to step onto.
export function pathStepToward(zone, fromX, fromY, target, blocked) {
  if (!zone || !target) return null;
  const grid = navGrid(zone);
  const isBlocked = blocked
    ? (x, y) => grid.isBlocked(x, y) || blocked(x, y)
    : grid.isBlocked;
  const field = computeFlowField({ cols: grid.cols, rows: grid.rows, isBlocked },
    { x: target.x | 0, y: target.y | 0 });
  return fieldDirection(field, fromX | 0, fromY | 0);
}

// One step that lines the shooter up on the target's row or column — zero the
// smaller offset first (the nearer lane), falling back to the other axis if the
// preferred step is blocked. Returns a cardinal, or null if both are blocked.
export function alignStep(zone, hero, tt) {
  const hx = hero.tileX | 0;
  const hy = hero.tileY | 0;
  const dx = tt.x - hx;
  const dy = tt.y - hy;
  const horiz = dx > 0 ? "right" : "left";
  const vert = dy > 0 ? "down" : "up";
  const primary = Math.abs(dy) <= Math.abs(dx) ? vert : horiz; // zero the nearer lane
  for (const d of [primary, primary === vert ? horiz : vert]) {
    const [ddx, ddy] = DELTA[d];
    if (stepIsClear(zone, hx + ddx, hy + ddy)) return d;
  }
  return null;
}

// The firing direction once on the target's lane: along the shared row/column.
// If somehow not aligned (its align step was blocked), face the dominant axis.
export function laneDirToward(hero, tt) {
  const hx = hero.tileX | 0;
  const hy = hero.tileY | 0;
  if (hx === tt.x) return tt.y > hy ? "down" : "up";
  if (hy === tt.y) return tt.x > hx ? "right" : "left";
  return dirToward(hx, hy, tt.x, tt.y);
}

// Regroup toward the visible area: step toward the camera centre so an ally with
// nothing to do drifts back to where the action (and the player) is, rather than
// stranding itself off-screen. Holds once it's roughly centred.
export function seekVisibleArea(state, hero) {
  const cam = state?.camera;
  if (!cam) return IDLE();
  const cx = cam.x + cam.w / 2;
  const cy = cam.y + cam.h / 2;
  const hx = (hero.tileX | 0) + 0.5;
  const hy = (hero.tileY | 0) + 0.5;
  if (Math.abs(cx - hx) < 1 && Math.abs(cy - hy) < 1) return IDLE();
  // Prefer the axis with more ground to cover; fall back to the other if blocked.
  const horiz = cx > hx ? "right" : "left";
  const vert = cy > hy ? "down" : "up";
  const primary = Math.abs(cx - hx) >= Math.abs(cy - hy) ? horiz : vert;
  for (const d of [primary, primary === horiz ? vert : horiz]) {
    const [ddx, ddy] = DELTA[d];
    if (stepIsClear(state?.zone, (hero.tileX | 0) + ddx, (hero.tileY | 0) + ddy)) return walk(d);
  }
  return IDLE();
}

function takeCover(state, hero, enemies) {
  const threat = nearestEnemy(hero, enemies);
  if (!threat) return IDLE();
  const dir = safestStep(state.zone, hero, enemies);
  if (dir) return walk(dir);
  return face(dirToward(hero.tileX | 0, hero.tileY | 0, threat.x, threat.y)); // cornered
}

// The walkable neighbour that puts the most distance between the hero and the
// nearest enemy — used for both the charger's cover and the shooter's kite.
// Returns a cardinal, or null if standing put is already safest.
function safestStep(zone, hero, enemies) {
  const hx = hero.tileX | 0;
  const hy = hero.tileY | 0;
  let bestDir = null;
  let bestDist = nearestEnemyDist(hx, hy, enemies);
  for (const [dir, dx, dy] of STEP_DIRS) {
    const nx = hx + dx;
    const ny = hy + dy;
    if (!stepIsClear(zone, nx, ny) || tileHasEnemy(enemies, nx, ny)) continue;
    const d = nearestEnemyDist(nx, ny, enemies);
    if (d > bestDist) { bestDist = d; bestDir = dir; }
  }
  return bestDir;
}

function stepIsClear(zone, x, y) {
  if (!zone) return true;
  return isWalkable(zone, x, y) && !stoneBlocksTile(zone, x, y);
}

// The flow-field's grid view of a TD zone: a tile is blocked if it isn't
// walkable (wall / forest / void) or a stone sits on it. Matches tdBoard's
// gridFor so allies route exactly as the horde does.
function navGrid(zone) {
  return {
    cols: zone.cols,
    rows: zone.rows,
    isBlocked: (x, y) => !isWalkable(zone, x, y) || stoneBlocksTile(zone, x, y),
  };
}

function heroIsLowHp(hero) {
  const max = getPlayerMaxHp(hero.index | 0) || 1;
  return getPlayerHp(hero.index | 0) <= max * LOW_HP_FRAC;
}

// — Enemy queries ——————————————————————————————————————————————————————————

// Nearest enemy to the hero as a feet tile { x, y } (for the charger's melee /
// lunge maths), or null.
function nearestEnemy(hero, enemies) {
  const e = nearestEnemyEntity(hero, enemies);
  return e ? enemyTile(e) : null;
}

function nearestEnemyEntity(hero, enemies) {
  let best = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    if (e._dying) continue;
    const d = heroDist(hero, e);
    if (d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}

// The committed enemy if it's still live and present this frame, else null
// (eliminated — killed, leaked, or a stale id from a prior run).
function liveEnemyById(enemies, id) {
  if (id == null) return null;
  for (const e of enemies) {
    if (e.id === id) return e._dying ? null : e;
  }
  return null;
}

function nearestEnemyDist(x, y, enemies) {
  let min = Infinity;
  for (const e of enemies) {
    if (e._dying) continue;
    const t = enemyTile(e);
    const d = manhattan(x, y, t.x, t.y);
    if (d < min) min = d;
  }
  return min;
}

function tileHasEnemy(enemies, x, y) {
  for (const e of enemies) {
    if (e._dying) continue;
    const t = enemyTile(e);
    if (t.x === x && t.y === y) return true;
  }
  return false;
}

function heroDist(hero, e) {
  const t = enemyTile(e);
  return manhattan(hero.tileX, hero.tileY, t.x, t.y);
}

// The enemy's current feet tile. tdEnemies keeps frame.x/y interpolated while
// stepping, so rounding gives the tile it's closest to right now.
function enemyTile(e) {
  const f = e.frame || { x: 0, y: 0, w: 1, h: 1 };
  const h = Math.max(1, f.h || 1);
  return { x: Math.round(f.x), y: Math.round(f.y) + h - 1 };
}

function tileDistance(hero, t) {
  return manhattan(hero.tileX, hero.tileY, t.x, t.y);
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function dirToward(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}
