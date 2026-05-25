// Parses raw level JSON into a runtime world: typed tile grids, precomputed
// sprite-sheet coordinates (with neighbor-aware tile selection), and a
// collision mask. Heavy work happens here so the render loop stays simple.

import { biomeFromChar, biomeIsObstacle, BIOME } from "./biomes.js";
import { constructionFromChar, constructionIsObstacle, constructionIsBridge, constructionIsVisible, CONSTRUCTION } from "./constructions.js";
import { biomeTextureCol } from "./biomeTiles.js";
import { constructionTextureRow } from "./constructionTiles.js";

export function buildWorld(raw) {
  const biomeChars = raw.biome_tiles.tiles;
  const constructionChars = raw.construction_tiles.tiles;
  const rows = biomeChars.length;
  const cols = rows > 0 ? biomeChars[0].length : 0;

  const biome = make2D(rows, cols, (r, c) => biomeFromChar(biomeChars[r][c]));
  const construction = make2D(rows, cols, (r, c) => constructionFromChar(constructionChars[r][c]));

  const biomeCol = make2D(rows, cols, (r, c) => {
    const self = biome[r][c];
    const up    = r > 0        ? biome[r - 1][c] : BIOME.NOTHING;
    const right = c < cols - 1 ? biome[r][c + 1] : BIOME.NOTHING;
    const down  = r < rows - 1 ? biome[r + 1][c] : BIOME.NOTHING;
    const left  = c > 0        ? biome[r][c - 1] : BIOME.NOTHING;
    return biomeTextureCol(self, up, right, down, left);
  });

  const constructionRow = make2D(rows, cols, (r, c) => {
    const self = construction[r][c];
    if (self === CONSTRUCTION.NOTHING) return 0;
    const up    = r > 0        ? construction[r - 1][c] : CONSTRUCTION.NOTHING;
    const right = c < cols - 1 ? construction[r][c + 1] : CONSTRUCTION.NOTHING;
    const down  = r < rows - 1 ? construction[r + 1][c] : CONSTRUCTION.NOTHING;
    const left  = c > 0        ? construction[r][c - 1] : CONSTRUCTION.NOTHING;
    return constructionTextureRow(self, up, right, down, left);
  });

  const collision = make2D(rows, cols, (r, c) => isBlocked(biome[r][c], construction[r][c]));

  return {
    id: raw.id,
    rows,
    cols,
    biomeSheetId: raw.biome_tiles.sheet_id,
    constructionSheetId: raw.construction_tiles.sheet_id,
    biome,
    biomeCol,
    construction,
    constructionRow,
    collision,
    entities: raw.entities ?? [],
    soundtrack: raw.soundtrack ?? null,
    lightConditions: raw.light_conditions ?? "Day",
  };
}

export function isWalkable(world, tileX, tileY) {
  if (!world) return true;
  if (tileX < 0 || tileY < 0 || tileX >= world.cols || tileY >= world.rows) return false;
  return !world.collision[tileY][tileX];
}

function isBlocked(biome, construction) {
  if (constructionIsObstacle(construction)) return true;
  if (biomeIsObstacle(biome) && !constructionIsBridge(construction)) return true;
  return false;
}

function make2D(rows, cols, fill) {
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = fill(r, c);
    out[r] = row;
  }
  return out;
}
