// Mob AI. FindHero monsters that see a player steer straight at it at their
// species speed, sliding along walls, and fall back to a grid path
// (pathfinding.js) when something solid is in the way. On reaching the
// player they bump: a short recoil and a breather, so contact damage comes
// in hits rather than a steady drain. Anything else, and a
// FindHero mob that sees nobody, wanders one tile at a time. Positions are
// floats; `_ai.tileX/tileY` is the nearest tile.

import { getSpecies } from "./species.js";
import { isWalkable } from "./zone.js";
import { entityHittableFrame, rectOverlapsTile } from "./entityVisibility.js";
import { isCreativeMode } from "./creativeMode.js";
import { isFrozen } from "./freeze.js";
import { TILE_SIZE } from "./constants.js";
import { findPathToNearest } from "./pathfinding.js";

const VISION_TILES = 6;
const WANDER_PAUSE = 0.9;
// Mirrors Rust config().base_entity_speed = TILE_SIZE * 1.6 (so the
// effective movement rate is `base_speed × 1.6` tiles/sec).
const TILE_RATE_PER_BASE_SPEED = 1.6;
const FALLBACK_BASE_SPEED = 1.4;
const CHASE_STOP = 0.65;
const REST_AFTER_BUMP = 0.6;
const WAYPOINT_REACHED = 0.12;
const STUCK_RATIO = 0.3;
const STUCK_BEFORE_PATH = 0.2;
const REPATH_INTERVAL = 0.5;
const MAX_PATH = 40;
const FEET_INSET_X = 0.2;
const FEET_TOP = 0.8;
const FEET_BOTTOM = 0.2;
const EDGE_EPS = 1e-4;

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};
const ALL_DIRS = ["up", "down", "left", "right"];

// `player` accepts either a single player object (single-player) or an
// array of live players (co-op). For chase decisions the closest live
// player within VISION_TILES wins; if no players are passed (everyone
// dead) chase mobs fall back to wandering like normal.
export function tickMobs(zone, player, dt) {
  if (!zone?.entities) return;
  // Creative mode freezes every AI-driven entity in place so the level
  // designer can lay out monsters / NPCs without them wandering off.
  if (isCreativeMode()) return;
  const players = Array.isArray(player) ? player.filter(Boolean) : (player ? [player] : []);
  // Only tick mobs whose frame overlaps a viewport this frame, mirroring
  // Rust's update_hitmaps gating: a monster off-screen freezes in place.
  const list = zone.visibleEntities ?? zone.entities;
  for (const e of list) {
    if (e._spawned) continue;
    if (e._dying) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (!isMobAi(sp)) continue;
    if (isFrozen(e)) { e.moving = false; continue; }
    ensureAi(e);
    if (e._ai.step) { advanceStep(e, dt); continue; }
    if (sp.movement_directions === "FindHero") {
      const target = pickClosestVisible(e, players);
      if (target) { chase(e, sp, zone, target, dt); continue; }
    }
    e.moving = false;
    e._ai.path = null;
    decideStep(e, sp, zone, dt);
  }
}

export function isMobAi(sp) {
  return !!sp && (sp.movement_directions === "FindHero" || sp.movement_directions === "Free");
}

function ensureAi(e) {
  if (e._ai) return;
  const f = e.frame;
  e._ai = {
    step: null,
    decideTimer: 0,
    tileX: Math.round(f.x),
    tileY: Math.round(f.y),
    w: Math.max(1, f.w || 1),
    h: Math.max(1, f.h || 1),
    path: null,
    repath: 0,
    stuck: 0,
    rest: 0,
  };
}

function syncAiTile(e) {
  e._ai.tileX = Math.round(e.frame.x);
  e._ai.tileY = Math.round(e.frame.y);
}

/** Centre of a mob's feet row, in tile units. */
export function mobFeetCentre(e) {
  const f = e.frame;
  const h = e._ai?.h ?? Math.max(1, f.h || 1);
  const w = e._ai?.w ?? Math.max(1, f.w || 1);
  return { x: f.x + w / 2, y: f.y + h - 0.5 };
}

