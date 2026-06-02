// Tower Defense ally AI: drives every un-possessed hero in the squad. For
// each non-active, living hero it synthesises a movement input in the same
// `{ events, held }` shape pollInput returns, so updatePlayer consumes it
// unchanged, and it triggers the hero's attack directly (shoot / melee) by
// player object. No home posts, no AT_POST/RETURNING state machine — just two
// parametric, leashless behaviours keyed off the hero's archetype loadout:
//
//   * Ninja (rooted shooter) — holds position; throws kunai at the nearest
//     enemy in range; only steps if it must to bring a target into range.
//   * Barbarian (charger) — walks toward the nearest enemy and melee-swings
//     when adjacent; re-targets the next nearest on a kill. A soft leash keeps
//     it from chasing so far from the goal that it leaves the village exposed.
//
// The possessed (active) hero overrides all of this — main's TD loop simply
// feeds it real input and never calls driveAlly for it.

import { tryShootForPlayer } from "./shooting.js";
import { performMeleeSwing } from "./melee.js";
import { resolveLoadout } from "./sessionLoadouts.js";

const FIRE_RANGE = 8;            // tiles a rooted shooter will fire across
const MELEE_REACH = 1;           // Manhattan tiles counted as "adjacent"
const LEASH_FROM_GOAL = 12;      // a charger won't push further than this from goal

const IDLE = () => ({ events: [], held: new Set() });
const walk = (dir) => ({ events: [dir], held: new Set([dir]) });
const face = (dir) => ({ events: [dir], held: new Set() }); // rotate-only tap

// Drive one ally hero for this frame. Returns the movement input to hand to
// updatePlayer; attacks are fired as a side effect. `ctx` = { enemies, goal }.
export function driveAlly(state, hero, ctx) {
  const enemies = ctx?.enemies || [];
  const target = nearestEnemy(hero, enemies);
  if (!target) return IDLE();

  const { melee, ranged } = resolveLoadout(hero);
  const isCharger = !!melee && !ranged;
  return isCharger
    ? driveCharger(state, hero, target, ctx?.goal)
    : driveShooter(hero, target);
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

function driveCharger(state, hero, target, goal) {
  const dist = tileDistance(hero, target);
  const dir = dirToward(hero.tileX, hero.tileY, target.x, target.y);
  if (dist <= MELEE_REACH) {
    hero.direction = dir;
    performMeleeSwing(state, { swinger: hero });
    return face(dir);
  }
  // Soft leash: if charging would drag the hero past LEASH_FROM_GOAL tiles
  // from the goal (and the target is further out still), hold the line rather
  // than over-extend toward the spawn and leave the village open.
  if (goal && wouldOverextend(hero, dir, goal, target)) {
    hero.direction = dir;
    return face(dir);
  }
  return walk(dir);
}

function wouldOverextend(hero, dir, goal, target) {
  const heroGoalDist = manhattan(hero.tileX, hero.tileY, goal.x, goal.y);
  if (heroGoalDist < LEASH_FROM_GOAL) return false;
  const targetGoalDist = manhattan(target.x, target.y, goal.x, goal.y);
  return targetGoalDist > heroGoalDist; // target is even further from the goal
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
