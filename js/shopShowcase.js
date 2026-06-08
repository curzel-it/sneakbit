// Animated "show off" preview for the shop's currently-focused good. Given a
// stock entry it resolves the real in-world sprite and loops its animation on a
// single requestAnimationFrame, painting a supplied canvas. shop.js owns the
// canvas + layout; this module owns "what does this good look like, animated".
//
// Resolution by good:
//   * skin        → the hero, walking in place (heroes sheet, down-moving row)
//   * weapon item → the weapon it grants (weapons sheet, down-moving strip)
//   * ammo bundle → the projectile it contains (the first bundle content)
//   * anything else (raw bullet, potion, plain pickup) → its own world sprite
// Frames that don't animate (sprite_number_of_frames <= 1) paint once and hold.

import { TILE_SIZE, ANIMATIONS_FPS } from "./constants.js";
import { getSprite } from "./assets.js";
import { getSpecies, getEntitySheet } from "./species.js";
import { getSkin } from "./skins.js";
import { isSkinEntry } from "./shopPurchase.js";

// Directional sprites (hero, weapon) keep 8 rows (4 dirs × moving/still); row 4
// is "down-moving". For the hero that lands at sheet-y 9 (origin 1 + 4×h2),
// mirroring player.js getPlayerSpriteFrame's down/moving offset.
const DOWN_MOVING_ROW = 4;
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

  const sp = getSpecies(entry.item);
  if (!sp) return null;

  // A weapon item shows the weapon it grants, on its down-moving strip.
  if (sp.associated_weapon) {
    const w = getSpecies(sp.associated_weapon);
    if (w) {
      const sheet = getEntitySheet(w);
      const h = w.height || 1;
      if (sheet) return { sheet, sx0: w.texture_x * TILE_SIZE, sy: (w.texture_y + DOWN_MOVING_ROW * h) * TILE_SIZE, tileW: w.width || 1, tileH: h, frames: Math.max(1, w.frames) };
    }
  }

  // An ammo bundle shows the projectile it contains.
  if (sp.bundle_contents?.length) {
    const b = getSpecies(sp.bundle_contents[0]);
    if (b) { const d = genericDescriptor(b); if (d) return d; }
  }

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
