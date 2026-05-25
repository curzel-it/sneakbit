// Camera follows a target (the player) and clamps to world bounds.
// Coordinates are in tile units; the renderer converts to pixels.

import { VIEWPORT_TILES_W, VIEWPORT_TILES_H } from "./constants.js";

export function createCamera() {
  return { x: 0, y: 0, w: VIEWPORT_TILES_W, h: VIEWPORT_TILES_H };
}

export function updateCamera(camera, target, world) {
  let cx = target.x + 0.5 - camera.w / 2;
  let cy = target.y + 0.5 - camera.h / 2;

  if (world) {
    cx = Math.max(0, Math.min(cx, world.cols - camera.w));
    cy = Math.max(0, Math.min(cy, world.rows - camera.h));
  }

  camera.x = cx;
  camera.y = cy;
}
