// Mob AI — tile-locked, Gameboy-style stepping.
//
// Two movement modes match the original Rust core:
//   * FindHero chases the player when within vision range; otherwise it
//     wanders, matching `move_chasing_player`'s fall-through to
//     `move_around_free` in the Rust core.
//   * Free just wanders at random.
//
// Each mob carries a small `_ai` state with its own step (from→to, with
// progress 0..1) so its sprite slides smoothly between integer tiles,
// matching the player's movement model in player.js.

import { getSpecies } from "./species.js";
import { isWalkable } from "./world.js";

const VISION_TILES = 6;            // chase trigger range (Manhattan)
const WANDER_PAUSE = 0.9;          // sec idle between wander steps
// Mirrors Rust config().base_entity_speed = TILE_SIZE * 1.6 (so the
// effective movement rate is `base_speed × 1.6` tiles/sec). Used to
// derive a per-species step duration from species.base_speed instead
// of fixed CHASE / WANDER constants. The two flat constants were too
// fast for slow critters (slime, 1.0) and too slow for fast ones (cat,
// 2.0), which is what bug #4 in todo.md was about.
const TILE_RATE_PER_BASE_SPEED = 1.6;
const FALLBACK_BASE_SPEED = 1.4;   // ~Rust grapevine boss speed

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};
const ALL_DIRS = ["up", "down", "left", "right"];

export function tickMobs(world, player, dt) {
  if (!world?.entities) return;
  for (const e of world.entities) {
    if (e._spawned) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (!isMobAi(sp)) continue;
    ensureAi(e);
    if (e._ai.step) advanceStep(e, dt);
    else decideStep(e, sp, world, player, dt);
  }
}

function isMobAi(sp) {
  return sp.movement_directions === "FindHero" || sp.movement_directions === "Free";
}

function ensureAi(e) {
  if (e._ai) return;
  const f = e.frame;
  e._ai = {
    step: null,
    decideTimer: 0,
    tileX: Math.floor(f.x),
    tileY: Math.floor(f.y),
    w: Math.max(1, f.w || 1),
    h: Math.max(1, f.h || 1),
  };
  e.frame.x = e._ai.tileX;
  e.frame.y = e._ai.tileY;
}

function decideStep(e, sp, world, player, dt) {
  e._ai.decideTimer -= dt;
  if (e._ai.decideTimer > 0) return;

  const stepDuration = stepDurationFor(sp);
  if (sp.movement_directions === "FindHero") {
    for (const dir of chaseDirections(e, player)) {
      if (tryStartStep(e, dir, world, stepDuration)) return;
    }
  }
  // Wander — also the fallback for FindHero mobs that can't see/reach
  // the player, so monsters keep moving even out of line of sight.
  const dirs = ALL_DIRS.slice();
  shuffle(dirs);
  for (const dir of dirs) {
    if (tryStartStep(e, dir, world, stepDuration)) return;
  }
  e._ai.decideTimer = WANDER_PAUSE;
}

function tryStartStep(e, dir, world, duration) {
  const [dx, dy] = DIR_DELTA[dir];
  const toX = e._ai.tileX + dx;
  const toY = e._ai.tileY + dy;
  if (!canEnter(world, e, toX, toY)) return false;
  e.direction = capitalize(dir);
  e._ai.step = {
    fromX: e._ai.tileX,
    fromY: e._ai.tileY,
    toX, toY,
    progress: 0,
    duration,
  };
  return true;
}

// Per-species step duration mirrors Rust's straight-movement math
// (current_speed × 1.6 tiles/sec, derived from base_entity_speed =
// TILE_SIZE × 1.6 set in game/src/main.rs). Clamped so an extreme
// species data value can't produce a sub-frame step or freeze a mob.
function stepDurationFor(sp) {
  const base = sp.base_speed > 0 ? sp.base_speed : FALLBACK_BASE_SPEED;
  const tilesPerSec = base * TILE_RATE_PER_BASE_SPEED;
  return Math.max(0.12, Math.min(1.5, 1 / tilesPerSec));
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

function canEnter(world, self, tileX, tileY) {
  const bottomY = tileY + self._ai.h - 1;
  if (!isWalkable(world, tileX, bottomY)) return false;
  for (const other of world.entities) {
    if (other === self) continue;
    if (other._spawned) continue;
    const sp = getSpecies(other.species_id);
    if (!sp) continue;
    if (!sp.is_rigid && !isMobAi(sp)) continue;
    const f = other.frame;
    if (!f) continue;
    const ox = Math.floor(f.x);
    const oyBottom = Math.floor(f.y) + (sp.height || f.h || 1) - 1;
    if (tileX === ox && bottomY === oyBottom) return false;
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
