// Draws the world and player into a 2D canvas context.
// Layer order: biome → construction → entities → player.

import { TILE_SIZE } from "./constants.js";
import { drawEntities } from "./entities.js";
import { getWorldCache } from "./worldCache.js";
import { drawCutscenes } from "./cutscenes.js";
import { drawTrails } from "./trails.js";
import { isCreativeMode } from "./creativeMode.js";

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export function render(renderer, world, camera, player, biomeFrame) {
  const { ctx, canvas } = renderer;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // `player` may be a single object (single-player) or an array (co-op).
  // The darkness overlay always tracks the first player so it has a
  // single, deterministic centre — co-op players need to stay close
  // enough to share the same cone of light.
  const primary = Array.isArray(player) ? player[0] : player;

  drawWorldLayers(ctx, world, camera, biomeFrame | 0);
  drawTrails(ctx, world, camera);
  drawEntities(ctx, world, camera, player);
  drawCutscenes(ctx, world, camera);
  drawDarkness(ctx, canvas, world, camera, primary);
}

// Blit the pre-baked biome + construction layers. The cache is built
// lazily on first render so we don't pay for it before assets are ready.
function drawWorldLayers(ctx, world, camera, frame) {
  const cache = getWorldCache(world);
  if (!cache) return;
  const ox = Math.round(-camera.x * TILE_SIZE);
  const oy = Math.round(-camera.y * TILE_SIZE);
  const biomeCanvas = cache.biomeFrames[frame % cache.biomeFrames.length];
  ctx.drawImage(biomeCanvas, ox, oy);
  ctx.drawImage(cache.construction, ox, oy);
}

// Applies a per-world light-condition overlay. Mirrors Rust's three
// LightConditions variants: Day is a no-op (verified — Rust ships no
// daylight tint or shader), Night washes the viewport flat blue, and
// CantSeeShit clamps the player into a small radial cone of vision.
function drawDarkness(ctx, canvas, world, camera, player) {
  // Creative mode disables limited visibility entirely — the level
  // designer needs to see everything regardless of CantSeeShit / Night.
  // Mirrors Rust lib.rs::is_limited_visibility returning false in creative.
  if (isCreativeMode()) return;
  if (world.lightConditions === "CantSeeShit") {
    const cx = (player.x + 0.5 - camera.x) * TILE_SIZE;
    const cy = (player.y - camera.y) * TILE_SIZE;
    const inner = TILE_SIZE * 2.5;
    const outer = TILE_SIZE * 5.5;
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.85)");
    grad.addColorStop(1, "rgba(0,0,0,0.985)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (world.lightConditions === "Night") {
    // Flat translucent blue wash for nighttime levels. Less aggressive
    // than CantSeeShit (no radial mask) — the player can still see the
    // whole viewport, just with a cool tint.
    ctx.fillStyle = "rgba(15, 25, 70, 0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}
