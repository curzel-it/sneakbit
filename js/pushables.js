// Pushable objects (boulders, crates). Tile-locked: the player attempts a
// step into the object's tile; if the tile beyond it is clear, the object
// slides one tile in the same direction and the player follows. Pushables
// remain in their original world JSON until the world is reloaded.

import { getSpecies } from "./species.js";
import { isWalkable, isEntityBlocked } from "./world.js";

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

export function findPushableAt(world, tx, ty) {
  if (!world?.entities) return null;
  for (const e of world.entities) {
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
export function pushOneTile(world, pushable, dir) {
  const [dx, dy] = DIR_DELTA[dir] ?? [0, 0];
  if (!dx && !dy) return false;
  const f = pushable.frame; if (!f) return false;
  const nx = f.x + dx;
  const ny = f.y + dy;
  if (nx < 0 || ny < 0 || nx + f.w > world.cols || ny + f.h > world.rows) return false;
  // Sweep every tile the pushable would occupy in its new footprint.
  for (let yy = ny; yy < ny + f.h; yy++) {
    for (let xx = nx; xx < nx + f.w; xx++) {
      if (!isWalkable(world, xx, yy)) return false;
      if (isEntityBlocked(world, xx, yy, { ignore: pushable })) return false;
    }
  }
  f.x = nx;
  f.y = ny;
  return true;
}