function chase(e, sp, zone, target, dt) {
  const ai = e._ai;
  const speed = speedFor(sp);
  const feet = mobFeetCentre(e);
  const tx = target.x + 0.5, ty = target.y + 0.5;
  ai.repath -= dt;
  if (ai.rest > 0) {
    ai.rest -= dt;
    e.moving = false;
    e.direction = capitalize(facing(tx - feet.x, ty - feet.y));
    return;
  }
  let gx = tx, gy = ty;
  if (ai.path) {
    while (ai.path.length && Math.hypot(ai.path[0].x + 0.5 - feet.x, ai.path[0].y + 0.5 - feet.y) < WAYPOINT_REACHED) {
      ai.path.shift();
    }
    if (ai.path.length) { gx = ai.path[0].x + 0.5; gy = ai.path[0].y + 0.5; }
    else ai.path = null;
  }
  if (!ai.path && Math.hypot(tx - feet.x, ty - feet.y) <= CHASE_STOP) {
    e.moving = false;
    recoil(zone, e, feet, tx, ty);
    ai.rest = REST_AFTER_BUMP;
    return;
  }
  const dx = gx - feet.x, dy = gy - feet.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) { e.moving = false; return; }
  const want = Math.min(speed * dt, dist);
  const moved = moveMob(zone, e, (dx / dist) * want, (dy / dist) * want);
  e.moving = moved > 1e-6;
  e.direction = capitalize(facing(dx, dy));
  syncAiTile(e);
  ai.stuck = moved < want * STUCK_RATIO ? ai.stuck + dt : 0;
  if (ai.stuck >= STUCK_BEFORE_PATH && ai.repath <= 0) {
    ai.repath = REPATH_INTERVAL;
    ai.stuck = 0;
    const path = findPathToNearest(zone, Math.floor(feet.x - (ai.w - 1) / 2), Math.floor(feet.y), [{ x: target.tileX, y: target.tileY }]);
    ai.path = path && path.length <= MAX_PATH ? path : null;
  }
}

// Hop one tile away from the bumped player, or sideways when cornered.
function recoil(zone, e, feet, tx, ty) {
  const ax = feet.x - tx, ay = feet.y - ty;
  const sources = [[tx, ty], [feet.x + ay, feet.y - ax], [feet.x - ay, feet.y + ax]];
  for (const [sx, sy] of sources) {
    knockbackEntity(zone, e, sx, sy, 1);
    if (e._ai.step) return;
  }
}

