// Shared painter for inventory-sheet icons. A single 16px source tile is
// drawn into a backing canvas at an integer supersample (×8) and the browser
// downscales it to the on-screen size — this keeps round/pixel sprites crisp
// at icon sizes that aren't an integer multiple of the source tile. Used by
// the HUD chips (ammoHud/coinHud) and the inventory screen.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";

const ICON_SUPERSAMPLE = 8;
export const ICON_RES = TILE_SIZE * ICON_SUPERSAMPLE;

// Paint the [row, col] tile of a sprite sheet (default the inventory sheet,
// but e.g. "armor" for armour icons) into `canvas` (which must be ICON_RES
// square). Returns false and leaves the canvas untouched when the sheet isn't
// loaded yet, so callers can retry on a later frame.
export function paintInventoryIcon(canvas, row, col, sheetName = "inventory") {
  let sheet;
  try { sheet = getSprite(sheetName); } catch { return false; }
  if (!sheet || !sheet.complete) return false;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false; // crisp integer upscale into the backing canvas
  ctx.clearRect(0, 0, ICON_RES, ICON_RES);
  ctx.drawImage(
    sheet,
    col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE,
    0, 0, ICON_RES, ICON_RES,
  );
  canvas.dataset.painted = "1";
  return true;
}
