// Tower Defense ally AI: drives every un-possessed hero in the squad. For
// each non-active, living hero it synthesises a movement input in the same
// `{ events, held }` shape pollInput returns, so updatePlayer consumes it
// unchanged, and it triggers the hero's attack directly (shoot / melee) by
// player object. Two parametric behaviours keyed off the hero's loadout:
//
//   * Ninja (rooted shooter) — holds position; throws kunai at the nearest
//     enemy in range; only steps if it must to bring a target into range.
//   * Barbarian (charger) — a strict priority ladder each frame:
//       1. low HP        → take cover: back off to the safest nearby tile so
//                          the post-hit regen delay can lapse and HP recovers.
//       2. enemy ≤1 tile → melee it (already in reach).
//       3. enemy ≤2 tiles→ step toward it (short lunge into reach).
//       4. acquire       → among enemies within 10 tiles, march on the one
//                          nearest the exit (the next to leak), path-finding
//                          around the barrel maze.
//       5. commit        → keep marching on that target until it's eliminated,
//                          unless a strictly closer enemy turns up (then chase
//                          the more immediate threat instead).
//
// The possessed (active) hero overrides all of this — main's TD loop simply
// feeds it real input and never calls driveAlly for it.

import { tryShootForPlayer } from "./shooting.js";
import { performMeleeSwing } from "./melee.js";
import { resolveLoadout } from "./sessionLoadouts.js";
import { isWalkable } from "./zone.js";
import { tdObstacleAt } from "./tdObstacles.js";
import { getField } from "./tdBoard.js";
import { computeFlowField, fieldDirection, fieldDistance } from "./flowField.js";
import { getPlayerHp, getPlayerMaxHp } from "./playerHealth.js";

const FIRE_RANGE = 8;            // tiles a rooted shooter will fire across
const MELEE_REACH = 1;           // Manhattan tiles counted as "adjacent"
const LUNGE_RANGE = 2;           // a charger steps in on a target this close
const LOW_HP_FRAC = 0.3;         // ≤30% max HP → the charger takes cover
const ACQUIRE_RANGE = 10;        // tiles a charger will reach out to pick a target

