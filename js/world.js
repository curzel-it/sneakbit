// Parses raw level JSON into a runtime world: typed tile grids, precomputed
// sprite-sheet coordinates (with neighbor-aware tile selection), and a
// collision mask. Heavy work happens here so the render loop stays simple.

import { biomeFromChar, biomeIsObstacle, BIOME } from "./biomes.js";
import { constructionFromChar, constructionIsObstacle, constructionIsBridge, constructionIsVisible, CONSTRUCTION } from "./constructions.js";
import { biomeTextureCol } from "./biomeTiles.js";
import { constructionTextureRow } from "./constructionTiles.js";
import { getSpecies } from "./species.js";

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

  // Mirror Rust world_setup::remove_all_equipment — placed melee/ranged
  // weapon entities aren't world props, they're per-player equipment. The
  // engine attaches a fresh set to the hero on spawn and only renders them
  // when equipped. Strip them from level data so they don't leave a
  // standalone "sword on the floor" sprite behind in shops.
  const entities = (raw.entities ?? []).filter((e) => {
    const sp = getSpecies(e.species_id);
    if (!sp) return true;
    return sp.entity_type !== "WeaponMelee" && sp.entity_type !== "WeaponRanged";
  });

  return {
    id: raw.id,
    rows,
    cols,
    biomeSheetId: raw.biome_tiles.sheet_id,
    constructionSheetId: raw.construction_tiles.sheet_id,
    worldType: raw.world_type ?? null,
    biome,
    biomeCol,
    construction,
    constructionRow,
    collision,
    entities,
    soundtrack: raw.soundtrack ?? null,
    lightConditions: raw.light_conditions ?? "Day",
    _cutscenesRaw: raw.cutscenes ?? [],
  };
}

export function isWalkable(world, tileX, tileY) {
  if (!world) return true;
  if (tileX < 0 || tileY < 0 || tileX >= world.cols || tileY >= world.rows) return false;
  return !world.collision[tileY][tileX];
}

// True if any rigid entity occupies the given tile. Bullets we spawned
// (carrying _spawned) don't count; teleporters explicitly don't block
// either, so the player can step onto them and trigger the transition.
// A destination-teleporter on a tile also unblocks any rigid entity
// covering the same tile — that's how building entrances work: the
// teleporter sits on the door tile, inside the (rigid) building footprint.
// Gates / InverseGates report blocking via `_open` (puzzles.js owns that
// flag) so a pressure-plate-opened gate is walkable until the plate flips.
// `opts.ignore` excludes a specific entity from the check (used when a
// pushable checks if its destination tile is clear of other rigids).
export function isEntityBlocked(world, tileX, tileY, opts) {
  if (!world?.entities) return false;
  if (hasEnterableTeleporter(world, tileX, tileY)) return false;
  const ignore = opts?.ignore;
  for (const e of world.entities) {
    if (e === ignore) continue;
    if (e._spawned) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (sp.entity_type === "Teleporter") continue;
    if ((sp.entity_type === "Gate" || sp.entity_type === "InverseGate") && e._open) continue;
    if (!sp.is_rigid && sp.entity_type !== "PushableObject") continue;
    const f = e.frame; if (!f) continue;
    if (tileX < f.x || tileX >= f.x + f.w) continue;
    if (tileY < f.y || tileY >= f.y + f.h) continue;
    return true;
  }
  return false;
}

export function hasEnterableTeleporter(world, tileX, tileY) {
  for (const e of world.entities) {
    if (e.species_id !== 1019) continue;
    if (!e.destination) continue;
    const f = e.frame; if (!f) continue;
    if (tileX < f.x || tileX >= f.x + f.w) continue;
    if (tileY < f.y || tileY >= f.y + f.h) continue;
    return true;
  }
  return false;
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
