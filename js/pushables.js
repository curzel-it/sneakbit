// Pushable objects (boulders, crates). Tile-locked: the player attempts a
// step into the object's tile; if the tile beyond it is clear, the object
// slides one tile in the same direction and the player follows. The slide
// is interpolated by tickPushables so the rock visually keeps pace with
// the player's step animation instead of teleporting one tile per press.

import { getSpecies } from "./species.js";
import { isWalkable, isEntityBlocked } from "./zone.js";
import { isCreativeMode } from "./creativeMode.js";

const SLIDE_DURATION = 0.22; // matches player STEP_DURATION in player.js

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

export function isPushable(entity) {
  const sp = getSpecies(entity?.species_id);
  return sp?.entity_type === "PushableObject";
}

export function findPushableAt(zone, tx, ty) {
  if (!zone?.entities) return null;
  // Creative mode: pushables behave like every other Generic entity —
  // is_rigid is dropped, so the hero just walks across them instead of
  // shoving them. Skipping the lookup keeps player.js's pushable carry-
  // back path inert in creative too.
  if (isCreativeMode()) return null;
  for (const e of zone.entities) {
    if (!isPushable(e)) continue;
    const f = e.frame; if (!f) continue;
    if (tx < f.x || tx >= f.x + f.w) continue;
    if (ty < f.y || ty >= f.y + f.h) continue;
    return e;
  }
  return null;
}

// Try to push `pushable` one tile along `dir`. Returns true if it moved.
// Pushables block other pushables, so the destination tile check uses
// the same isEntityBlocked rules the player walks against.
//
// The slide is animated: frame.x/y commits to the destination
// immediately (so collisions read the new tile), and a `_slide` record
// drives a per-frame render offset toward zero. entities.js applies the
// offset when blitting the sprite.
export function pushOneTile(zone, pushable, dir) {
  const [dx, dy] = DIR_DELTA[dir] ?? [0, 0];
  if (!dx && !dy) return false;
  const f = pushable.frame; if (!f) return false;
  const nx = f.x + dx;
  const ny = f.y + dy;
  if (nx < 0 || ny < 0 || nx + f.w > zone.cols || ny + f.h > zone.rows) return false;
  // Sweep every tile the pushable would occupy in its new footprint.
  for (let yy = ny; yy < ny + f.h; yy++) {
    for (let xx = nx; xx < nx + f.w; xx++) {
      if (!isWalkable(zone, xx, yy)) return false;
      if (isEntityBlocked(zone, xx, yy, { ignore: pushable })) return false;
    }
  }
  startSlide(pushable, dx, dy);
  f.x = nx;
  f.y = ny;
  return true;
}

// Carry-back path (player.js startStep) also moves a pushable but writes
// frame.x/y directly. Wire the slide through this helper so the rock
// glides instead of teleporting.
export function startSlide(pushable, dx, dy) {
  pushable._slide = { ox: -dx, oy: -dy, t: 0, duration: SLIDE_DURATION };
}

// Returns the {x, y} render offset (in tiles) the renderer should
// subtract from frame.x/y to interpolate the slide. Decays linearly
// from (-dx, -dy) at t=0 to (0, 0) at t=1.
export function pushableRenderOffset(pushable) {
  const s = pushable._slide;
  if (!s) return null;
  const remaining = 1 - s.t;
  return { x: s.ox * remaining, y: s.oy * remaining };
}

export function tickPushables(zone, dt) {
  if (!zone?.entities) return;
  for (const e of zone.entities) {
    const s = e._slide;
    if (!s) continue;
    s.t += dt / s.duration;
    if (s.t >= 1) delete e._slide;
  }
}
