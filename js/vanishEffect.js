// Vanish effect: when an NPC's after-dialogue behavior is VanishSmoke or
// VanishTeleport (see afterDialogue.js) it doesn't blink out — the NPC body
// fades to nothing while a one-shot effect strip (a puff of smoke / a
// teleport flash) plays in front of it, then the entity is removed and its
// despawn persists via the onRemove hook the caller supplies.
//
// This keeps its own lifecycle rather than reusing the death fireball
// (deathAnimation.js): the death path replaces the entity's sprite outright,
// whereas here the original NPC sprite stays on screen and fades, with the
// effect layered on top.

import { ANIMATIONS_FPS } from "./constants.js";

// Effect strips on the animated_objects sheet (sheet id 1012). Each is a 1×2
// column whose frames advance along x; coordinates are in tiles. The strip
// plays once over `frames / ANIMATIONS_FPS` seconds and the body fades out
// across that same span.
const SPRITES = {
  teleport: { sheet: "animated_objects", texX: 22, texY: 13, w: 1, h: 2, frames: 6 },
  smoke:    { sheet: "animated_objects", texX: 28, texY: 13, w: 1, h: 2, frames: 7 },
};

// "fade" vanishes the body alone — no effect strip layered on top — over this
// span. Used when the puff would be too much and the fade-out reads on its own.
const FADE_DURATION = 0.7; // seconds

// kind is "smoke", "teleport", or "fade". Idempotent — a second call on an
// already vanishing entity is a no-op so the fade can't be restarted.
export function startVanish(entity, kind, onRemove) {
  if (!entity || entity._vanish) return;
  if (kind === "fade") {
    entity._vanish = { sprite: null, elapsed: 0, duration: FADE_DURATION, onRemove: onRemove ?? null };
    return;
  }
  const sprite = SPRITES[kind] || SPRITES.smoke;
  const duration = sprite.frames / ANIMATIONS_FPS;  // play the strip once
  entity._vanish = { sprite, elapsed: 0, duration, onRemove: onRemove ?? null };
}

export function isVanishing(entity) {
  return !!entity?._vanish;
}

// Ages every vanishing NPC, removing it (and firing its onRemove) once the
// effect has played out and the body has fully faded. Driven from
// afterDialogue.tickAfterDialogue alongside the other post-dialogue exits.
export function tickVanish(zone, dt) {
  const ents = zone?.entities;
  if (!ents) return;
  for (let i = ents.length - 1; i >= 0; i--) {
    const v = ents[i]._vanish;
    if (!v) continue;
    v.elapsed += dt;
    if (v.elapsed >= v.duration) {
      if (typeof v.onRemove === "function") v.onRemove();
      ents.splice(i, 1);
    }
  }
}

// Renderer helpers (entities.js). alpha fades the NPC body from opaque to
// gone; overlay hands back the effect sprite and its current frame (clamped,
// non-looping) so the renderer can blit it in front of the body.
export function vanishAlpha(entity) {
  const v = entity?._vanish;
  if (!v) return 1;
  return Math.max(0, 1 - v.elapsed / v.duration);
}

export function vanishOverlay(entity) {
  const v = entity?._vanish;
  if (!v || !v.sprite) return null;
  const sp = v.sprite;
  const frame = Math.min(sp.frames - 1, Math.floor(v.elapsed * ANIMATIONS_FPS));
  return { sprite: sp, frame };
}
