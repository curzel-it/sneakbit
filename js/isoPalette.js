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

// A solid barrier with a slightly-inset top course, so walls read as masonry
// with a capstone instead of a flat monolith. cap defaults to a lighter body.
const wall = (color, h = 1.4, cap = lighten(color)) => ({
  parts: [
    { inset: 0, z0: 0, z1: h - 0.16, color },
    { inset: 0.05, z0: h - 0.16, z1: h, color: cap },
  ],
});

const crate = (color, h = 0.7) => ({ parts: [{ inset: 0.12, z0: 0, z1: h, color, top: lighten(color) }] });

// Symmetric post-and-rail cross: a centre post plus rails spanning both axes,
// so it connects visually to any neighbour without needing the connectivity row.
const fence = (color, h = 0.55, postH = 0.72, rail = lighten(color)) => ({
  parts: [
    { hx: 0.09, hy: 0.09, z0: 0, z1: postH, color },
    { hx: 0.5, hy: 0.06, z0: h - 0.14, z1: h, color: rail },
    { hx: 0.06, hy: 0.5, z0: h - 0.14, z1: h, color: rail },
  ],
});

// A few offset clumps of one height range — used for foliage tufts and stalks.
const clumps = (specs, color, top) =>
  ({ parts: specs.map(([dx, dy, hx, z1]) => ({ dx, dy, hx, hy: hx, z0: 0, z1, color, top })) });

const C = CONSTRUCTION;
const SPEC = {
  [C.FOREST]: trees("#2f7d38"),
  [C.SNOWY_FOREST]: trees("#cfe0e6", 2.2, 0.8),
  [C.BROADLEAF]: trees("#3f9a3f", 2.4),
  [C.BROADLEAF_PURPLE]: trees("#8a5bbf", 2.4),
  [C.SPOILED_TREE]: trees("#6b6350", 2.0),
  [C.WINE_TREE]: trees("#7a2f4a", 1.8),
  // Bamboo: a little grove of thin stalks at varied height, not one fat post.
  [C.BAMBOO]: clumps(
    [[-0.18, -0.1, 0.07, 2.4], [0.16, 0.12, 0.07, 2.8], [0.04, -0.2, 0.06, 2.1]],
    "#6f9c3a", "#8fb85a",
  ),
  // Tall grass: three short tufts of foliage.
  [C.TALL_GRASS]: clumps(
    [[-0.18, -0.12, 0.11, 0.42], [0.16, 0.14, 0.12, 0.5], [0.14, -0.16, 0.09, 0.34]],
    "#5aa84e", "#79c76a",
  ),

  [C.LIGHT_WALL]: wall("#b9bcc4", 1.4),
  [C.STONE_WALL]: wall("#7c828c", 1.4),
  [C.WOODEN_WALL]: wall("#8a6238", 1.4),
  // Dark rock: an irregular boulder — broad base with a smaller crown.
  [C.DARK_ROCK]: { parts: [
    { inset: 0.02, z0: 0, z1: 0.9, color: "#4f555f" },
    { inset: 0.22, z0: 0.9, z1: 1.25, color: "#4f555f", top: lighten("#4f555f") },
  ] },
  [C.STONE_BOX]: crate("#9aa0aa"),
  [C.BOX]: crate("#b98a4e"),
  // Counter: a low body with a lighter overhanging top slab.
  [C.COUNTER]: { parts: [
    { inset: 0.08, z0: 0, z1: 0.72, color: "#7a5a38" },
    { inset: 0.02, z0: 0.72, z1: 0.86, color: "#a2764a" },
  ] },
  // Library: a two-tier shelf block — wooden frame under a band of book spines.
  [C.LIBRARY]: { parts: [
    { inset: 0.05, z0: 0, z1: 0.85, color: "#6b4a2b" },
    { inset: 0.09, z0: 0.85, z1: 1.6, color: "#8a4a3a", top: lighten("#6b4a2b") },
  ] },
  // Solar panel: two legs under a flat dark-blue slab. (True tilt isn't
  // expressible with axis-aligned boxes; the slab reads as a panel head-on.)
  [C.SOLAR_PANEL]: { parts: [
    { dx: -0.28, hx: 0.05, hy: 0.05, z0: 0, z1: 0.3, color: "#3a4048" },
    { dx: 0.28, hx: 0.05, hy: 0.05, z0: 0, z1: 0.45, color: "#3a4048" },
    { inset: 0.08, z0: 0.34, z1: 0.44, color: "#20304a", top: "#33507a" },
  ] },
  // Pipe: a horizontal run sitting a little off the ground.
  [C.PIPE]: { parts: [{ hx: 0.5, hy: 0.16, z0: 0.12, z1: 0.5, color: "#9099a3", top: lighten("#9099a3") }] },

  [C.WOODEN_FENCE]: fence("#8a6238"),
  [C.METAL_FENCE]: fence("#9aa0aa"),
  [C.RAIL]: fence("#6b7079", 0.28, 0.3),
  // Snow pile: a rounded mound built from shrinking stacked tiers.
  [C.SNOW_PILE]: { parts: [
    { inset: 0.06, z0: 0, z1: 0.3, color: "#e6edf2", top: "#ffffff" },
    { inset: 0.2, z0: 0.3, z1: 0.5, color: "#e6edf2", top: "#ffffff" },
    { inset: 0.34, z0: 0.5, z1: 0.62, color: "#e6edf2", top: "#ffffff" },
  ] },
  // Bridge: a flat plank deck with a low rail down each long edge.
  [C.BRIDGE]: { parts: [
    { inset: 0, z0: 0, z1: 0.14, color: "#8a6238", top: "#a2764a" },
    { dy: -0.46, hx: 0.5, hy: 0.04, z0: 0.14, z1: 0.4, color: "#6b4a2b" },
    { dy: 0.46, hx: 0.5, hy: 0.04, z0: 0.14, z1: 0.4, color: "#6b4a2b" },
  ] },
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
