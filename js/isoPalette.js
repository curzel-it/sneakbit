// Maps sneakbit's flat tile ids to 3D geometry specs for the iso renderer.
// This is the "art direction" of the polygon rebuild: every biome gets a floor
// colour, every construction gets a shape (a stack of boxes, or a slope ramp).
// Kept as plain data so it's easy to tune without touching the renderer.

import { BIOME } from "./biomes.js";
import { CONSTRUCTION } from "./constructions.js";

// Floor colour per biome. null = no floor drawn (void / nothing).
const BIOME_COLOR = {
  [BIOME.WATER]: "#2f6db0",
  [BIOME.DARK_WATER]: "#1c4a7a",
  [BIOME.LAVA]: "#c34618",
  [BIOME.DESERT]: "#d8c27a",
  [BIOME.SAND_PLATES]: "#cbb268",
  [BIOME.DARK_SAND]: "#a8894e",
  // GRASS/DARK_GRASS are dithered tile-by-tile in the maps as a texture; kept
  // close in hue so they read as subtle variation, not a hard checkerboard,
  // once drawn as flat polygons instead of pixel-art dither.
  [BIOME.GRASS]: "#4c9a4a",
  [BIOME.DARK_GRASS]: "#469247",
  [BIOME.ROCK]: "#8a8f98",
  [BIOME.ROCK_PLATES]: "#7b828c",
  [BIOME.DARK_ROCK]: "#565c66",
  [BIOME.SNOW]: "#e6edf2",
  [BIOME.DARK_WOOD]: "#7a5a38",
  [BIOME.NOTHING]: null,
};

export function biomeFloorColor(id) {
  return BIOME_COLOR[id] ?? "#3a3f47";
}

// Liquids read better a touch below the ground plane; return their z offset.
export function biomeFloorZ(id) {
  return (id === BIOME.WATER || id === BIOME.DARK_WATER || id === BIOME.LAVA) ? -0.12 : 0;
}

// --- constructions ---------------------------------------------------------
// A spec is either { parts: [...] } (a stack of boxes) or { ramp: {heights,color} }.
// A part: { inset, z0, z1, color, top? } — inset shrinks the tile footprint
// (0 = full tile), z in tiers. top recolours the +z face (foliage caps etc).

const TRUNK = "#6b4a2b";
const trees = (canopy, h = 2.2, trunkH = 0.8) => ({
  parts: [
    { inset: 0.34, z0: 0, z1: trunkH, color: TRUNK },
    { inset: 0.06, z0: trunkH, z1: h, color: canopy, top: lighten(canopy) },
  ],
});
const solid = (color, h) => ({ parts: [{ inset: 0, z0: 0, z1: h, color }] });
const fence = (color, h = 0.5) => ({ parts: [{ inset: 0.38, z0: 0, z1: h, color }] });
const crate = (color, h = 0.7) => ({ parts: [{ inset: 0.12, z0: 0, z1: h, color, top: lighten(color) }] });

const C = CONSTRUCTION;
const SPEC = {
  [C.FOREST]: trees("#2f7d38"),
  [C.SNOWY_FOREST]: trees("#cfe0e6", 2.2, 0.8),
  [C.BROADLEAF]: trees("#3f9a3f", 2.4),
  [C.BROADLEAF_PURPLE]: trees("#8a5bbf", 2.4),
  [C.SPOILED_TREE]: trees("#6b6350", 2.0),
  [C.WINE_TREE]: trees("#7a2f4a", 1.8),
  [C.BAMBOO]: { parts: [{ inset: 0.34, z0: 0, z1: 2.6, color: "#6f9c3a", top: "#8fb85a" }] },
  [C.TALL_GRASS]: { parts: [{ inset: 0.22, z0: 0, z1: 0.45, color: "#5aa84e", top: "#79c76a" }] },

  [C.LIGHT_WALL]: solid("#b9bcc4", 1.4),
  [C.STONE_WALL]: solid("#7c828c", 1.4),
  [C.WOODEN_WALL]: solid("#8a6238", 1.4),
  [C.DARK_ROCK]: solid("#4f555f", 1.2),
  [C.STONE_BOX]: crate("#9aa0aa"),
  [C.BOX]: crate("#b98a4e"),
  [C.COUNTER]: solid("#7a5a38", 0.9),
  [C.LIBRARY]: solid("#6b4a2b", 1.6),
  [C.SOLAR_PANEL]: { parts: [{ inset: 0.1, z0: 0, z1: 0.35, color: "#20304a", top: "#33507a" }] },
  [C.PIPE]: solid("#9099a3", 0.6),

  [C.WOODEN_FENCE]: fence("#8a6238"),
  [C.METAL_FENCE]: fence("#9aa0aa"),
  [C.RAIL]: fence("#6b7079", 0.3),
  [C.SNOW_PILE]: crate("#e6edf2", 0.5),
  [C.BRIDGE]: { parts: [{ inset: 0, z0: 0, z1: 0.14, color: "#8a6238", top: "#a2764a" }] },
};

// Slope ramps. Corner order is TL,TR,BR,BL (matching FLOOR_QUAD). Each variant
// lifts the corners on its "high" side by one tier, so the tile reads as ground
// ramping up toward a plateau.
const RAMP_COLOR = { GREEN: "#4c9a4a", ROCK: "#8a8f98", SAND: "#d8c27a", DARKROCK: "#565c66" };
const RAMP_HEIGHTS = {
  T: [1, 1, 0, 0], B: [0, 0, 1, 1], L: [1, 0, 0, 1], R: [0, 1, 1, 0],
  TL: [1, 0, 0, 0], TR: [0, 1, 0, 0], BR: [0, 0, 1, 0], BL: [0, 0, 0, 1],
};

(function buildSlopes() {
  for (const [name, id] of Object.entries(C)) {
    const m = /^SLOPE_(GREEN|ROCK|SAND|DARKROCK)_(TL|TR|BR|BL|T|B|L|R)$/.exec(name);
    if (m) SPEC[id] = { ramp: { heights: RAMP_HEIGHTS[m[2]], color: RAMP_COLOR[m[1]] } };
  }
})();

export function constructionSpec(id) {
  return SPEC[id] ?? null;
}

// Darkness overlays and NOTHING draw nothing in the polygon world.
export function isSkippedConstruction(id) {
  return id === C.NOTHING || id === C.INDICATOR_ARROW ||
    id === C.DARKNESS_15 || id === C.DARKNESS_30 || id === C.DARKNESS_45;
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + 28);
  const g = Math.min(255, ((n >> 8) & 255) + 28);
  const b = Math.min(255, (n & 255) + 28);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
