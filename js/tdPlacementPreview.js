// Tower Defense build ghost: the in-world preview of where the active hero
// will place (or remove) a barrel during the build phase. The player moves the
// possessed hero around and this draws a translucent ghost of the selected
// barrel on the tile the hero faces — green border when the tile is a legal,
// affordable spot, red when it isn't. If a barrel already sits on that tile,
// it draws a red "remove" outline instead (G refunds it).
//
// Pure rendering: towerDefense.onKey owns the actual place/erase (E / G) via
// tdBuild's placeSelected / eraseAt, both keyed off this same front tile.
// Drawn after the world render, camera-relative like every other drawer.

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

const BORDER_OK = "#8fe6a0";   // legal + affordable (matches HUD positive)
const BORDER_NO = "#ff3b3b";   // illegal / unaffordable / remove highlight

// The tile the hero faces, from its canonical tile (stable mid-step) plus the
// facing direction. This is the tile place/erase act on.
export function tileInFront(hero) {
  const [dx, dy] = DIR_DELTA[hero.direction] ?? DIR_DELTA.down;
  return { x: hero.tileX + dx, y: hero.tileY + dy };
}

// Draw the build ghost for the active hero. `ctx` is the full-canvas context
// after render() (identity transform, no clip); coords are camera-relative.
export function drawPlacementPreview(ctx, state, camera, hero) {
  if (!hero || !state?.zone) return;
  const t = tileInFront(hero);

  // A barrel already occupies the faced tile → show the remove highlight.
  if (tdObstacleAt(state.zone, t.x, t.y)) {
    strokeTile(ctx, camera, t.x, t.y, 1, 1, BORDER_NO);
    return;
  }

  const sprite = getSelectedBuildSprite();
  if (!sprite) return;
  const { w, h } = sprite;
  // Feet-anchored like the placed entity: sprite extends upward from the tile.
  const topY = t.y - (h - 1);
  const px = Math.round((t.x - camera.x) * TILE_SIZE);
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
  strokeTile(ctx, camera, t.x, t.y, 1, 1, ok ? BORDER_OK : BORDER_NO);
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
