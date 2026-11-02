// Draws the world for one or more cameras into the game canvas.
// Layer order: biome → construction → trails → entities → effects → cutscenes → darkness.
// WebGL 2 by default; `?canvas` keeps the Canvas 2D path for side-by-side checks.
// Every drawer below only calls `drawImage` and `globalAlpha` on the context,
// which both the 2D context and the sprite batch provide.

import { TILE_SIZE } from "./constants.js";
import { drawEntities } from "./entities.js";
import { getZoneChunk, chunkRangeFor, CHUNK_TILES } from "./zoneCache.js";
import { drawCutscenes } from "./cutscenes.js";
import { drawTrails } from "./trails.js";
import { drawLocalEffects } from "./localEffects.js";
import { isCreativeMode } from "./creativeMode.js";
import { createSpriteBatch } from "./spriteBatch.js";
import { createDarknessPass } from "./darknessPass.js";

const NIGHT_WASH = [15 / 255, 25 / 255, 70 / 255, 0.45];
const CONE_INNER = TILE_SIZE * 2.5;
const CONE_OUTER = TILE_SIZE * 5.5;
const DIVIDER_PX = 2;

export function wantsCanvas2d(search = typeof location !== "undefined" ? location.search : "") {
  return new URLSearchParams(search).has("canvas");
}

export function createRenderer(canvas) {
  const batch = wantsCanvas2d() ? null : createSpriteBatch(canvas);
  if (batch) return { canvas, ctx: batch, batch, darkness: createDarknessPass(batch) };
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx, batch: null, darkness: null };
}

// Draw the world for one camera. `opts.viewport` (a backing-pixel rect)
// confines the draw to a sub-region of the canvas, one slice per local player
// in split-screen; everything else omits it and draws the whole canvas.
// The darkness cone tracks `opts.focusPlayer`, else the first player.
export function render(renderer, zone, camera, player, biomeFrame, opts = {}) {
  renderer.batch?.beginFrame();
  drawSlice(renderer, zone, camera, player, biomeFrame, opts);
  renderer.batch?.flush();
}

// Split-screen entry point: clear the whole canvas (so any empty cell stays
// black), draw each slice, then the seams. `viewports` is
// [{ rectPx, camera, focusPlayer }]; `renderPlayers` is drawn into every slice.
export function renderViewports(renderer, zone, viewports, renderPlayers, biomeFrame) {
  const { batch, canvas } = renderer;
  batch?.beginFrame();
  fillBlack(renderer, 0, 0, canvas.width, canvas.height);
  for (const vp of viewports) {
    drawSlice(renderer, zone, vp.camera, renderPlayers, biomeFrame, {
      viewport: vp.rectPx,
      focusPlayer: vp.focusPlayer,
    });
  }
  batch?.setSlice({ x: 0, y: 0, w: canvas.width, h: canvas.height });
  for (const { rectPx: r } of viewports) {
    if (r.x + r.w < canvas.width) fillBlack(renderer, r.x + r.w - DIVIDER_PX, r.y, DIVIDER_PX, r.h);
    if (r.y + r.h < canvas.height) fillBlack(renderer, r.x, r.y + r.h - DIVIDER_PX, r.w, DIVIDER_PX);
  }
  batch?.flush();
}

function drawSlice(renderer, zone, camera, player, biomeFrame, opts) {
  const { ctx, canvas, batch } = renderer;
  const vp = opts.viewport ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const focus = opts.focusPlayer ?? (Array.isArray(player) ? player[0] : player);

  if (batch) {
    batch.setSlice(vp);
    batch.clear(0, 0, 0);
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.w, vp.h);
    ctx.clip();
    ctx.translate(vp.x, vp.y);
    fillBlack(renderer, 0, 0, vp.w, vp.h);
  }

  drawZoneLayers(ctx, zone, camera, biomeFrame | 0);
  drawTrails(ctx, zone, camera);
  drawEntities(ctx, zone, camera, player);
  drawLocalEffects(ctx, camera);
  drawCutscenes(ctx, zone, camera);
  drawDarkness(renderer, vp, zone, camera, focus);

  if (!batch) ctx.restore();
}

function fillBlack(renderer, x, y, w, h) {
  const { ctx, batch } = renderer;
  if (batch) { batch.fillRect(x, y, w, h, 0, 0, 0); return; }
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, w, h);
}

// Blit the pre-baked tile chunks covering the camera. Chunks bake lazily on
// first use. Offsets stay seam-free because chunk origins are a whole number
// of pixels apart, so the rounding lands identically on every chunk in a row.
function drawZoneLayers(ctx, zone, camera, frame) {
  const { cx0, cy0, cx1, cy1 } = chunkRangeFor(zone, camera);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const chunk = getZoneChunk(zone, cx, cy);
      if (!chunk) continue;
      const img = chunk.frames[frame % chunk.frames.length];
      const ox = Math.round((cx * CHUNK_TILES - camera.x) * TILE_SIZE);
      const oy = Math.round((cy * CHUNK_TILES - camera.y) * TILE_SIZE);
      ctx.drawImage(img, 0, 0, img.width, img.height, ox, oy, img.width, img.height);
    }
  }
}

// Per-zone light condition, as in the Rust core: Day draws nothing, Night
// washes the slice flat blue, CantSeeShit leaves a small cone of vision around
// the focus player. Creative mode sees everything; with no focus player (every
// local avatar dead) the overlay is skipped.
function drawDarkness(renderer, vp, zone, camera, player) {
  if (isCreativeMode()) return;
  if (!player) return;
  const { ctx, darkness } = renderer;
  if (zone.lightConditions === "CantSeeShit") {
    const cx = (player.x + 0.5 - camera.x) * TILE_SIZE;
    const cy = (player.y - camera.y) * TILE_SIZE;
    if (darkness) { darkness.cone(cx, cy, CONE_INNER, CONE_OUTER); return; }
    const grad = ctx.createRadialGradient(cx, cy, CONE_INNER, cx, cy, CONE_OUTER);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.85)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vp.w, vp.h);
    return;
  }
  if (zone.lightConditions === "Night") {
    if (darkness) { darkness.wash(...NIGHT_WASH); return; }
    const [r, g, b, a] = NIGHT_WASH;
    ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    ctx.fillRect(0, 0, vp.w, vp.h);
  }
}
