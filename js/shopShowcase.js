// Animated "show off" preview for the shop's currently-focused good. Given a
// stock entry it resolves the real in-world sprite and loops its animation on a
// single requestAnimationFrame, painting a supplied canvas. shop.js owns the
// canvas + layout; this module owns "what does this good look like, animated".
//
// Resolution by good:
//   * skin        → the hero, walking in place (heroes sheet, down-moving row)
//   * ammo bundle → the projectile it contains, flying up (first bundle content,
//                   shown on its up-moving directional row, looping its frames)
//   * anything else (weapon pickup, raw bullet, potion) → its own world sprite,
//                   i.e. the on-ground idle animation for pickable weapons
// Frames that don't animate (sprite_number_of_frames <= 1) paint once and hold.

import { TILE_SIZE, ANIMATIONS_FPS } from "./constants.js";
import { getSprite } from "./assets.js";
import { getSpecies, getEntitySheet } from "./species.js";
import { getSkin } from "./skins.js";
import { skillInfo } from "./skills.js";
import { isSkinEntry, isSkillEntry } from "./shopPurchase.js";

// The hero's directional sheet keeps 8 rows (4 dirs × moving/still); "down-moving"
// lands at sheet-y 9 (origin 1 + row 4 × h2), mirroring player.js
// getPlayerSpriteFrame's down/moving offset. Bullets use their up-moving row,
// which is the base sprite_frame row (DIR_ROW_MOVING.up === 0), so no offset.
const HERO_DOWN_MOVING_Y = 9;

let canvas = null;
let current = null;   // descriptor | null
let raf = 0;
let startMs = 0;

export function mountShowcase(c) { canvas = c; }

// Set (or replace) the focused good and (re)start its animation from frame 0.
export function showEntry(entry) {
  current = descriptorFor(entry);
  startMs = now();
  if (!raf) raf = requestAnimationFrame(tick);
  else paint(0); // immediate repaint so the swap isn't a frame late
}

export function stopShowcase() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  current = null;
}

function tick() {
  raf = requestAnimationFrame(tick);
  if (!current) return;
  const frames = Math.max(1, current.frames);
  const idx = frames > 1
    ? Math.floor(((now() - startMs) / 1000) * ANIMATIONS_FPS) % frames
    : 0;
  paint(idx);
}

function paint(frameIdx) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const d = current;
  if (!d || !d.sheet || !d.sheet.complete) return;
  const sw = d.tileW * TILE_SIZE;
  const sh = d.tileH * TILE_SIZE;
  const sx = d.sx0 + frameIdx * sw;
  // Integer upscale to fit the box, keeping pixel art crisp.
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / sw, canvas.height / sh)));
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = Math.round((canvas.width - dw) / 2);
  const dy = Math.round((canvas.height - dh) / 2);
  ctx.drawImage(d.sheet, sx, d.sy, sw, sh, dx, dy, dw, dh);
}

function descriptorFor(entry) {
  if (!entry) return null;

  if (isSkinEntry(entry)) {
    const skin = getSkin(entry.skin);
    if (!skin || skin.column == null) return null;
    let sheet;
    try { sheet = getSprite("heroes"); } catch { return null; }
    return { sheet, sx0: skin.column * TILE_SIZE, sy: HERO_DOWN_MOVING_Y * TILE_SIZE, tileW: 1, tileH: 2, frames: 4 };
  }

  // A skill shows its static inventory-sheet icon (no in-world sprite to animate).
  if (isSkillEntry(entry)) {
    const icon = skillInfo(entry.skill)?.icon;
    if (!icon) return null;
    let sheet;
    try { sheet = getSprite("inventory"); } catch { return null; }
    return { sheet, sx0: icon[1] * TILE_SIZE, sy: icon[0] * TILE_SIZE, tileW: 1, tileH: 1, frames: 1 };
  }

  const sp = getSpecies(entry.item);
  if (!sp) return null;

  // An ammo bundle shows the projectile it contains, on its up-moving row (its
  // base sprite_frame), looping its flight frames — the "shot up" animation.
  if (sp.bundle_contents?.length) {
    const b = getSpecies(sp.bundle_contents[0]);
    if (b) { const d = genericDescriptor(b); if (d) return d; }
  }

  // Everything else (weapon pickups included) shows its own world sprite. For a
  // pickable weapon that's its on-ground idle strip; for a potion, its sprite.
  return genericDescriptor(sp);
}

function genericDescriptor(sp) {
  const sheet = getEntitySheet(sp);
  if (!sheet) return null;
  return { sheet, sx0: sp.texture_x * TILE_SIZE, sy: sp.texture_y * TILE_SIZE, tileW: sp.width || 1, tileH: sp.height || 1, frames: Math.max(1, sp.frames) };
}

function now() {
  return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}
