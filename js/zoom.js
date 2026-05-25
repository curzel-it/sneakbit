// Auto-sizes the game canvas + camera to fit the viewport while keeping
// tiles pixel-aligned. Picks an integer "renderScale" (CSS pixels per game
// pixel), considering devicePixelRatio so high-DPI screens get crisper
// art without growing the camera tile-count beyond what we want.
//
// The camera is sized to fit roughly DESIRED_TILES_W × DESIRED_TILES_H of
// the world on screen, but on very small/large viewports we adjust so a
// tile is at least 2 CSS pixels and at most about 4× the base size.

import { TILE_SIZE } from "./constants.js";

const MIN_TILES_W = 16;
const MAX_TILES_W = 36;
const TARGET_PHYS_TILE_PX = 32; // try to render each tile at ~32 CSS px

export function applyAutoZoom(canvas, camera, hud) {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const aspect = vw / vh;

  // Choose tile count to fit the desired physical tile size.
  let tilesW = Math.round(vw / TARGET_PHYS_TILE_PX);
  tilesW = Math.max(MIN_TILES_W, Math.min(MAX_TILES_W, tilesW));
  let tilesH = Math.max(10, Math.round(tilesW / aspect));

  // Pixel size of the canvas backing store.
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.floor(vw);
  const cssH = Math.floor(vh);
  const physTileSize = Math.max(1, Math.floor(cssW / tilesW));
  // Recompute tilesH from final tile size so we don't have a fractional row.
  tilesH = Math.max(10, Math.floor(cssH / physTileSize));

  const backingW = tilesW * TILE_SIZE;
  const backingH = tilesH * TILE_SIZE;

  // Set internal resolution to integer tile multiples; CSS size scales it.
  if (canvas.width !== backingW) canvas.width = backingW;
  if (canvas.height !== backingH) canvas.height = backingH;
  canvas.style.width = `${tilesW * physTileSize}px`;
  canvas.style.height = `${tilesH * physTileSize}px`;

  camera.w = tilesW;
  camera.h = tilesH;

  if (hud) {
    hud.dataset.tiles = `${tilesW}x${tilesH}@${physTileSize}px (dpr=${dpr.toFixed(1)})`;
  }
}

export function installAutoZoom(canvas, camera, hud) {
  const apply = () => applyAutoZoom(canvas, camera, hud);
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  return apply;
}
