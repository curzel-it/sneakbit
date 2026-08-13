// Pre-rendered tile chunks. The biome and construction layers are static
// apart from the biome's BIOME_NUMBER_OF_FRAMES animation cycle (which swaps
// once per ~1.3s), so re-blitting the tile grid every frame is wasted work:
// we bake tiles into offscreen canvases once and then blit whole rectangles.
//
// Baking is per CHUNK_TILES-square chunk, not per zone. A whole-zone bake
// sized the canvases to the *map* when they only ever need to cover the
// *screen* — the big outdoor zones run 100×80 to 160×120 tiles, i.e. 39-94 MB
// of backing store (4 animation frames plus construction at 16 px/tile) to
// sample a phone-sized window out of. iOS keeps canvas backing in the GPU
// process and demotes or purges surfaces that large, after which every frame
// re-uploads instead of sampling. Chunking makes the resident set scale with
// the viewport rather than the map, and the LRU caps it outright.
//
// Construction is baked into each frame instead of living as its own layer:
// the two always drew back to back with nothing between them, nothing mutates
// zone.construction at runtime (only the map editor, which rebuilds the zone
// object outright), and merging halves the per-chunk blit count.

import { TILE_SIZE, BIOME_NUMBER_OF_FRAMES } from "./constants.js";
import { getSprite } from "./assets.js";
import { getBiomeSheet } from "./biomeSheet.js";
import { NUM_BIOMES } from "./biomes.js";
import { CONSTRUCTION } from "./constructions.js";

// 8 tiles → 128×128 px canvases, ~262 KB per chunk across all four frames.
// Small enough that scrolling into a new row of chunks is a few hundred tile
// blits rather than a visible hitch, large enough that a phone viewport is
// ~15 draw calls instead of hundreds.
export const CHUNK_TILES = 8;
const CHUNK_PX = CHUNK_TILES * TILE_SIZE;

// A phone viewport spans ~15 chunks and a 4-way split ~24, so this leaves
// generous headroom while capping the resident set near 17 MB — against 94 MB
// for a single whole-zone bake of the largest map.
const MAX_CHUNKS = 64;

// Insertion order doubles as LRU: re-inserting on read moves an entry to the
// back, so the first key is always the least recently used.
const chunks = new Map(); // "<zoneKey>:<cx>:<cy>" -> { frames: [canvas] }

// Zones are keyed by identity, not id: the map editor and the guest's mirror
// world both rebuild a zone object for the same id and must not inherit the
// previous object's bakes.
const zoneKeys = new WeakMap();
let nextZoneKey = 1;

// The inclusive chunk index range covering a camera rect, clamped to the map.
// Lives here rather than in the renderer because it's chunk geometry, and it's
// exported so it can be tested directly: an off-by-one here shows up as a
// missing column or row of tiles along the screen edge, which is exactly the
// failure zoom.js's ceil() comment describes for the canvas itself.
export function chunkRangeFor(zone, camera) {
  const lastCx = Math.floor((zone.cols - 1) / CHUNK_TILES);
  const lastCy = Math.floor((zone.rows - 1) / CHUNK_TILES);
  return {
    cx0: Math.max(0, Math.floor(camera.x / CHUNK_TILES)),
    cy0: Math.max(0, Math.floor(camera.y / CHUNK_TILES)),
    cx1: Math.min(lastCx, Math.floor((camera.x + camera.w) / CHUNK_TILES)),
    cy1: Math.min(lastCy, Math.floor((camera.y + camera.h) / CHUNK_TILES)),
  };
}

// The chunk covering tiles [cx·CHUNK_TILES, +CHUNK_TILES) × [cy·…, +…),
// baking it on first use. Null when the chunk is out of bounds or the sprite
// sheets aren't loaded yet — callers skip it and pick it up a frame later.
export function getZoneChunk(zone, cx, cy) {
  if (!zone) return null;
  if (cx < 0 || cy < 0) return null;
  if (cx * CHUNK_TILES >= zone.cols || cy * CHUNK_TILES >= zone.rows) return null;

  const key = `${zoneKey(zone)}:${cx}:${cy}`;
  const hit = chunks.get(key);
  if (hit) {
    chunks.delete(key);
    chunks.set(key, hit); // touch
    return hit;
  }

  const baked = bake(zone, cx, cy);
  if (!baked) return null;
  chunks.set(key, baked);
  while (chunks.size > MAX_CHUNKS) {
    chunks.delete(chunks.keys().next().value);
  }
  return baked;
}

// Explicit eviction. The LRU bounds the cache on its own, but a guest
// following a host through several zones would otherwise keep the outgoing
// zone's chunks resident until enough new ones pushed them out.
// mirrorWorld.js calls this on the outgoing zone before swapping.
export function evictZoneCache(zone) {
  if (!zone) return;
  const k = zoneKeys.get(zone);
  if (!k) return;
  const prefix = `${k}:`;
  for (const key of chunks.keys()) {
    if (key.startsWith(prefix)) chunks.delete(key);
  }
}

function zoneKey(zone) {
  let k = zoneKeys.get(zone);
  if (!k) { k = nextZoneKey++; zoneKeys.set(zone, k); }
  return k;
}

function bake(zone, cx, cy) {
  let biomeSheet, constructionSheet;
  try {
    biomeSheet = getBiomeSheet();
    constructionSheet = getSprite("tilesConstructions");
  } catch {
    return null;
  }
  if (!biomeSheet || !constructionSheet) return null;

  const frames = [];
  for (let frame = 0; frame < BIOME_NUMBER_OF_FRAMES; frame++) {
    frames.push(bakeFrame(zone, biomeSheet, constructionSheet, cx, cy, frame));
  }
  return { frames };
}

function bakeFrame(zone, biomeSheet, constructionSheet, cx, cy, frame) {
  const cv = document.createElement("canvas");
  cv.width = CHUNK_PX;
  cv.height = CHUNK_PX;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const x0 = cx * CHUNK_TILES;
  const y0 = cy * CHUNK_TILES;
  // Edge chunks hang off the map; the overhang stays transparent.
  const lastRow = Math.min(zone.rows, y0 + CHUNK_TILES);
  const lastCol = Math.min(zone.cols, x0 + CHUNK_TILES);
  const rowOffset = frame * NUM_BIOMES;

  for (let r = y0; r < lastRow; r++) {
    const biomeRow = zone.biome[r];
    const biomeColRow = zone.biomeCol[r];
    const conRow = zone.construction[r];
    const conRowIdx = zone.constructionRow[r];
    const dy = (r - y0) * TILE_SIZE;
    for (let c = x0; c < lastCol; c++) {
      const dx = (c - x0) * TILE_SIZE;
      ctx.drawImage(biomeSheet,
        biomeColRow[c] * TILE_SIZE, (biomeRow[c] + rowOffset) * TILE_SIZE,
        TILE_SIZE, TILE_SIZE, dx, dy, TILE_SIZE, TILE_SIZE);
      const id = conRow[c];
      if (id === CONSTRUCTION.NOTHING) continue;
      ctx.drawImage(constructionSheet,
        id * TILE_SIZE, conRowIdx[c] * TILE_SIZE,
        TILE_SIZE, TILE_SIZE, dx, dy, TILE_SIZE, TILE_SIZE);
    }
  }
  return cv;
}
