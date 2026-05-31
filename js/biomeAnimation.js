// Cycles through the 4 biome animation frames at TILE_VARIATIONS_FPS.
// The renderer reads `.frame` each tick to know which strip to sample.

import { BIOME_NUMBER_OF_FRAMES, TILE_VARIATIONS_FPS } from "./constants.js";

export function createBiomeAnimation() {
  return { frame: 0, _t: 0 };
}

export function tickBiomeAnimation(anim, dt) {
  anim._t += dt;
  const period = 1 / TILE_VARIATIONS_FPS;
  while (anim._t >= period) {
    anim._t -= period;
    anim.frame = (anim.frame + 1) % BIOME_NUMBER_OF_FRAMES;
  }
}
