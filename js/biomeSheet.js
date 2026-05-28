// Composes the runtime biome sprite sheet from the four raw frames.
// The raw sheets ship as 5×17 tile grids (one column for the base tile +
// four rotation-source columns for the directional borders); the composed
// sheet has 256×(17·4) tiles ready for direct blitting.
//
// Layout (in tile units):
//   composed.width  = NUM_BIOMES * NUM_COMBOS + 1   (= 256)
//   composed.height = NUM_BIOMES * NUM_FRAMES      (= 68)
//   column 0          = base "filled" tile (no overlay)
//   column n·15+i+1   = base biome composited with overlay from neighbor n,
//                       combo i (see biomeTiles.js for combo ids).

import { TILE_SIZE } from "./constants.js?v=20260528";
import { NUM_BIOMES } from "./biomes.js?v=20260528";
import { NUM_COMBOS, NUM_BIOME_FRAMES } from "./biomeTiles.js?v=20260528";
import { getSprite } from "./assets.js?v=20260528";

// combo idx → [sourceColumn, [rotationDegrees, ...]].
// Rotations are applied around the cell centre; multiple rotations are
// composited together to make 2-axis combos.
const COMBO_SOURCE = [
  [4, [-90]],    // 0 = up
  [4, [180]],   // 1 = right
  [4, [90]],   // 2 = down
  [4, [0]],     // 3 = left
  [3, [0]],     // 4 = up + left
  [3, [-90]],    // 5 = up + right
  [3, [180]],   // 6 = right + down
  [3, [90]],   // 7 = down + left
  [2, [180]],   // 8 = up + right + down
  [2, [90]],   // 9 = right + down + left
  [2, [0]],     // 10 = up + down + left
  [2, [-90]],    // 11 = up + right + left
  [1, [0]],     // 12 = all four
  [4, [-90, 90]],   // 13 = up + down
  [4, [180, 0]],  // 14 = right + left
];

let composed = null;

const CACHE_KEY = "sneakbit.biomeSheet.v2";

export async function composeBiomeSheet() {
  if (composed) return composed;

  const fromCache = await tryReadCache();
  if (fromCache) {
    composed = fromCache;
    return composed;
  }

  const rawSheets = [
    getSprite("tilesBiome1"),
    getSprite("tilesBiome2"),
    getSprite("tilesBiome3"),
    getSprite("tilesBiome4"),
  ];

  const cols = NUM_BIOMES * NUM_COMBOS + 1;
  const rows = NUM_BIOMES * NUM_BIOME_FRAMES;
  const canvas = document.createElement("canvas");
  canvas.width = cols * TILE_SIZE;
  canvas.height = rows * TILE_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  for (let f = 0; f < NUM_BIOME_FRAMES; f++) {
    const src = rawSheets[f];
    for (let b = 0; b < NUM_BIOMES; b++) {
      const dstRow = b + f * NUM_BIOMES;
      // Column 0 = pure base biome tile.
      blitCell(ctx, src, 0, b, 0, dstRow);

      // Columns 1+ = base composited with neighbor border layer.
      for (let n = 0; n < NUM_BIOMES; n++) {
        for (let i = 0; i < NUM_COMBOS; i++) {
          const dstCol = n * NUM_COMBOS + i + 1;
          blitCell(ctx, src, 0, b, dstCol, dstRow);
          const [srcCol, rotations] = COMBO_SOURCE[i];
          for (const deg of rotations) {
            blitRotatedCell(ctx, src, srcCol, n, dstCol, dstRow, deg);
          }
        }
      }
    }
  }

  composed = canvas;
  writeCache(canvas);
  return composed;
}

function writeCache(canvas) {
  try {
    const dataUrl = canvas.toDataURL("image/png");
    localStorage.setItem(CACHE_KEY, dataUrl);
  } catch {
    // Quota or canvas tainted — silently skip.
  }
}

function tryReadCache() {
  return new Promise((resolve) => {
    let raw;
    try { raw = localStorage.getItem(CACHE_KEY); } catch { return resolve(null); }
    if (!raw) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => {
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      resolve(null);
    };
    img.src = raw;
  });
}

function blitCell(ctx, src, srcCol, srcRow, dstCol, dstRow) {
  ctx.drawImage(
    src,
    srcCol * TILE_SIZE, srcRow * TILE_SIZE, TILE_SIZE, TILE_SIZE,
    dstCol * TILE_SIZE, dstRow * TILE_SIZE, TILE_SIZE, TILE_SIZE,
  );
}

function blitRotatedCell(ctx, src, srcCol, srcRow, dstCol, dstRow, deg) {
  const dx = dstCol * TILE_SIZE;
  const dy = dstRow * TILE_SIZE;
  ctx.save();
  ctx.translate(dx + TILE_SIZE / 2, dy + TILE_SIZE / 2);
  // The COMBO_SOURCE angles mirror the original Python export script
  // (scripts/export_biome_tiles.py), which uses PIL Image.rotate — that's
  // counter-clockwise for positive angles. Canvas2D rotate is clockwise,
  // so we negate to match.
  ctx.rotate((-deg * Math.PI) / 180);
  ctx.drawImage(
    src,
    srcCol * TILE_SIZE, srcRow * TILE_SIZE, TILE_SIZE, TILE_SIZE,
    -TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE,
  );
  ctx.restore();
}

export function getBiomeSheet() {
  if (!composed) throw new Error("composeBiomeSheet() not called yet");
  return composed;
}
