// A brief white flash on an entity that just took damage. Combat marks the
// target and ages the flash; the WebGL renderer reads it as a per-sprite
// shader effect (the Canvas 2D renderer has no equivalent and ignores it).

const HIT_FLASH_SECONDS = 0.1;

export function markHit(e) {
  e._hitFlash = HIT_FLASH_SECONDS;
}

export function tickHitFlashes(zone, dt) {
  for (const e of zone.entities) {
    if (e._hitFlash > 0) e._hitFlash = Math.max(0, e._hitFlash - dt);
  }
}

/** @returns {number} 0..1, how white the entity's sprite draws this frame. */
export function hitFlashAmount(e) {
  return e?._hitFlash > 0 ? 1 : 0;
}
