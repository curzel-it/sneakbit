// Guest-local cosmetic effects: short-lived, purely-visual flourishes the
// guest paints for its OWN predicted actions (e.g. a muzzle flash the instant
// it presses shoot), so feedback is immediate instead of waiting a network
// round-trip for the host's authoritative bullet to echo back.
//
// These are NEVER networked and NEVER touch zone.entities — they live in this
// module's own list so the mirror's per-frame rebuildZoneEntities() can't wipe
// them and they can't be confused with the host's real, authoritative bullet.
// They auto-expire by age; the guest ticks them and the renderer draws them as
// their own layer.

import { TILE_SIZE } from "./constants.js?v=20260531b";
import { getSpecies } from "./species.js?v=20260531b";
import { getEntitySheet } from "./biomeSheet.js?v=20260531b";

const DEFAULT_FLASH_LIFESPAN = 0.12; // seconds — a brief blip, not a lingering sprite

let effects = [];

// Spawn a one-frame sprite "flash" at a tile, fading out over its lifespan.
// speciesId reuses an existing sprite (e.g. the weapon's bullet species), so
// no new art is needed. x/y are tile coords (the muzzle tile).
export function spawnLocalFlash({ speciesId, x, y, direction = "down", lifespan = DEFAULT_FLASH_LIFESPAN }) {
  if (speciesId == null) return;
  effects.push({ speciesId, x, y, direction, age: 0, lifespan: lifespan > 0 ? lifespan : DEFAULT_FLASH_LIFESPAN });
}

// Age effects and drop the expired ones. Called once per guest frame.
export function tickLocalEffects(dt) {
  if (!effects.length) return;
  for (const e of effects) e.age += dt;
  effects = effects.filter((e) => e.age < e.lifespan);
}

// Draw all live effects. Called from renderer.render() as its own layer, so it
// no-ops cheaply when the list is empty (the host case).
export function drawLocalEffects(ctx, camera) {
  if (!effects.length) return;
  const prevAlpha = ctx.globalAlpha;
  for (const e of effects) {
    const sp = getSpecies(e.speciesId);
    if (!sp) continue;
    const sheet = getEntitySheet(sp);
    if (!sheet) continue;
    const w = sp.width || 1;
    const h = sp.height || 1;
    const sx = sp.texture_x * TILE_SIZE;
    const sy = sp.texture_y * TILE_SIZE;
    const sw = w * TILE_SIZE;
    const sh = h * TILE_SIZE;
    const px = Math.round((e.x - camera.x) * TILE_SIZE);
    const py = Math.round((e.y - camera.y) * TILE_SIZE);
    // Quick linear fade so the flash reads as a blip rather than a popped sprite.
    ctx.globalAlpha = prevAlpha * Math.max(0, 1 - e.age / e.lifespan);
    ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
  }
  ctx.globalAlpha = prevAlpha;
}

// Teardown seam — guest → offline/host transition drops any in-flight flashes
// so a stale one can't paint into the next world.
export function clearLocalEffects() { effects = []; }

export function _getLocalEffectsForTesting() { return effects; }
