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

// --- mask-aware archetypes -------------------------------------------------
// These key on the same-neighbour mask {u,r,d,l} (from zone.constructionRow via
// rowToMask) so a run, corner, junction or lone tile each build a matching
// silhouette. Each returns a descriptor with make(mask) -> { parts }.

const TRUNK = "#6b4a2b";
// Trees stack in depth: a tile with a same tile "below" (mask.d, i.e. nearer the
// camera in +y) is a BACK cell — its trunk is hidden by the front tile, so it
// grows a taller canopy and the forest slopes up away from the viewer. A tile
// with no same neighbour at all is a lone sapling (shorter, slimmer).
const trees = (canopy, h = 2.2, trunkH = 0.8) => ({
  make: (m) => {
    const lone = !m.u && !m.r && !m.d && !m.l;
    const top = lighten(canopy);
    const th = lone ? h * 0.62 : (m.d ? h + 0.5 : h);
    const tr = lone ? trunkH * 0.7 : trunkH;
    return { parts: [
      { inset: 0.34, z0: 0, z1: tr, color: TRUNK },
      { inset: lone ? 0.14 : 0.06, z0: tr, z1: th, color: canopy, top },
    ] };
  },
});

// A solid barrier built as a central pillar plus a thick arm toward each
// connected neighbour, so straight runs read as a bar, corners as an L, and a
// lone wall as a single pillar. Each course carries an inset capstone.
const wall = (color, h = 1.4, cap = lighten(color)) => ({
  make: (m) => {
    const capH = 0.16, bodyZ1 = h - capH, core = 0.3, arm = 0.28;
    const parts = [
      { hx: core, hy: core, z0: 0, z1: bodyZ1, color },
      { hx: core, hy: core, z0: bodyZ1, z1: h, color: cap },
    ];
    const addArm = (dx, dy, hx, hy) => {
      parts.push({ dx, dy, hx, hy, z0: 0, z1: bodyZ1, color });
      parts.push({ dx, dy, hx, hy, z0: bodyZ1, z1: h, color: cap });
    };
    if (m.r) addArm(0.28, 0, 0.26, arm);
    if (m.l) addArm(-0.28, 0, 0.26, arm);
    if (m.u) addArm(0, -0.28, arm, 0.26);
    if (m.d) addArm(0, 0.28, arm, 0.26);
    return { parts };
  },
});

const crate = (color, h = 0.7) => ({ parts: [{ inset: 0.12, z0: 0, z1: h, color, top: lighten(color) }] });

// A centre post plus a rail toward each connected neighbour only (a lone tile is
// just a post). Rails overshoot the tile centre so they overlap the neighbour's.
const fence = (color, h = 0.55, postH = 0.72, rail = lighten(color)) => ({
  make: (m) => {
    const z0 = h - 0.14, z1 = h;
    const parts = [{ hx: 0.09, hy: 0.09, z0: 0, z1: postH, color }];
    if (m.r) parts.push({ dx: 0.25, hx: 0.26, hy: 0.06, z0, z1, color: rail });
    if (m.l) parts.push({ dx: -0.25, hx: 0.26, hy: 0.06, z0, z1, color: rail });
    if (m.u) parts.push({ dy: -0.25, hx: 0.06, hy: 0.26, z0, z1, color: rail });
    if (m.d) parts.push({ dy: 0.25, hx: 0.06, hy: 0.26, z0, z1, color: rail });
    return { parts };
  },
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
  // Bridge: a flat plank deck; rail only the edges that DON'T connect to another
  // bridge tile, so the deck stays open along the span and railed on its sides.
  [C.BRIDGE]: { make: (m) => {
    const RAIL = "#6b4a2b";
    const parts = [{ inset: 0, z0: 0, z1: 0.14, color: "#8a6238", top: "#a2764a" }];
    if (!m.u) parts.push({ dy: -0.46, hx: 0.5, hy: 0.04, z0: 0.14, z1: 0.4, color: RAIL });
    if (!m.d) parts.push({ dy: 0.46, hx: 0.5, hy: 0.04, z0: 0.14, z1: 0.4, color: RAIL });
    if (!m.r) parts.push({ dx: 0.46, hx: 0.04, hy: 0.5, z0: 0.14, z1: 0.4, color: RAIL });
    if (!m.l) parts.push({ dx: -0.46, hx: 0.04, hy: 0.5, z0: 0.14, z1: 0.4, color: RAIL });
    return { parts };
  } },
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

// Returns a { parts } / { ramp } spec for the construction at this cell. Ids
// whose shape depends on connectivity (trees, walls, fences, bridge) carry a
// make(mask) builder; the rest are static. `mask` is the same-neighbour mask
// {u,r,d,l} from rowToMask(zone.constructionRow[r][c]).
export function constructionSpec(id, mask) {
  const spec = SPEC[id];
  if (!spec) return null;
  if (spec.make) return spec.make(mask ?? EMPTY_MASK);
  return spec;
}

// Trees render as upright sprite billboards in the iso path, not stacked
// trunk+canopy boxes: a dense forest is thousands of faces to sort per frame,
// whereas a billboard is a single blit of the tile's own art. This keeps the
// tree count cheap and reads consistently with the actor billboards.
const TREE_CONSTRUCTIONS = new Set([
  C.FOREST, C.SNOWY_FOREST, C.BROADLEAF, C.BROADLEAF_PURPLE, C.SPOILED_TREE, C.WINE_TREE,
]);

export function isTreeConstruction(id) {
  return TREE_CONSTRUCTIONS.has(id);
}

const EMPTY_MASK = { u: false, r: false, d: false, l: false };

// Darkness overlays and NOTHING build no geometry in the polygon world.
export function isSkippedConstruction(id) {
  return id === C.NOTHING || id === C.INDICATOR_ARROW ||
    id === C.DARKNESS_15 || id === C.DARKNESS_30 || id === C.DARKNESS_45;
}

// Darkness ids are designer-placed translucent-black paint used to hand-shade
// the map (e.g. faking water depth). They don't draw geometry; instead they
// tint whatever floor sits beneath them. Returns the black opacity, or 0.
const DARKNESS_OPACITY = {
  [C.DARKNESS_15]: 0.15,
  [C.DARKNESS_30]: 0.30,
  [C.DARKNESS_45]: 0.45,
};

export function darknessOpacity(id) {
  return DARKNESS_OPACITY[id] ?? 0;
}

// Multiply a floor colour toward black by `opacity` (the translucent-black
// overlay compositing to a flat colour, since the iso path has no alpha layer).
export function darken(hex, opacity) {
  const f = 1 - opacity;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round((n >> 16) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + 28);
  const g = Math.min(255, ((n >> 8) & 255) + 28);
  const b = Math.min(255, (n & 255) + 28);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
