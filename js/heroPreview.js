// Shared painter for a hero "portrait" thumbnail — the down-still frame of a
// given `heroes`-sheet column, two tiles tall (head + body, so outfit colours
// read). Used by the inventory Skin slot to preview owned skins. Mirrors
// inventoryIcon.js: integer-crisp blit, returns false until the sheet loads so
// callers can retry on a later frame.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";

// The down-still hero frame sits at row y=11 on the heroes sheet (mirrors
// player.js getPlayerSpriteFrame: down/still, origin y=1 → y=11), 2 tiles tall.
const PREVIEW_ROW = 11;
export const PREVIEW_W = TILE_SIZE;
export const PREVIEW_H = TILE_SIZE * 2;

export function paintHeroPreview(canvas, column) {
  let sheet;
  try { sheet = getSprite("heroes"); } catch { return false; }
  if (!sheet || !sheet.complete) return false;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.drawImage(
    sheet,
    (column | 0) * TILE_SIZE, PREVIEW_ROW * TILE_SIZE, TILE_SIZE, TILE_SIZE * 2,
    0, 0, PREVIEW_W, PREVIEW_H,
  );
  canvas.dataset.painted = "1";
  return true;
}
