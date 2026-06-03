// Tower Defense enemies: the horde that marches the flow-field to the goal,
// and the bookkeeping for the two things the run cares about — an enemy KILLED
// (gold + score) and an enemy that REACHED the goal (a leak → lose condition).
//
// TD enemies are ordinary CloseCombatMonster entities (the same species the
// base game escalates by fusion), so combat.js kills them, monsters.js fuses
// them, and resolveMeleeMonsters lets them chip the heroes they pass. What's
// different is movement: they do NOT chase players (mobs.js is never run on the
// TD path). Instead each one reads the arrow on its tile from tdBoard's flow
// field and steps that way, so the squad and barricades shape the route. The
// stepping mirrors mobs.js's tile-locked slide so the sprites animate the same.

import { getSpecies } from "./species.js";
import { isWalkable } from "./zone.js";
import { getField, getGoal } from "./tdBoard.js";
import { tdObstacleAt } from "./tdObstacles.js";
import { fieldDirection, dirDelta } from "./flowField.js";

const TILE_RATE_PER_BASE_SPEED = 1.6; // mirrors mobs.js straight-movement math
const FALLBACK_BASE_SPEED = 1.4;
const WANDER_PAUSE = 0.4;             // idle between blocked decide attempts

const DIR_DELTA = {
  up:    [0, -1],
  down:  [0,  1],
  left:  [-1, 0],
  right: [1,  0],
};

let nextEnemyId = -2_000_000;         // negative, clear of zone-loaded ids
const countedDead = new Set();        // enemy ids already scored as kills
let leakCount = 0;
let hooks = { onKill: () => {}, onLeak: () => {} };

export function setTdEnemyHooks(h) {
  hooks = { onKill: h?.onKill || (() => {}), onLeak: h?.onLeak || (() => {}) };
}

export function resetTdEnemies() {
  nextEnemyId = -2_000_000;
  countedDead.clear();
  leakCount = 0;
}

// Spawn one enemy of `speciesId` at tile (x, y). Mirrors minions.js's entity
// shape so it renders + animates through the normal pipeline; `_td` marks it
// for this module's tick.
export function spawnEnemy(zone, x, y, speciesId) {
  const sp = getSpecies(speciesId);
  const w = Math.max(1, sp?.width || (sp?.sprite_frame?.w) || 1);
  const h = Math.max(1, sp?.height || (sp?.sprite_frame?.h) || 1);
  const e = {
    id: nextEnemyId--,
    species_id: speciesId,
    direction: "Right",
    is_consumable: false,
    _td: true,
    frame: { x, y, w, h },
    dialogues: [],
  };
  zone.entities.push(e);
  ensureAi(e);
  return e;
}

// Every live TD enemy (not dying, not leaked) — allyAI targets these and the
// wave director checks this to know when a wave is cleared.
export function getEnemies(zone) {
  if (!zone?.entities) return [];
  return zone.entities.filter((e) => e._td && !e._dying && !e._leaked);
}

export function aliveEnemyCount(zone) {
  return getEnemies(zone).length;
}

export function getLeakCount() {
  return leakCount;
}

export function tickTdEnemies(zone, dt) {
  if (!zone?.entities) return;
  const goal = getGoal();
  const field = getField();
  // Iterate a snapshot — leaks splice from zone.entities mid-loop.
  const list = zone.entities.slice();
  for (const e of list) {
    if (!e._td) continue;
    if (e._leaked) continue;
    if (e._dying) { scoreKill(e); continue; }
    ensureAi(e);
    if (e._ai.step) advanceStep(e, dt, zone, goal);
    else decideStep(e, zone, field, goal, dt);
  }
}

function scoreKill(e) {
  if (countedDead.has(e.id)) return;
  countedDead.add(e.id);
  hooks.onKill(e.species_id);
}

function ensureAi(e) {
  if (e._ai) return;
  const f = e.frame;
  e._ai = {
    step: null,
    decideTimer: 0,
    tileX: Math.round(f.x),
    tileY: Math.round(f.y),
    h: Math.max(1, f.h || 1),
  };
  e.frame.x = e._ai.tileX;
  e.frame.y = e._ai.tileY;
}

function feetTile(e) {
  return { x: e._ai.tileX, y: e._ai.tileY + e._ai.h - 1 };
}

function decideStep(e, zone, field, goal, dt) {
  if (e._ai.decideTimer > 0) { e._ai.decideTimer -= dt; return; }
  const feet = feetTile(e);

  // Already on the goal → leak immediately (no field arrow there).
  if (goal && feet.x === goal.x && feet.y === goal.y) { leak(e, zone); return; }

  const duration = stepDurationFor(e);
  // Primary: follow the flow-field arrow on this tile.
  let dir = fieldDirection(field, feet.x, feet.y);
  if (dir && tryStartStep(e, dir, zone, duration)) return;
  // Fallback: field stale/unreachable (e.g. a barricade just changed the
  // grid) — greedily step toward the goal tile so the horde keeps advancing.
  for (const d of greedyToward(feet, goal)) {
    if (tryStartStep(e, d, zone, duration)) return;
  }
  e._ai.decideTimer = WANDER_PAUSE;
}

function greedyToward(from, goal) {
  if (!goal) return [];
  const dx = goal.x - from.x;
  const dy = goal.y - from.y;
  const horiz = dx > 0 ? "right" : dx < 0 ? "left" : null;
  const vert = dy > 0 ? "down" : dy < 0 ? "up" : null;
  const out = [];
  if (Math.abs(dx) >= Math.abs(dy)) { if (horiz) out.push(horiz); if (vert) out.push(vert); }
  else { if (vert) out.push(vert); if (horiz) out.push(horiz); }
  return out;
}

function tryStartStep(e, dir, zone, duration) {
  const [dx, dy] = DIR_DELTA[dir];
  const toX = e._ai.tileX + dx;
  const toY = e._ai.tileY + dy;
  const feetY = toY + e._ai.h - 1;
  // Enemies don't block each other (they pack into corridors and fuse) — only
  // the static walkable grid (stone-wall barricades) and placed barrel props
  // stop them.
  if (!isWalkable(zone, toX, feetY)) return false;
  if (tdObstacleAt(zone, toX, feetY)) return false;
  e.direction = capitalize(dir);
  e._ai.step = { fromX: e._ai.tileX, fromY: e._ai.tileY, toX, toY, progress: 0, duration };
  return true;
}

function advanceStep(e, dt, zone, goal) {
  const s = e._ai.step;
  s.progress += dt / s.duration;
  if (s.progress < 1) {
    e.frame.x = s.fromX + (s.toX - s.fromX) * s.progress;
    e.frame.y = s.fromY + (s.toY - s.fromY) * s.progress;
    return;
  }
  e._ai.tileX = s.toX;
  e._ai.tileY = s.toY;
  e.frame.x = s.toX;
  e.frame.y = s.toY;
  e._ai.step = null;
  const feet = feetTile(e);
  if (goal && feet.x === goal.x && feet.y === goal.y) leak(e, zone);
}

function leak(e, zone) {
  if (e._leaked) return;
  e._leaked = true;
  const i = zone.entities.indexOf(e);
  if (i >= 0) zone.entities.splice(i, 1);
  leakCount++;
  hooks.onLeak(e.species_id);
}

function stepDurationFor(e) {
  const sp = getSpecies(e.species_id);
  const base = sp && sp.base_speed > 0 ? sp.base_speed : FALLBACK_BASE_SPEED;
  const tilesPerSec = base * TILE_RATE_PER_BASE_SPEED;
  return Math.max(0.12, Math.min(1.5, 1 / tilesPerSec));
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
