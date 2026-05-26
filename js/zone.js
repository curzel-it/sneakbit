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

  return {
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
}

export function isWalkable(zone, tileX, tileY) {
  if (!zone) return true;
  if (tileX < 0 || tileY < 0 || tileX >= zone.cols || tileY >= zone.rows) return false;
  return !zone.collision[tileY][tileX];
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
  const creative = isCreativeMode();
  const ignore = opts?.ignore;
  for (const e of zone.entities) {
    if (e === ignore) continue;
    if (e._spawned) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (sp.entity_type === "Teleporter") continue;
    if ((sp.entity_type === "Gate" || sp.entity_type === "InverseGate") && e._open) continue;
    if (creative && CREATIVE_NON_RIGID_TYPES.has(sp.entity_type)) continue;
    if (!sp.is_rigid && sp.entity_type !== "PushableObject") continue;
    if (!shouldBeVisible(e)) continue;
    const hit = entityHittableFrame(e, sp);
    if (!hit) continue;
    if (sp.entity_type === "Npc" || sp.entity_type === "Hero") {
      if (!rectOverlapsTile(hit, tileX, tileY)) continue;
    } else {
      if (tileX < hit.x || tileX >= hit.x + hit.w) continue;
      if (tileY < hit.y || tileY >= hit.y + hit.h) continue;
    }
    return true;
  }
  return false;
}

export function hasEnterableTeleporter(zone, tileX, tileY) {
  for (const e of zone.entities) {
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
