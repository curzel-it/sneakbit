// Parses raw level JSON into a runtime zone: typed tile grids, precomputed
// sprite-sheet coordinates (with neighbor-aware tile selection), and a
// collision mask. Heavy work happens here so the render loop stays simple.

import { biomeFromChar, biomeIsObstacle, BIOME, isSlippery } from "./biomes.js";
import { constructionFromChar, constructionIsObstacle, constructionIsBridge, constructionIsVisible, CONSTRUCTION } from "./constructions.js";
import { biomeTextureCol } from "./biomeTiles.js";
import { constructionTextureRow } from "./constructionTiles.js";
import { getSpecies } from "./species.js";
import { shouldBeVisible, entityHittableFrame, rectOverlapsTile } from "./entityVisibility.js";
import { isCreativeMode } from "./creativeMode.js";
import { canonicaliseLock, LOCK_NONE } from "./locks.js";
import { populateMonsters } from "./spawnMonsters.js";

const TELEPORTER_SPECIES_ID = 1019;

// Entity types that go through Rust's setup_generic — they all have
// is_rigid forced to false in creative mode. Plus Gate / InverseGate get
// the same treatment from setup_gate / setup_inverse_gate. Together
// these cover "walk through anything" in creative.
const CREATIVE_NON_RIGID_TYPES = new Set([
  "Building",
  "StaticObject",
  "PickableObject",
  "Bundle",
  "PushableObject",
  "Trail",
  "Gate",
  "InverseGate",
]);

export function buildZone(raw) {
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
  // weapon entities aren't zone props, they're per-player equipment. The
  // engine attaches a fresh set to the hero on spawn and only renders them
  // when equipped. Strip them from level data so they don't leave a
  // standalone "sword on the floor" sprite behind in shops.
  //
  // Each entity is shallow-cloned (with a fresh `frame` rect) so the zone
  // can mutate position / HP / gate-open flags without polluting the
  // module-level loadZone cache. Otherwise dying and respawning would
  // bring back the zone with pushables in their last-pushed position,
  // gates left open by drained pressure plates, etc.
  const entities = (raw.entities ?? [])
    .filter((e) => {
      const sp = getSpecies(e.species_id);
      if (!sp) return true;
      return sp.entity_type !== "WeaponMelee" && sp.entity_type !== "WeaponRanged";
    })
    .map(cloneEntity);

  const zone = {
    id: raw.id,
    rows,
    cols,
    biomeSheetId: raw.biome_tiles.sheet_id,
    constructionSheetId: raw.construction_tiles.sheet_id,
    zoneType: raw.world_type ?? null,
    biome,
    biomeCol,
    construction,
    constructionRow,
    collision,
    entities,
    soundtrack: raw.soundtrack ?? null,
    lightConditions: raw.light_conditions ?? "Day",
    ephemeralState: !!raw.ephemeral_state,
    _cutscenesRaw: raw.cutscenes ?? [],
  };

  // Append procedurally-generated monsters (opt-in via raw.monster_spawn).
  // Deterministic per zone id, so co-op peers agree; additive, so authored
  // monsters and set-pieces are preserved.
  populateMonsters(zone, raw);

  return zone;
}

export function isWalkable(zone, tileX, tileY) {
  if (!zone) return true;
  if (tileX < 0 || tileY < 0 || tileX >= zone.cols || tileY >= zone.rows) return false;
  return !zone.collision[tileY][tileX];
}

// Mutate one construction tile at runtime (Tower Defense grows its maze in this
// way). Updates the construction type, the collision mask, and re-tiles the
// autotiling row index for this tile AND its four orthogonal neighbours (each
// neighbour's edge sprite depends on whether this tile matches it). Leaves the
// baked render canvas alone — the caller evicts the zone cache once per batch
// so a single change doesn't trigger a full re-bake mid-loop.
export function setConstructionTile(zone, tileX, tileY, type) {
  if (!zone) return;
  const { cols, rows } = zone;
  if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) return;
  zone.construction[tileY][tileX] = type;
  zone.collision[tileY][tileX] = isBlocked(zone.biome[tileY][tileX], type);
  retileConstruction(zone, tileX, tileY);
  retileConstruction(zone, tileX, tileY - 1);
  retileConstruction(zone, tileX, tileY + 1);
  retileConstruction(zone, tileX - 1, tileY);
  retileConstruction(zone, tileX + 1, tileY);
}

// Mutate one biome tile at runtime (Tower Defense paints its sand path this
// way). Updates the biome type, refreshes the collision mask (a biome can be
// an obstacle — water, etc.), and re-tiles the autotiling column index for the
// tile AND its four orthogonal neighbours. Leaves the baked canvas alone — the
// caller evicts the zone cache once per batch.
export function setBiomeTile(zone, tileX, tileY, biome) {
  if (!zone) return;
  const { cols, rows } = zone;
  if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) return;
  zone.biome[tileY][tileX] = biome;
  zone.collision[tileY][tileX] = isBlocked(biome, zone.construction[tileY][tileX]);
  retileBiome(zone, tileX, tileY);
  retileBiome(zone, tileX, tileY - 1);
  retileBiome(zone, tileX, tileY + 1);
  retileBiome(zone, tileX - 1, tileY);
  retileBiome(zone, tileX + 1, tileY);
}

