// Draws the zone and player into a 2D canvas context.
// Layer order: biome → construction → entities → player.

import { TILE_SIZE } from "./constants.js";
import { drawEntities } from "./entities.js";
import { getZoneCache } from "./zoneCache.js";
import { drawCutscenes } from "./cutscenes.js";
import { drawTrails } from "./trails.js";
import { drawLocalEffects } from "./localEffects.js";
import { isCreativeMode } from "./creativeMode.js";

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

// Draw the world for one camera. `opts.viewport` (a backing-pixel rect)
// confines the draw to a sub-region of the canvas — split-screen passes one
// slice per local player; everything else omits it and draws the whole canvas.
// Because every drawer is camera-relative ((x - camera.x) * TILE_SIZE), a
// clip + translate to the slice origin lets the existing chain draw slice-local
// with no other changes.
export function render(renderer, zone, camera, player, biomeFrame, opts = {}) {
  const { ctx, canvas } = renderer;
  const vp = opts.viewport ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };

  // `player` may be a single object (single-player) or an array (co-op). The
  // darkness cone tracks a single focus player — the slice's own player in
  // split-screen, else the first player (co-op partners share one cone).
  const focus = opts.focusPlayer ?? (Array.isArray(player) ? player[0] : player);

  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.x, vp.y, vp.w, vp.h);
  ctx.clip();
  ctx.translate(vp.x, vp.y);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, vp.w, vp.h);

  drawZoneLayers(ctx, zone, camera, biomeFrame | 0);
  drawTrails(ctx, zone, camera);
  drawEntities(ctx, zone, camera, player);
  // Guest-local cosmetic flashes (e.g. the muzzle flash for the guest's own
  // predicted shot). Empty/no-op on the host. Above entities so it reads as a
  // flash over the world.
  drawLocalEffects(ctx, camera);
  drawCutscenes(ctx, zone, camera);
  drawDarkness(ctx, vp, zone, camera, focus);

  ctx.restore();
}

// Split-screen entry point: clear the whole canvas (so any empty cell — the
// 3-up near-square blank — stays black), draw each slice, then the seams.
// `viewports` is [{ rectPx, camera, focusPlayer }]; `renderPlayers` is the full
// live-player list drawn into every slice so partners appear in each other's view.
export function renderViewports(renderer, zone, viewports, renderPlayers, biomeFrame) {
  const { ctx, canvas } = renderer;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const vp of viewports) {
    render(renderer, zone, vp.camera, renderPlayers, biomeFrame, {
      viewport: vp.rectPx,
      focusPlayer: vp.focusPlayer,
    });
  }
  drawDividers(ctx, canvas, viewports);
}

// 2px seams along interior slice edges (right/bottom of each slice that isn't
// the canvas edge). Drawn in absolute canvas pixels, after all slices.
const DIVIDER_PX = 2;
function drawDividers(ctx, canvas, viewports) {
  ctx.fillStyle = "#000";
  for (const { rectPx: r } of viewports) {
    if (r.x + r.w < canvas.width) ctx.fillRect(r.x + r.w - DIVIDER_PX, r.y, DIVIDER_PX, r.h);
    if (r.y + r.h < canvas.height) ctx.fillRect(r.x, r.y + r.h - DIVIDER_PX, r.w, DIVIDER_PX);
  }
}

// Blit the pre-baked biome + construction layers. The cache is built
// lazily on first render so we don't pay for it before assets are ready.
function drawZoneLayers(ctx, zone, camera, frame) {
  const cache = getZoneCache(zone);
  if (!cache) return;
  const ox = Math.round(-camera.x * TILE_SIZE);
  const oy = Math.round(-camera.y * TILE_SIZE);
  const biomeCanvas = cache.biomeFrames[frame % cache.biomeFrames.length];
  ctx.drawImage(biomeCanvas, ox, oy);
  ctx.drawImage(cache.construction, ox, oy);
}

// Applies a per-zone light-condition overlay. Mirrors Rust's three
// LightConditions variants: Day is a no-op (verified — Rust ships no
// daylight tint or shader), Night washes the viewport flat blue, and
// CantSeeShit clamps the player into a small radial cone of vision.
// `vp` is the viewport rect ({ w, h }) in slice-local pixels — the ctx is
// already translated to the slice origin, so overlays fill from (0, 0).
function drawDarkness(ctx, vp, zone, camera, player) {
  // Creative mode disables limited visibility entirely — the level
  // designer needs to see everything regardless of CantSeeShit / Night.
  // Mirrors Rust lib.rs::is_limited_visibility returning false in creative.
  if (isCreativeMode()) return;
  // No focus player (e.g. every local avatar is dead) — skip rather than
  // dereference an undefined position, which would throw and kill the frame
  // loop. Callers pass a death-persistent focus so the cone normally stays put.
  if (!player) return;
  if (zone.lightConditions === "CantSeeShit") {
    const cx = (player.x + 0.5 - camera.x) * TILE_SIZE;
    const cy = (player.y - camera.y) * TILE_SIZE;
    const inner = TILE_SIZE * 2.5;
    const outer = TILE_SIZE * 5.5;
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.85)");
    // Fully opaque at the cone's edge: a radial gradient extends its last
    // stop's color past `outer`, so anything beyond the vision radius is
    // pure black — the maze outside the cone is hidden completely, not at
    // ~98% where it stayed faintly legible.
    grad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vp.w, vp.h);
    return;
  }
  if (zone.lightConditions === "Night") {
    // Flat translucent blue wash for nighttime levels. Less aggressive
    // than CantSeeShit (no radial mask) — the player can still see the
    // whole viewport, just with a cool tint.
    ctx.fillStyle = "rgba(15, 25, 70, 0.45)";
    ctx.fillRect(0, 0, vp.w, vp.h);
  }
}
