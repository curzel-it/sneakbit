// Tower Defense build cursor + ghost: during the build phase the directional
// input drives a free-roaming placement marker (decoupled from the hero), and
// this draws a translucent ghost of the selected barrel under it — green
// border when the tile is a legal, affordable spot, red when it isn't. If a
// barrel already sits there it draws a red "remove" outline instead.
//
// The cursor is the build-phase camera target and the tile place/remove (E/G)
// act on; towerDefense routes the human input here while building and back to
// the active hero once a wave starts. Pure state + rendering: it owns no
// placement logic (that's tdBuild's placeSelected / eraseAt).

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { isLegalBuildTile, getSelectedBuildSprite } from "./tdBuild.js";
import { tdObstacleAt } from "./tdObstacles.js";
import { canAfford } from "./arcadeCurrency.js";

const DIR_DELTA = {
  up:    [0, -1],
  down:  [0,  1],
  left:  [-1, 0],
  right: [ 1,  0],
};
const HOLD_PRIORITY = ["up", "down", "left", "right"];

// Menu-style auto-repeat: a fresh press steps once, then holding repeats after
// a short delay at a steady rate (tiles/press feel without a key per tile).
const INITIAL_DELAY = 0.22;   // seconds held before auto-repeat kicks in
const REPEAT_INTERVAL = 0.07; // seconds between repeats while held

const BORDER_OK = "#8fe6a0";  // legal + affordable (matches HUD positive)
const BORDER_NO = "#ff3b3b";  // illegal / unaffordable / remove highlight

// The ghost slides toward the logical tile instead of teleporting. Exponential
// smoothing: a fresh step covers most of the gap fast, then settles — and it
// retargets cleanly when the cursor steps again mid-glide (auto-repeat holds).
const SNAP_RATE = 22;      // higher = snappier; ~most of a tile in one repeat
const SNAP_EPSILON = 0.01; // within this of the target, jump the rest (no drift)

let cursor = { x: 0, y: 0 };  // logical tile (what place/remove acts on)
let visual = { x: 0, y: 0 };  // eased draw position (floats, tracks `cursor`)
let repeatDir = null;
let repeatTimer = 0;

// Drop the cursor onto a starting tile (the active hero's, when a build phase
// opens) and disarm any in-flight repeat. The ghost starts settled, not gliding
// in from wherever it last sat.
export function resetBuildCursor(tile) {
  cursor = { x: tile?.x | 0, y: tile?.y | 0 };
  visual = { x: cursor.x, y: cursor.y };
  repeatDir = null;
  repeatTimer = 0;
}

export function getBuildCursor() {
  return { x: cursor.x, y: cursor.y };
}

// Advance the cursor from this frame's input. Fresh presses step immediately;
// a held direction auto-repeats. Clamped to the zone bounds (it may sit over
// walls — the ghost just turns red there).
export function moveBuildCursor(input, dt, zone) {
  let stepped = null;
  for (const dir of input.events) {
    stepCursor(dir, zone);
    stepped = dir;
  }
  if (stepped) {
    repeatDir = stepped;
    repeatTimer = INITIAL_DELAY;
  } else if (repeatDir && input.held.has(repeatDir)) {
    repeatTimer -= dt;
    if (repeatTimer <= 0) {
      stepCursor(repeatDir, zone);
      repeatTimer = REPEAT_INTERVAL;
    }
  } else {
    // The repeat direction was released — pick up another still-held one.
    const held = HOLD_PRIORITY.find((d) => input.held.has(d));
    if (held) { repeatDir = held; repeatTimer = INITIAL_DELAY; }
    else repeatDir = null;
  }
  easeVisual(dt);
}

// Slide the draw position toward the logical tile. Frame-rate independent: the
// fraction closed scales with dt, and we snap the last sliver so the ghost
// settles exactly on the grid rather than creeping forever.
function easeVisual(dt) {
  const k = 1 - Math.exp(-SNAP_RATE * dt);
  visual.x += (cursor.x - visual.x) * k;
  visual.y += (cursor.y - visual.y) * k;
  if (Math.abs(visual.x - cursor.x) < SNAP_EPSILON) visual.x = cursor.x;
  if (Math.abs(visual.y - cursor.y) < SNAP_EPSILON) visual.y = cursor.y;
}

function stepCursor(dir, zone) {
  const [dx, dy] = DIR_DELTA[dir] ?? [0, 0];
  const nx = cursor.x + dx;
  const ny = cursor.y + dy;
  if (zone && (nx < 0 || ny < 0 || nx >= zone.cols || ny >= zone.rows)) return;
  cursor.x = nx;
  cursor.y = ny;
}

// Draw the build ghost at the cursor. `ctx` is the full-canvas context after
// render() (identity transform, no clip); coords are camera-relative.
export function drawPlacementPreview(ctx, state, camera) {
  if (!state?.zone) return;
  const t = cursor;        // logical tile: drives every legality check
  const v = visual;        // eased position: drives where the ghost is drawn

  // A barrel already occupies the cursor tile → show the remove highlight.
  if (tdObstacleAt(state.zone, t.x, t.y)) {
    strokeTile(ctx, camera, v.x, v.y, 1, 1, BORDER_NO);
    return;
  }

  const sprite = getSelectedBuildSprite();
  if (!sprite) return;
  const { w, h } = sprite;
  // Feet-anchored like the placed entity: sprite extends upward from the tile.
  const topY = v.y - (h - 1);
  const px = Math.round((v.x - camera.x) * TILE_SIZE);
  const py = Math.round((topY - camera.y) * TILE_SIZE);
  const pw = w * TILE_SIZE;
  const ph = h * TILE_SIZE;

  let sheet;
  try { sheet = getSprite(sprite.sheet); } catch { sheet = null; }
  if (sheet) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(sheet, sprite.sx, sprite.sy, sprite.sw, sprite.sh, px, py, pw, ph);
    ctx.restore();
  }

  const ok = isLegalBuildTile(state, t.x, t.y) && canAfford(sprite.cost);
  strokeTile(ctx, camera, v.x, v.y, 1, 1, ok ? BORDER_OK : BORDER_NO);
}

// 2px border around a (w×h) tile footprint, inset half a pixel so it reads
// crisply on the pixel grid.
function strokeTile(ctx, camera, x, y, w, h, color) {
  const px = Math.round((x - camera.x) * TILE_SIZE);
  const py = Math.round((y - camera.y) * TILE_SIZE);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.strokeRect(px + 1, py + 1, w * TILE_SIZE - 2, h * TILE_SIZE - 2);
  ctx.restore();
}
