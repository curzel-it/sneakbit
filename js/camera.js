// Camera follows a target (the player) and clamps to zone bounds.
// Coordinates are in tile units; the renderer converts to pixels.
//
// `target` may be a single player object or an array of live players —
// in co-op the camera averages all live positions so both players stay
// on screen, with the zone-bounds clamp applied on top. Dead players
// must not be passed in (they'd drag the centre off into nowhere).

import { VIEWPORT_TILES_W, VIEWPORT_TILES_H } from "./constants.js?v=20260530a";

export function createCamera() {
  return { x: 0, y: 0, w: VIEWPORT_TILES_W, h: VIEWPORT_TILES_H };
}

// The unclamped viewport rect (in tiles) centred on a player. Single
// source of the centering math used both here and by online co-op's
// per-player simulation viewports. Deliberately unclamped: we want the
// true region around a wandered player, not one snapped to zone bounds.
export function cameraRectFor(player, w, h) {
  return { x: player.x + 0.5 - w / 2, y: player.y + 0.5 - h / 2, w, h };
}

export function updateCamera(camera, target, zone) {
  const arr = Array.isArray(target) ? target : (target ? [target] : []);
  if (!arr.length) return;
  let sx = 0, sy = 0;
  for (const p of arr) { sx += p.x; sy += p.y; }
  const ax = sx / arr.length;
  const ay = sy / arr.length;
  let cx = ax + 0.5 - camera.w / 2;
  let cy = ay + 0.5 - camera.h / 2;

  // Interior zones match Rust: the camera always centers on the player,
  // no clamping. Anything outside the zone bounds is just empty space.
  // Exterior zones still clamp so the camera can't drift off the map.
  if (zone && !isInteriorZone(zone)) {
    cx = Math.max(0, Math.min(cx, zone.cols - camera.w));
    cy = Math.max(0, Math.min(cy, zone.rows - camera.h));
  }

  camera.x = cx;
  camera.y = cy;
}

function isInteriorZone(zone) {
  return zone.zoneType === "HouseInterior";
}
