// Picks the right biome sprite for a tile based on its 4 neighbors.
// Port of game_core/src/maps/biome_tiles.rs (texture_index_for_neighbors).
//
// The biome sprite sheet is laid out as cols × rows of 16x16 tiles where:
//   * column 0   = "filled" base tile (just the biome, no border)
//   * column 1.. = base tile overlaid with a directional border belonging
//                  to a neighboring biome
//
// Column formula for an overlapping tile:
//   col = neighborBiomeIndex * NUM_COMBOS + comboIndex + 1
// Row formula:
//   row = selfBiomeIndex + animationFrame * NUM_BIOMES

import { BIOME, NUM_BIOMES, isLiquid, isLightGrass, isDarkGrass, biomeIsSame } from "./biomes.js";

export const NUM_COMBOS = 15;
export const NUM_BIOME_FRAMES = 4;

// Direction ids — bit values so 'directions present' is a small bitmask.
const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;

// Combo index from a bitmask of direction sides where the neighbor touches.
// Mirrors the order of `combinations` in scripts/export_biome_tiles.py.
const MASK_TO_COMBO = {
  [UP]: 0,
  [RIGHT]: 1,
  [DOWN]: 2,
  [LEFT]: 3,
  [UP | LEFT]: 4,
  [UP | RIGHT]: 5,
  [RIGHT | DOWN]: 6,
  [DOWN | LEFT]: 7,
  [UP | RIGHT | DOWN]: 8,
  [RIGHT | DOWN | LEFT]: 9,
  [UP | DOWN | LEFT]: 10,
  [UP | RIGHT | LEFT]: 11,
  [UP | RIGHT | DOWN | LEFT]: 12,
  [UP | DOWN]: 13,
  [RIGHT | LEFT]: 14,
};

// Pairs (self, neighbor) that draw as "filled" (no overlap border).
// Order matches the explicit table in biome_tiles.rs.
const FILLED_PAIRS = new Set([
  pair(BIOME.WATER, BIOME.DESERT),
  pair(BIOME.WATER, BIOME.ROCK),
  pair(BIOME.DARK_WATER, BIOME.DARK_SAND),
  pair(BIOME.DARK_WATER, BIOME.DESERT),
  pair(BIOME.LAVA, BIOME.DARK_SAND),
  pair(BIOME.LAVA, BIOME.DESERT),
  pair(BIOME.ROCK, BIOME.SNOW),
  pair(BIOME.WATER, BIOME.DARK_ROCK),
  pair(BIOME.DARK_WATER, BIOME.DARK_ROCK),
  pair(BIOME.LAVA, BIOME.DARK_ROCK),
  pair(BIOME.DARK_SAND, BIOME.SNOW),
  pair(BIOME.DESERT, BIOME.SNOW),
  pair(BIOME.DESERT, BIOME.DARK_SAND),
  pair(BIOME.ROCK, BIOME.DESERT),
  pair(BIOME.ROCK, BIOME.DARK_SAND),
  pair(BIOME.DARK_ROCK, BIOME.SNOW),
  pair(BIOME.DARK_ROCK, BIOME.DESERT),
  pair(BIOME.DARK_ROCK, BIOME.DARK_SAND),
]);

function pair(a, b) { return a * 100 + b; }

// Returns the column index in the composed biome sheet for a tile.
// up/right/down/left are the neighbor biome ids (use BIOME.NOTHING off-edge).
export function biomeTextureCol(self, up, right, down, left) {
  const nb = bestNeighbor(self, up, right, down, left);
  if (!nb) return 0;
  const { neighbor, mask } = nb;
  const combo = MASK_TO_COMBO[mask] ?? 0;
  const overlap = neighbor * NUM_COMBOS + combo + 1;
  const FILLED = 0;

  if (isLiquid(self)) return FILLED;
  if (isLiquid(neighbor)) return overlap;
  if (isLightGrass(self)) return FILLED;
  if (isLightGrass(neighbor)) return overlap;
  if (isDarkGrass(self) && !isLightGrass(neighbor)) return FILLED;

  if (FILLED_PAIRS.has(pair(self, neighbor))) return FILLED;
  if (neighbor === BIOME.NOTHING) return FILLED;
  return overlap;
}

// Picks the neighbor biome that should drive the border, returning the
// biome id and the bitmask of sides where it appears. Returns null when
// no neighbor differs from `self`.
function bestNeighbor(self, up, right, down, left) {
  const sides = [
    { dir: UP,    type: up },
    { dir: RIGHT, type: right },
    { dir: DOWN,  type: down },
    { dir: LEFT,  type: left },
  ];

  // Threshold sweep, mirrors the for-loop in biome_tiles.rs::best_neighbor.
  for (let i = 1; i <= 3; i++) {
    const minCount = 3 - i;
    for (const { type: candidate } of sides) {
      if (biomeIsSame(candidate, self)) continue;
      const mask = contactMask(candidate, sides);
      const count = popcount(mask);
      if (count >= minCount && count > 0) {
        return { neighbor: candidate, mask };
      }
    }
  }
  return null;
}

function contactMask(biome, sides) {
  let m = 0;
  for (const s of sides) if (s.type === biome) m |= s.dir;
  return m;
}

function popcount(n) {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}