const STEP_DIRS = [["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0]];

const IDLE = () => ({ events: [], held: new Set() });
const walk = (dir) => ({ events: [dir], held: new Set([dir]) });
const face = (dir) => ({ events: [dir], held: new Set() }); // rotate-only tap

// Each charger's committed march target, by hero index → enemy id. Sticky
// across frames so the Barbarian doesn't dither between equidistant foes (see
// marchTarget). Cleared per run via resetAllyAI.
const committedTargetId = new Map();

export function resetAllyAI() { committedTargetId.clear(); }

// Drive one ally hero for this frame. Returns the movement input to hand to
// updatePlayer; attacks are fired as a side effect. `ctx` = { enemies, goal }.
export function driveAlly(state, hero, ctx) {
  const enemies = ctx?.enemies || [];
  const { melee, ranged } = resolveLoadout(hero);
  const isCharger = !!melee && !ranged;
  if (isCharger) return driveCharger(state, hero, ctx);

  const target = nearestEnemy(hero, enemies);
  if (!target) return IDLE();
  return driveShooter(hero, target);
}

function driveShooter(hero, target) {
  const dist = tileDistance(hero, target);
  const dir = dirToward(hero.tileX, hero.tileY, target.x, target.y);
  if (dist <= FIRE_RANGE) {
    // In range: face the target and throw. Set facing directly so the kunai
    // flies the right way without taking a step (shoot reads hero.direction).
    hero.direction = dir;
    tryShootForPlayer(hero);
    return face(dir);
  }
  // Out of range: close in just enough to acquire a target.
  return walk(dir);
}

// The charger's priority ladder (see file header). The first rule that applies
// wins — higher-priority survival/engagement always pre-empts the long march.
function driveCharger(state, hero, ctx) {
  const enemies = ctx?.enemies || [];

  // 1. Survival first: low HP → disengage and take cover.
  if (heroIsLowHp(hero)) return takeCover(state, hero, enemies);

  // 2 & 3. Engage whatever is already on top of us.
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

  // 4 & 5. Otherwise march on a committed target, routing around the maze.
  const target = marchTarget(hero, enemies, getField(), ctx?.goal);
  if (!target) return IDLE();
  const step = pathStepToward(state.zone, hero.tileX, hero.tileY, enemyTile(target));
  return step ? walk(step) : IDLE();
}

function heroIsLowHp(hero) {
  const i = hero.index | 0;
  const max = getPlayerMaxHp() || 1;
  return getPlayerHp(i) <= max * LOW_HP_FRAC;
}

// Back off to the walkable neighbour that puts the most distance between the
// hero and the nearest enemy. Standing put is the baseline, so the hero only
// moves when a step genuinely improves its safety; cornered, it just faces the
// threat. With no enemy nearby it's already safe and holds.
function takeCover(state, hero, enemies) {
  const threat = nearestEnemy(hero, enemies);
  if (!threat) return IDLE();
  const hx = hero.tileX | 0;
  const hy = hero.tileY | 0;
  let bestDir = null;
  let bestDist = nearestEnemyDist(hx, hy, enemies); // safety if we stay put
  for (const [dir, dx, dy] of STEP_DIRS) {
    const nx = hx + dx;
    const ny = hy + dy;
    if (!isWalkable(state.zone, nx, ny)) continue;
    if (tdObstacleAt(state.zone, nx, ny)) continue;
    if (tileHasEnemy(enemies, nx, ny)) continue;
    const d = nearestEnemyDist(nx, ny, enemies);
    if (d > bestDist) { bestDist = d; bestDir = dir; }
  }
  if (bestDir) return walk(bestDir);
  return face(dirToward(hx, hy, threat.x, threat.y));
}

// Priorities 4 & 5 — pick (and keep) the charger's march target.
//   4. Acquire: the closest live enemy within ACQUIRE_RANGE tiles of the hero;
//      ties broken by exit-nearness (the one further along toward the leak).
//   5. Commit: stay on that target until it's eliminated, unless a strictly
//      closer enemy turns up — then switch to the more immediate threat.
// Returns the target enemy entity, or null if nothing is in range.
export function marchTarget(hero, enemies, field, goal) {
  const idx = hero.index | 0;
  const committed = liveEnemyById(enemies, committedTargetId.get(idx));
  if (committed) {
    const closest = nearestEnemyEntity(hero, enemies);
    if (closest && closest !== committed && heroDist(hero, closest) < heroDist(hero, committed)) {
      committedTargetId.set(idx, closest.id);
      return closest;
    }
    return committed;
  }
  const pick = acquireTarget(hero, enemies, field, goal, ACQUIRE_RANGE);
  if (pick) committedTargetId.set(idx, pick.id);
  else committedTargetId.delete(idx);
  return pick || null;
}

// Priority 4's selection: the closest live enemy within `range` tiles of the
// hero, ties broken by exit-nearness — ranked by goal-ward flow-field distance
// when a field is supplied (true path length around the maze), else
// straight-line to the goal. Returns the entity, or null if none are in range.
export function acquireTarget(hero, enemies, field, goal, range) {
  let best = null;
  let bestHero = Infinity;
  let bestExit = Infinity;
  for (const e of enemies) {
    if (e._dying) continue;
    const hd = heroDist(hero, e);
    if (hd > range) continue;
    const t = enemyTile(e);
    const xd = field
      ? fieldDistance(field, t.x, t.y)
      : (goal ? manhattan(t.x, t.y, goal.x, goal.y) : 0);
    if (hd < bestHero || (hd === bestHero && xd < bestExit)) {
      best = e; bestHero = hd; bestExit = xd;
    }
  }
  return best;
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

function heroDist(hero, e) {
  const t = enemyTile(e);
  return manhattan(hero.tileX, hero.tileY, t.x, t.y);
}

// One step from (fromX, fromY) toward `target`, routing around walls AND placed
// barrels — a BFS field rooted at the target over the same blocked grid the
// horde's flow field uses. Returns a cardinal name, or null if the target is
// unreachable from here.
export function pathStepToward(zone, fromX, fromY, target) {
  if (!zone || !target) return null;
  const field = computeFlowField(navGrid(zone), { x: target.x | 0, y: target.y | 0 });
  return fieldDirection(field, fromX | 0, fromY | 0);
}

// The flow-field's grid view of a TD zone: a tile is blocked if it isn't
// walkable (wall / forest / void) or a placed barrel sits on it. Matches
// tdBoard's gridFor so allies route exactly as the horde does.
function navGrid(zone) {
  return {
    cols: zone.cols,
    rows: zone.rows,
    isBlocked: (x, y) => !isWalkable(zone, x, y) || tdObstacleAt(zone, x, y),
  };
}

function nearestEnemy(hero, enemies) {
  let best = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    if (e._dying) continue;
    const t = enemyTile(e);
    const d = manhattan(hero.tileX, hero.tileY, t.x, t.y);
    if (d < bestDist) { best = t; bestDist = d; }
  }
  return best;
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
