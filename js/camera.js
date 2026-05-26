// Camera follows a target (the player) and clamps to world bounds.
// Coordinates are in tile units; the renderer converts to pixels.

import { VIEWPORT_TILES_W, VIEWPORT_TILES_H } from "./constants.js";

export function createCamera() {
  return { x: 0, y: 0, w: VIEWPORT_TILES_W, h: VIEWPORT_TILES_H };
}

export function updateCamera(camera, target, world) {
  let cx = target.x + 0.5 - camera.w / 2;
  let cy = target.y + 0.5 - camera.h / 2;

  // Interior worlds match Rust: the camera always centers on the player,
  // no clamping. Anything outside the world bounds is just empty space.
  // Exterior worlds still clamp so the camera can't drift off the map.
  if (world && !isInteriorWorld(world)) {
    cx = Math.max(0, Math.min(cx, world.cols - camera.w));
    cy = Math.max(0, Math.min(cy, world.rows - camera.h));
  }

  camera.x = cx;
  camera.y = cy;
}

function isInteriorWorld(world) {
  return world.worldType === "HouseInterior";
}
