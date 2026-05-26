// Biome type metadata. Mirrors game_core/src/maps/biomes.rs.
// Values are texture indices (used as the y offset into the composed sheet).

export const BIOME = Object.freeze({
  WATER: 0,
  DESERT: 1,
  GRASS: 2,
  ROCK: 3,
  SNOW: 4,
  LIGHT_WOOD: 5,
  DARK_WOOD: 6,
  NOTHING: 7,
  DARK_ROCK: 8,
  ICE: 9,
  DARK_GRASS: 10,
  ROCK_PLATES: 11,
  LAVA: 12,
  FARMLAND: 13,
  DARK_WATER: 14,
  DARK_SAND: 15,
  SAND_PLATES: 16,
});

export const NUM_BIOMES = 17;

const CHAR_TO_BIOME = {
  "0": BIOME.NOTHING,
  "1": BIOME.GRASS,
  "2": BIOME.WATER,
  "3": BIOME.ROCK,
  "4": BIOME.DESERT,
  "5": BIOME.SNOW,
  "6": BIOME.DARK_WOOD,
  "7": BIOME.LIGHT_WOOD,
  "8": BIOME.DARK_ROCK,
  "9": BIOME.ICE,
  A: BIOME.DARK_GRASS,
  B: BIOME.ROCK_PLATES,
  G: BIOME.LAVA,
  H: BIOME.FARMLAND,
  J: BIOME.DARK_WATER,
  K: BIOME.DARK_SAND,
  L: BIOME.SAND_PLATES,
};

export function biomeFromChar(c) {
  return CHAR_TO_BIOME[c] ?? BIOME.NOTHING;
}

// Inverse of biomeFromChar. Built lazily from CHAR_TO_BIOME so the two
// stay in sync without duplicating the table.
const BIOME_TO_CHAR = Object.fromEntries(
  Object.entries(CHAR_TO_BIOME).map(([ch, id]) => [id, ch]),
);

export function biomeToChar(id) {
  return BIOME_TO_CHAR[id] ?? "0";
}

const LIQUIDS = new Set([BIOME.WATER, BIOME.DARK_WATER, BIOME.LAVA]);
export function isLiquid(b) { return LIQUIDS.has(b); }
export function isLightGrass(b) { return b === BIOME.GRASS; }
export function isDarkGrass(b) { return b === BIOME.DARK_GRASS; }
// Mirrors Rust World::is_slippery_surface — only Ice tiles slide today.
// (Rust upstream still calls them "worlds"; our codebase renamed to "zone".)
export function isSlippery(b) { return b === BIOME.ICE; }

export function biomeIsObstacle(b) {
  return b === BIOME.WATER || b === BIOME.NOTHING || b === BIOME.LAVA || b === BIOME.DARK_WATER;
}

export function biomeIsSame(a, b) {
  return a === b || (isLightGrass(a) && isLightGrass(b));
}
