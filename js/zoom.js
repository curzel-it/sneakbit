// Auto-sizes the game canvas + camera to fit the viewport while keeping
// pixel art crisp.
//
// Pixel-perfect rule: every source pixel in the canvas backing store must
// map to an INTEGER number of physical screen pixels. The scale chain is
// backing px → CSS px → physical px (the second hop is devicePixelRatio).
// We pick an integer SCALE (physical px per source px) and then choose the
// CSS dimensions so that (cssSize × dpr) / backing = SCALE exactly. This
// works the same on a 1x desktop, a 1.5x Windows display, a 2x Retina
// laptop and a 3x phone.

import { TILE_SIZE } from "./constants.js";

// Lower bound on how many tiles span the viewport width. Kept deliberately
// low so narrow phones keep the original app's tile size: the iOS build
// (RenderingScaleUseCase) used a fixed renderingScale of 2 on phones — i.e.
// 32 CSS px per tile — and simply let the tile count fall out of the screen
// width (~11.7 across on an iPhone 13 mini). A higher minimum here would
// force the scale loop below to shrink the scale to cram more tiles in,
// making every tile smaller than on the original. 10 preserves the target
// scale on phones down to 320 CSS px wide while still guarding tiny windows.
const MIN_TILES_W = 10;
const MAX_TILES_W = 36;
const TARGET_PHYS_TILE_PX = 32; // target tile size at DPR=1 (CSS px)

export function applyAutoZoom(canvas, camera, hud, onApply) {
  // Prefer visualViewport when present: window.innerWidth/Height is stale
  // on mobile while the soft keyboard / address bar are mid-animation
  // (especially on iOS Safari, where `resize` fires once on keyboard-up
  // and not at all when the kbd is dismissed by losing focus). The
  // visual viewport always reflects the *currently visible* area, which
  // is what we want to size the canvas against.
  const vv = (typeof window !== "undefined") ? window.visualViewport : null;
  const vw = Math.max(1, vv?.width  ?? window.innerWidth);
  const vh = Math.max(1, vv?.height ?? window.innerHeight);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const pvW = vw * dpr; // viewport in physical pixels
  const pvH = vh * dpr;

  // Pick the integer "physical px per source px" closest to the target tile
  // size on this display. SCALE >= 2 keeps tiles visible even on tiny screens.
  let scale = Math.max(2, Math.round((TARGET_PHYS_TILE_PX * dpr) / TILE_SIZE));
  // If the viewport can't fit MIN_TILES_W tiles at this scale, drop the
  // scale down step by step.
  while (scale > 1 && Math.floor(pvW / (scale * TILE_SIZE)) < MIN_TILES_W) {
    scale--;
  }
  // On very large displays, bump the scale up so big monitors don't leave
  // half the screen as letterbox. Stops as soon as the next step would fall
  // below MIN_TILES_W.
  while (Math.floor(pvW / (scale * TILE_SIZE)) > MAX_TILES_W &&
         Math.floor(pvW / ((scale + 1) * TILE_SIZE)) >= MIN_TILES_W) {
    scale++;
  }

  // Use ceil so the canvas covers the viewport even when the viewport
  // width isn't an exact multiple of (scale × TILE_SIZE). The overflowing
  // half-tiles at the edges land outside the visible area (clipped by
  // body { overflow: hidden }), so the player sees a seamless surface
  // instead of a thin black border on the bottom/right.
  //
  // MAX_TILES_W is only a *target* for the scale-selection loops above (it
  // drives how far they bump the scale on big monitors) — it must NOT hard-cap
  // the backing here. Clamping the ceil down to MAX_TILES_W makes the canvas
  // narrower than the window whenever the window needs that one extra tile,
  // re-introducing the exact black edge the ceil exists to kill. The loops keep
  // the count at MAX_TILES_W in the common case, so dropping the cap costs at
  // most a single extra tile (e.g. 37) at the sizes that would otherwise gutter.
  let tilesW = Math.max(MIN_TILES_W, Math.ceil(pvW / (scale * TILE_SIZE)));
  let tilesH = Math.max(10, Math.ceil(pvH / (scale * TILE_SIZE)));

  const backingW = tilesW * TILE_SIZE;
  const backingH = tilesH * TILE_SIZE;

  if (canvas.width !== backingW) canvas.width = backingW;
  if (canvas.height !== backingH) canvas.height = backingH;
  // CSS size chosen so backing→physical scale equals `scale` exactly. May
  // be fractional CSS px on fractional DPRs (e.g. 1.5x Windows) — that's
  // fine; physical pixels stay integer-aligned.
  canvas.style.width = `${(backingW * scale) / dpr}px`;
  canvas.style.height = `${(backingH * scale) / dpr}px`;

  camera.w = tilesW;
  camera.h = tilesH;

  if (hud) {
    hud.dataset.tiles = `${tilesW}×${tilesH} ${scale}× dpr=${dpr.toFixed(2)}`;
  }

  // Split-screen recomputes its per-slice cameras + geometry from the new
  // canvas size. Runs after camera.w/h are set so single-slice values match.
  if (onApply) onApply();
}

let activeApply = null;

export function installAutoZoom(canvas, camera, hud, onApply) {
  const apply = () => applyAutoZoom(canvas, camera, hud, onApply);
  activeApply = apply;
  apply();
  // Boot race: the synchronous apply() above can run before the browser has
  // committed the final layout, so `visualViewport.width` / `devicePixelRatio`
  // are momentarily stale (a known quirk right after load). Since the viewport
  // size is already final, no `resize` event ever fires to correct it — which
  // is why the symptom (black bars / missing tiles on the right + bottom) only
  // cleared after a *manual* window resize. Re-measuring once layout has
  // settled fixes it. applyAutoZoom is idempotent (it only touches the canvas
  // when a dimension actually differs), so these extra passes are free no-ops
  // in the common case where the first measurement was already correct.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }
  if (typeof window !== "undefined") window.addEventListener("load", apply);
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  // Mobile address bar / soft keyboard animations don't always trigger
  // `resize`. visualViewport fires `resize` on every committed change to
  // the visible region — including the iOS keyboard slide-up that
  // shrinks the area, *and* the slide-down that grows it back. Without
  // this listener the canvas can be left at a transient size (the case
  // reported as "co-op shrinks the play area to a 3:4 box with bars on
  // every side").
  if (typeof window !== "undefined" && window.visualViewport) {
    window.visualViewport.addEventListener("resize", apply);
  }
  return apply;
}

// Re-runs the most recently installed auto-zoom. Useful after a role
// switch or modal close — mobile browsers don't always fire a resize
// event when their address bar / soft keyboard re-collapses, so the
// canvas can be left sized for a transient viewport. Safe no-op when
// installAutoZoom hasn't run yet.
export function reapplyAutoZoom() {
  if (activeApply) activeApply();
}