// Recompute one cell's biome autotiling column index from its neighbours.
function retileBiome(zone, x, y) {
  const { cols, rows } = zone;
  if (x < 0 || y < 0 || x >= cols || y >= rows) return;
  const b = zone.biome;
  const self = b[y][x];
  const up    = y > 0        ? b[y - 1][x] : BIOME.NOTHING;
  const right = x < cols - 1 ? b[y][x + 1] : BIOME.NOTHING;
  const down  = y < rows - 1 ? b[y + 1][x] : BIOME.NOTHING;
  const left  = x > 0        ? b[y][x - 1] : BIOME.NOTHING;
  zone.biomeCol[y][x] = biomeTextureCol(self, up, right, down, left);
}

// Recompute one cell's autotiling row index from its current neighbours.
function retileConstruction(zone, x, y) {
  const { cols, rows } = zone;
  if (x < 0 || y < 0 || x >= cols || y >= rows) return;
  const con = zone.construction;
  const self = con[y][x];
  if (self === CONSTRUCTION.NOTHING) { zone.constructionRow[y][x] = 0; return; }
  const up    = y > 0        ? con[y - 1][x] : CONSTRUCTION.NOTHING;
  const right = x < cols - 1 ? con[y][x + 1] : CONSTRUCTION.NOTHING;
  const down  = y < rows - 1 ? con[y + 1][x] : CONSTRUCTION.NOTHING;
  const left  = x > 0        ? con[y][x - 1] : CONSTRUCTION.NOTHING;
  zone.constructionRow[y][x] = constructionTextureRow(self, up, right, down, left);
}

// Mirrors Rust World::is_slippery_surface. True if the biome under the
// given tile is one we treat as slippery (Ice today). Out-of-bounds
// reads as false so callers don't have to guard.
export function isTileSlippery(zone, tileX, tileY) {
  if (!zone) return false;
  if (tileX < 0 || tileY < 0 || tileX >= zone.cols || tileY >= zone.rows) return false;
  return isSlippery(zone.biome[tileY][tileX]);
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
export function isEntityBlocked(zone, tileX, tileY, opts) {
  if (!zone?.entities) return false;
  if (hasEnterableTeleporter(zone, tileX, tileY)) return false;
  // A locked teleporter is rigid (mirrors Rust update_teleporter:
  // is_rigid = lock != None) so the player can't step onto it and trigger
  // the transition. The enterable check above already excluded locked ones
  // from the unblock path; this makes them affirmatively block even when no
  // building footprint sits behind them.
  if (hasLockedTeleporter(zone, tileX, tileY)) return true;
  const creative = isCreativeMode();
  const ignore = opts?.ignore;
  for (const e of zone.entities) {
    if (e === ignore) continue;
    if (e._spawned) continue;
    if (e._dying) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (sp.entity_type === "Teleporter") continue;
    if ((sp.entity_type === "Gate" || sp.entity_type === "InverseGate") && e._open) continue;
    if (creative && CREATIVE_NON_RIGID_TYPES.has(sp.entity_type)) continue;
    if (!sp.is_rigid && sp.entity_type !== "PushableObject") continue;
    if (!shouldBeVisible(e)) continue;
    const hit = entityHittableFrame(e, sp);
    if (!hit) continue;
    // hittable frames are fractional feet rects for every entity type now,
    // so a float-rect overlap is the only correct tile test.
    if (!rectOverlapsTile(hit, tileX, tileY)) continue;
    return true;
  }
  return false;
}

export function hasEnterableTeleporter(zone, tileX, tileY) {
  for (const e of zone.entities) {
    if (e.species_id !== TELEPORTER_SPECIES_ID) continue;
    if (!e.destination) continue;
    if (isTeleporterLocked(e)) continue;
    const f = e.frame; if (!f) continue;
    if (tileX < f.x || tileX >= f.x + f.w) continue;
    if (tileY < f.y || tileY >= f.y + f.h) continue;
    return true;
  }
  return false;
}

// A teleporter whose lock_type is anything but None is impassable in normal
// play. Unlike colored gates, teleporter locks are never spent by a key —
// the door simply stays shut (the Permanent lock on dungeon exits is the
// canonical case: you arrive beside it, you never walk back into it).
// Creative mode ignores the lock so the map editor can pass freely.
export function isTeleporterLocked(e) {
  if (!e || e.species_id !== TELEPORTER_SPECIES_ID) return false;
  if (isCreativeMode()) return false;
  return canonicaliseLock(e.lock_type) !== LOCK_NONE;
}

function hasLockedTeleporter(zone, tileX, tileY) {
  for (const e of zone.entities) {
    if (!isTeleporterLocked(e)) continue;
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

function cloneEntity(e) {
  const out = { ...e };
  if (e.frame) out.frame = { ...e.frame };
  if (e.destination) {
    out.destination = { ...e.destination };
    // Raw entity destinations use the upstream field name `world`. Translate
    // to our internal `zone` so all runtime code reads a single name. The
    // raw JSON shape on disk (data/*.json + prefabs output) is preserved.
    if (out.destination.world !== undefined && out.destination.zone === undefined) {
      out.destination.zone = out.destination.world;
      delete out.destination.world;
    }
  }
  // `dialogues` is referenced by dialogue.js but its handlers only read,
  // so a shallow copy of the array is enough.
  if (Array.isArray(e.dialogues)) out.dialogues = e.dialogues.slice();
  return out;
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
