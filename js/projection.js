// World→screen projection. The one place that owns the "how upright is the
// world" math, so no other feature hardcodes `* TILE_SIZE` for the vertical
// axis again.
//
// Two modes, chosen once at load from the `?bb=1` URL flag (like the `?iso=1`
// polygon experiment):
//   - flat (default): TILT === 1, every function reduces to the classic
//     top-down `(world - camera) * TILE_SIZE`. Pixel-identical to the old
//     renderer, so netcode/e2e and every non-billboard consumer are untouched.
//   - billboard (?bb=1): TILT < 1 compresses the DEPTH (screen-y) axis so the
//     ground recedes, while standing sprites keep full unscaled height and
//     stand upright on that tilted floor.
//
// Horizontal (screen-x) is never compressed — only depth is. No per-sprite
// distance scaling (constant scale), so pixels stay integer-sized: the
// deliberate tradeoff vs. true perspective.

import { TILE_SIZE } from "./constants.js";

const BILLBOARD = (typeof location !== "undefined") &&
  new URLSearchParams(location.search).get("bb") === "1";

// Depth compression. 1 = flat top-down; lower tilts the floor more. Tune 0.6–0.75.
export const TILT = BILLBOARD ? 0.66 : 1;

export const isBillboard = () => BILLBOARD;

// Screen-x of a world column (never compressed).
export function screenX(wx, camera) {
  return (wx - camera.x) * TILE_SIZE;
}

// Screen-y of a point ON the tilted ground plane (floor tiles, decals, shadows).
export function groundY(wy, camera) {
  return (wy - camera.y) * TILE_SIZE * TILT;
}

// A point on the ground plane. Floor-plane sprites (underlay decals, shadows)
// project their top-left here and draw with their pixel HEIGHT scaled by TILT
// (they lie in the floor, so they compress with it).
export function projectGround(wx, wy, camera) {
  return { sx: screenX(wx, camera), sy: groundY(wy, camera) };
}

// A standing (billboard) sprite whose top-left is world (wx, wy) and whose
// footprint is `hTiles` tall. The feet sit on the tilted ground; the body
// rises upright at full unscaled height above them. Returns the top-left the
// sprite should be blitted at (height NOT compressed).
export function projectBillboard(wx, wy, hTiles, camera) {
  const feetY = wy + hTiles;
  return { sx: screenX(wx, camera), sy: groundY(feetY, camera) - hTiles * TILE_SIZE };
}

// Screen-y for an overlay pinned to a host sprite's feet (weapons, armour):
// the overlay's own top-left may sit above the shared feet by `aboveFeet`
// tiles, but it must ride the host's ground anchor so it never drifts off the
// body under tilt.
export function billboardFromFeet(feetY, aboveFeet, camera) {
  return groundY(feetY, camera) - aboveFeet * TILE_SIZE;
}

// Painter-sort depth key (feet row). Matches how entities.js already sorts.
export const depthOf = (wy) => wy;

// Inverse of projectGround — screen (slice-local px) back to world tiles.
// For creative-mode picking and touch input.
export function unprojectGround(px, py, camera) {
  return {
    wx: px / TILE_SIZE + camera.x,
    wy: py / (TILE_SIZE * TILT) + camera.y,
  };
}