function facing(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

/** Moves a mob by (dx, dy) with axis-separated collision; returns distance moved. */
export function moveMob(zone, e, dx, dy) {
  const f = e.frame;
  const x0 = f.x, y0 = f.y;
  if (dx && canMobOccupy(zone, e, f.x + dx, f.y)) f.x += dx;
  if (dy && canMobOccupy(zone, e, f.x, f.y + dy)) f.y += dy;
  return Math.hypot(f.x - x0, f.y - y0);
}

function feetBox(e, x, y) {
  const w = e._ai?.w ?? Math.max(1, e.frame.w || 1);
  const h = e._ai?.h ?? Math.max(1, e.frame.h || 1);
  return { x: x + FEET_INSET_X, y: y + h - FEET_TOP, w: w - FEET_INSET_X * 2, h: FEET_TOP - FEET_BOTTOM };
}

function boxBlockers(zone, e, box) {
  const out = [];
  const l = Math.floor(box.x), r = Math.floor(box.x + box.w - EDGE_EPS);
  const t = Math.floor(box.y), b = Math.floor(box.y + box.h - EDGE_EPS);
  for (let ty = t; ty <= b; ty++) {
    for (let tx = l; tx <= r; tx++) {
      if (!isWalkable(zone, tx, ty)) out.push(`${tx},${ty}`);
    }
  }
  for (const other of zone.entities) {
    if (other === e || other._spawned || other._dying) continue;
    const sp = getSpecies(other.species_id);
    if (!sp || !sp.is_rigid || isMobAi(sp)) continue;
    if ((sp.entity_type === "Gate" || sp.entity_type === "InverseGate") && other._open) continue;
    if (sp.entity_type === "Teleporter") continue;
    const hit = entityHittableFrame(other, sp);
    if (!hit) continue;
    if (box.x < hit.x + hit.w && box.x + box.w > hit.x && box.y < hit.y + hit.h && box.y + box.h > hit.y) out.push(other);
  }
  return out;
}

/** True if a mob at its current frame may move its frame to (x, y). */
export function canMobOccupy(zone, e, x, y) {
  const now = boxBlockers(zone, e, feetBox(e, x, y));
  if (!now.length) return true;
  const was = boxBlockers(zone, e, feetBox(e, e.frame.x, e.frame.y));
  return now.every((k) => was.includes(k));
}

function decideStep(e, sp, zone, dt) {
  e._ai.decideTimer -= dt;
  if (e._ai.decideTimer > 0) return;
  const stepDuration = 1 / speedFor(sp);
  const dirs = ALL_DIRS.slice();
  shuffle(dirs);
  for (const dir of dirs) {
    if (tryStartStep(e, dir, zone, stepDuration)) return;
  }
  e._ai.decideTimer = WANDER_PAUSE;
}

function tryStartStep(e, dir, zone, duration) {
  const [dx, dy] = DIR_DELTA[dir];
  syncAiTile(e);
  const toX = e._ai.tileX + dx;
  const toY = e._ai.tileY + dy;
  if (!canEnter(zone, e, toX, toY)) return false;
  e.direction = capitalize(dir);
  e._ai.step = {
    fromX: e.frame.x,
    fromY: e.frame.y,
    toX, toY,
    progress: 0,
    duration,
  };
  return true;
}

// Tiles per second, clamped so an extreme species value can't produce a
// sub-frame step or freeze a mob.
function speedFor(sp) {
  const base = sp.base_speed > 0 ? sp.base_speed : FALLBACK_BASE_SPEED;
  const tilesPerSec = base * TILE_RATE_PER_BASE_SPEED;
  return Math.max(1 / 1.5, Math.min(1 / 0.12, tilesPerSec));
}

function advanceStep(e, dt) {
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
}

// Knockback: shove a mob away from a point (the player's tile centre),
// sliding it up to `tiles` tiles in the dominant cardinal direction. Reuses
// the AI's tile-locked step so the push reads as a fast slide and the mob
// resumes normal movement afterwards. No-op if the mob can't be stepped (no
// AI species) or every tile behind it is blocked. Owned here so all `_ai`
// manipulation stays in one file; knockbackAura.js calls it.
//
// The slide duration scales with the distance covered so a multi-tile shove
// still reads as a fast push rather than a teleport, and the step is flagged
// `hop` so the renderer lifts the sprite a couple pixels mid-slide — a small
// recoil bounce (knockbackHopOffset, applied by entities.js).
const KNOCKBACK_MIN_DURATION = 0.12;      // sec floor — matches the step floor
const KNOCKBACK_DURATION_PER_TILE = 0.07; // sec added per tile slid
const KNOCKBACK_HOP_TILES = 3 / TILE_SIZE; // peak lift (~3px) at mid-slide

export function knockbackEntity(zone, e, fromX, fromY, tiles = 1) {
  const sp = getSpecies(e.species_id);
  if (!sp || !isMobAi(sp)) return;
  ensureAi(e);
  e._ai.path = null;
  syncAiTile(e);

  const cx = e._ai.tileX + 0.5;
  const cy = e._ai.tileY + e._ai.h - 0.5;
  const ddx = cx - fromX;
  const ddy = cy - fromY;
  let dx = 0, dy = 0;
  if (Math.abs(ddx) >= Math.abs(ddy)) dx = ddx >= 0 ? 1 : -1;
  else dy = ddy >= 0 ? 1 : -1;

  let tx = e._ai.tileX, ty = e._ai.tileY, steps = 0;
  for (let n = 0; n < tiles; n++) {
    const nx = tx + dx, ny = ty + dy;
    if (!canEnter(zone, e, nx, ny)) break;
    tx = nx; ty = ny; steps++;
  }
  if (steps === 0) return;

  e.direction = capitalize(dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up");
  e._ai.step = {
    fromX: e.frame.x,
    fromY: e.frame.y,
    toX: tx, toY: ty,
    progress: 0,
    duration: Math.max(KNOCKBACK_MIN_DURATION, steps * KNOCKBACK_DURATION_PER_TILE),
    hop: true,
  };
  // Don't immediately re-decide a chase step the instant the slide lands.
  e._ai.decideTimer = WANDER_PAUSE;
}

// Vertical render lift (tiles, positive = up) for a mob mid-knockback, so the
// shove reads as a small recoil hop that peaks at the midpoint of the slide.
// Zero for any normal step or idle mob; entities.js subtracts it from draw Y.
export function knockbackHopOffset(e) {
  const s = e?._ai?.step;
  if (!s || !s.hop) return 0;
  const p = s.progress < 0 ? 0 : s.progress > 1 ? 1 : s.progress;
  return Math.sin(p * Math.PI) * KNOCKBACK_HOP_TILES;
}

// Picks the closest live player within VISION_TILES of the mob's feet, so
// co-op mobs switch targets when another player gets closer.
function pickClosestVisible(e, players) {
  const feet = mobFeetCentre(e);
  let best = null;
  let bestDist = Infinity;
  for (const p of players) {
    if (!p) continue;
    const dist = Math.hypot(p.x + 0.5 - feet.x, p.y + 0.5 - feet.y);
    if (dist > VISION_TILES) continue;
    if (dist < bestDist) { best = p; bestDist = dist; }
  }
  return best;
}

// Pure helper, exported for tests: which directions to try, in priority
// order, to chase the player. Returns [] if not in vision range.
export function chaseDirections(e, player) {
  const feetY = e._ai.tileY + e._ai.h - 1;
  const dx = player.tileX - e._ai.tileX;
  const dy = player.tileY - feetY;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist === 0 || dist > VISION_TILES) return [];
  const horizFirst = Math.abs(dx) >= Math.abs(dy);
  const horiz = dx > 0 ? "right" : dx < 0 ? "left" : null;
  const vert  = dy > 0 ? "down"  : dy < 0 ? "up"   : null;
  const out = [];
  if (horizFirst) { if (horiz) out.push(horiz); if (vert) out.push(vert); }
  else            { if (vert)  out.push(vert);  if (horiz) out.push(horiz); }
  return out;
}

// Can `self` (a mob with an `_ai` footprint) stand with its top-left tile at
// (tileX, tileY)? Only the FEET row collides — a mob's head row slides behind
// tall sprites, same as the player — but the feet row is checked across the
// mob's full width, so a 2-wide mob can't clip a wall with its right half.
// Obstacles are tested against their hittable (feet) rect, the same geometry
// zone.isEntityBlocked uses for the player, so a building's top row is
// walk-behind for monsters too.
export function canEnter(zone, self, tileX, tileY) {
  const w = self._ai.w;
  const bottomY = tileY + self._ai.h - 1;
  for (let dx = 0; dx < w; dx++) {
    if (!isWalkable(zone, tileX + dx, bottomY)) return false;
  }
  for (const other of zone.entities) {
    if (other === self) continue;
    if (other._spawned) continue;
    if (other._dying) continue;
    const sp = getSpecies(other.species_id);
    if (!sp) continue;
    // Open gates are walkable just like in zone.isEntityBlocked. Without
    // this, monsters refuse to cross a gate the player has unlocked.
    if ((sp.entity_type === "Gate" || sp.entity_type === "InverseGate") && other._open) continue;
    if (sp.entity_type === "Teleporter") continue;
    if (!sp.is_rigid && !isMobAi(sp)) continue;
    const hit = entityHittableFrame(other, sp);
    if (!hit) continue;
    for (let dx = 0; dx < w; dx++) {
      if (rectOverlapsTile(hit, tileX + dx, bottomY)) return false;
    }
  }
  return true;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
