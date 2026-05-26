// Per-zone pre-rendered canvases. The biome and construction layers
// are mostly static (construction never changes; biome cycles through
// BIOME_NUMBER_OF_FRAMES animation strips that swap once per ~1.3s).
// Re-blitting the whole tile grid every frame is the main render cost
// on phones, so we bake each zone's tiles into offscreen canvases the
// first time we draw it and then blit one big rect per layer per frame.
//
// Cache lives in a WeakMap keyed on the zone object, so unloaded
// zones (via teleport) drop their canvases when GC'd.

import { TILE_SIZE, BIOME_NUMBER_OF_FRAMES } from "./constants.js";
import { getSprite } from "./assets.js";
import { getBiomeSheet } from "./biomeSheet.js";
import { NUM_BIOMES } from "./biomes.js";
import { CONSTRUCTION } from "./constructions.js";

const cache = new WeakMap();

export function getZoneCache(zone) {
  let entry = cache.get(zone);
  if (!entry) {
    entry = build(zone);
    if (entry) cache.set(zone, entry);
  }
  return entry;
}

function build(zone) {
  let biomeSheet, constructionSheet;
  try {
    biomeSheet = getBiomeSheet();
    constructionSheet = getSprite("tilesConstructions");
  } catch {
    return null;
  }
  if (!biomeSheet || !constructionSheet) return null;

  const w = zone.cols * TILE_SIZE;
  const h = zone.rows * TILE_SIZE;

  const biomeFrames = [];
  for (let frame = 0; frame < BIOME_NUMBER_OF_FRAMES; frame++) {
    biomeFrames.push(bakeBiome(zone, biomeSheet, frame, w, h));
  }
  const construction = bakeConstruction(zone, constructionSheet, w, h);

  return { biomeFrames, construction, width: w, height: h };
}

function bakeBiome(zone, sheet, frame, w, h) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const rowOffset = frame * NUM_BIOMES;
  for (let r = 0; r < zone.rows; r++) {
    const biomeRow = zone.biome[r];
    const colRow = zone.biomeCol[r];
    for (let c = 0; c < zone.cols; c++) {
      const b = biomeRow[c];
      const sheetCol = colRow[c];
      const sx = sheetCol * TILE_SIZE;
      const sy = (b + rowOffset) * TILE_SIZE;
      ctx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE,
        c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  return cv;
}

function bakeConstruction(zone, sheet, w, h) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < zone.rows; r++) {
    const conRow = zone.construction[r];
    const rowIdx = zone.constructionRow[r];
    for (let c = 0; c < zone.cols; c++) {
      const id = conRow[c];
      if (id === CONSTRUCTION.NOTHING) continue;
      const sx = id * TILE_SIZE;
      const sy = rowIdx[c] * TILE_SIZE;
      ctx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE,
        c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  return cv;
}
