// Split-screen layout for local multiplayer. Replaces the shared averaged
// camera (one viewport that tried to keep every player on screen) with one
// viewport slice per local player, laid out to fit the current window.
//
// Split-screen is a LOCAL concern, for both co-op and PvP: every player on
// this device gets their own follow-self slice. Online stays single-slice —
// each client already renders its own follow-self window — so this module
// reports a slice count of 1 for online and the rest of the engine renders
// exactly as before.
//
// Responsibilities, and nothing else:
//   - computeLayout()  : grid shape (cols/rows + per-player cell) from the
//                        player count and window aspect (spec Requirement 4)
//   - sliceRectsPx()   : partition a surface into per-player pixel rects
//   - recomputeSlices(): keep state.cameras + the cached slice geometry in
//                        sync with the layout (called on resize + count change)
//   - getSlices()      : cached geometry the renderer + health HUD read
//
// See docs/split-screen.md.

import { TILE_SIZE } from "./constants.js";
import { localPlayerCount } from "./coopMode.js";
import { getRuntimeRole } from "./onlineMode.js";
import { createCamera } from "./camera.js";

// Aspect bands (aspect = w / h). Only the 3-player case uses the near-square
// band; 2-up just splits along the dominant axis.
const WIDE = 4 / 3;
const TALL = 3 / 4;

// How many slices to draw. Online is always a single follow-self window;
// local play (co-op or PvP) fans out one slice per player on this device.
export function sliceCount() {
  if (isOnline()) return 1;
  return clampCount(localPlayerCount());
}

function isOnline() {
  const r = getRuntimeRole();
  return r === "host" || r === "guest";
}

function clampCount(n) {
  return Math.max(1, Math.min(4, n | 0));
}

// Grid shape + per-player cell, from player count and surface aspect.
// Returns { cols, rows, cells: [{ col, row }] } where cells[i] is player i's
// cell. The 3-up near-square case omits the bottom-right cell (it stays black).
export function computeLayout(count, w, h) {
  count = clampCount(count);
  const aspect = h > 0 ? w / h : 1;

  if (count === 1) return { cols: 1, rows: 1, cells: [{ col: 0, row: 0 }] };

  if (count === 2) {
    return w >= h
      ? { cols: 2, rows: 1, cells: [{ col: 0, row: 0 }, { col: 1, row: 0 }] }
      : { cols: 1, rows: 2, cells: [{ col: 0, row: 0 }, { col: 0, row: 1 }] };
  }

  if (count === 3) {
    if (aspect > WIDE) {
      return { cols: 3, rows: 1, cells: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }] };
    }
    if (aspect < TALL) {
      return { cols: 1, rows: 3, cells: [{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }] };
    }
    // Near-square: 2x2 with the bottom-right cell left empty.
    return { cols: 2, rows: 2, cells: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }] };
  }

  // count === 4
  return {
    cols: 2, rows: 2,
    cells: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 1 }],
  };
}

// Partition a w×h surface into per-player pixel rects. Boundaries are snapped
// to whole TILE_SIZE lines so every slice width/height is an exact tile count.
// That matters because each slice camera covers floor(rect / TILE_SIZE) tiles:
// if a boundary fell mid-tile, the camera would render slightly narrower than
// its slice, leaving an unrendered black gutter on the slice's right/bottom
// wherever the zone image doesn't bleed past it (map edges, dark/cone zones).
// The surface dims (w, h) are already tile multiples (zoom.js), so the outer
// edges land exactly on w/h and the slices still tile with no gaps/overlaps.
export function sliceRectsPx(w, h, layout) {
  const snap = (v) => Math.round(v / TILE_SIZE) * TILE_SIZE;
  // Outer edges stay exact (0 and w/h) so the slices always cover the whole
  // surface; only interior boundaries snap to a tile line. In real use w/h are
  // tile multiples (zoom.js), so every resulting slice is tile-aligned.
  const colAt = (c) => (c === 0 ? 0 : c === layout.cols ? w : snap((c * w) / layout.cols));
  const rowAt = (r) => (r === 0 ? 0 : r === layout.rows ? h : snap((r * h) / layout.rows));
  return layout.cells.map((cell) => {
    const x0 = colAt(cell.col);
    const x1 = colAt(cell.col + 1);
    const y0 = rowAt(cell.row);
    const y1 = rowAt(cell.row + 1);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
}

// Cached slice geometry: [{ rectPx, cssRect, playerIndex }]. rectPx is in
// canvas backing pixels (for the renderer); cssRect is in CSS px relative to
// the viewport (for anchoring DOM HUD elements per slice).
let slices = [{ rectPx: null, cssRect: null, playerIndex: 0 }];

export function getSlices() {
  return slices;
}

// Rebuild state.cameras + the cached geometry to match the current layout.
// Called after every auto-zoom apply (resize / orientation / role switch) and
// whenever the local player count changes. Keeps state.cameras[0] === state.camera
// so every single-camera consumer (PvP, online, map editor) is untouched.
export function recomputeSlices(canvas, state) {
  if (!state || !canvas) return;
  const count = sliceCount();
  const bw = canvas.width;
  const bh = canvas.height;
  const layout = computeLayout(count, bw, bh);
  const rects = sliceRectsPx(bw, bh, layout);

  if (!Array.isArray(state.cameras)) state.cameras = [state.camera];
  state.cameras[0] = state.camera; // preserve the alias
  while (state.cameras.length < count) state.cameras.push(createCamera());
  if (state.cameras.length > count) state.cameras.length = count;

  const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
  slices = rects.map((r, i) => {
    const cam = state.cameras[i];
    cam.w = Math.max(1, Math.floor(r.w / TILE_SIZE));
    cam.h = Math.max(1, Math.floor(r.h / TILE_SIZE));
    return { rectPx: r, cssRect: cssRectFor(box, bw, bh, r), playerIndex: i };
  });
}

// Map a backing-pixel slice rect to a CSS-pixel rect within the viewport,
// using the canvas's on-screen box. The canvas is sized a hair larger than
// the viewport (zoom.js) and clipped by body overflow, so box.left/top can be
// slightly negative — that's fine for anchoring.
function cssRectFor(box, bw, bh, r) {
  if (!box || !bw || !bh) return null;
  const sx = box.width / bw;
  const sy = box.height / bh;
  return {
    left: box.left + r.x * sx,
    top: box.top + r.y * sy,
    width: r.w * sx,
    height: r.h * sy,
  };
}
