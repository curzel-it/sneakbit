// Building-prefab expansion for the creative-mode map editor.
//
// Placing a Building species via the editor should not just drop a single
// 5x4 sprite — it should expand into a building + door teleporter + a fresh
// interior zone (walls / floor / furniture / back-door). Mirrors Rust's
// prefabs::all::new_building dispatch table, adapted to use the HTML port's
// raw-JSON zone format.
//
// Each entry point returns:
//   { entities, interiorZones }
// where `entities` are appended to the source zone's raw.entities and
// every zone in `interiorZones` should be persisted via
// putBufferedZone(id, raw) so the door teleporter's destination resolves
// when the player walks through it.
//
// Returns null when the building species isn't a known prefab — the caller
// should fall back to single-entity placement.

import { getSpecies } from "./species.js";
import {
  SPRITE_SHEET_BIOME_TILES,
  SPRITE_SHEET_CONSTRUCTION_TILES,
} from "./constants.js";

const SPECIES_TELEPORTER = 1019;
const SPECIES_TABLE = 1016;
const SPECIES_SEAT_GREEN = 1013;
const SPECIES_NPC_SHOP_CLERK = 3008;
const SPECIES_STAIRS_UP = 1010;
const SPECIES_STAIRS_DOWN = 1011;

// HOUSE_INTERIOR_* mirror game_core/src/constants.rs. Door positions and
// floor extents are all derived from these.
const HOUSE_INTERIOR_ROWS = 6;
const HOUSE_INTERIOR_COLUMNS = 10;
// Interior zone tile grid. Rust's bounds = 30×10; the HTML port only
// needs a grid big enough to hold the walls + door cutouts + 1 row of
// margin below the back door so stepOutOf has somewhere to walk to.
const INTERIOR_GRID_COLS = 30;
const INTERIOR_GRID_ROWS = 10;

// Mirrors prefabs::all::new_building's dispatch table. Species not listed
// here render as a single entity (handled by the caller).
const SMALL_HOUSE_IDS = new Set([1033, 1130]);
const HOUSE_IDS       = new Set([1002, 1003, 1004, 1084, 1086, 1087, 1129]);
const TWO_FLOOR_IDS   = new Set([1005, 1006, 1007, 1085]);
const SHOP_IDS        = new Set([1070, 1071, 1072]);

// Editor-allocated zone ids must stay within int32 because js/storage.js
// (saveProgress → setValue → `n | 0`) round-trips numeric values through
// int32. We pick a base well above any shipped id (shipped tops out near
// 1.5e7) and add seconds-since-epoch, leaving room for several back-to-
// back placements per second via lastId. This fits in int32 (max ~2.1e9)
// until ~2038 — long enough to revisit if the port is still alive then.
const INTERIOR_ID_BASE = 100_000_000; // safely above any shipped id
let lastInteriorId = 0;
function nextInteriorZoneId() {
  const stamp = INTERIOR_ID_BASE + Math.floor(Date.now() / 1000);
  const id = Math.max(stamp, lastInteriorId + 1);
  lastInteriorId = id;
  return id;
}

// Editor-spawned entities share the same negative-id contract as
// mapEditor.js's single-entity placements — keeps them visually distinct
// from shipped ids in JSON diffs and makes the eraser's "only strip
// negative-id entities" rule cover prefab children too.
let nextEditorEntityId = -1_000_000;
function nextEntityId() { return nextEditorEntityId--; }

export function tryBuildingPrefab(speciesId, sourceZoneId, tileX, tileY) {
  const sp = getSpecies(speciesId);
  if (!sp || sp.entity_type !== "Building") return null;
  if (SMALL_HOUSE_IDS.has(speciesId)) return smallHouse(sp, sourceZoneId, tileX, tileY);
  if (HOUSE_IDS.has(speciesId))       return singleFloorHouse(sp, sourceZoneId, tileX, tileY);
  if (TWO_FLOOR_IDS.has(speciesId))   return twoFloorHouse(sp, sourceZoneId, tileX, tileY);
  if (SHOP_IDS.has(speciesId))        return shopBuilding(sp, sourceZoneId, tileX, tileY);
  return null;
}

function entity(speciesId, x, y, w, h) {
  return {
    id: nextEntityId(),
    species_id: speciesId,
    direction: "Down",
    frame: { x, y, w, h },
    after_dialogue: "Nothing",
    demands_attention: false,
    destination: null,
    dialogues: [],
    display_conditions: [],
    is_consumable: false,
    lock_type: "None",
  };
}

function teleporter(x, y, destZoneId) {
  const e = entity(SPECIES_TELEPORTER, x, y, 1, 1);
  // (0, 0) is the magic destination value that tells transitions.js to
  // look up the back-teleporter in the destination zone and step out of
  // it. Same convention every shipped door uses.
  // Raw destination shape matches upstream Rust JSON (`world` field).
  // buildZone() rewrites it to `.zone` at parse time; runtime reads use `.zone`.
  e.destination = { world: destZoneId, x: 0, y: 0, direction: "None" };
  return e;
}

function buildingEntity(sp, tileX, tileY) {
  return entity(sp.id, tileX, tileY, sp.width || 1, sp.height || 1);
}

function emptyInteriorRaw(zoneId) {
  const rowOfZeros = "0".repeat(INTERIOR_GRID_COLS);
  return {
    id: zoneId,
    biome_tiles:        { sheet_id: SPRITE_SHEET_BIOME_TILES,        tiles: Array(INTERIOR_GRID_ROWS).fill(rowOfZeros) },
    construction_tiles: { sheet_id: SPRITE_SHEET_CONSTRUCTION_TILES, tiles: Array(INTERIOR_GRID_ROWS).fill(rowOfZeros) },
    cutscenes: [],
    entities: [],
    ephemeral_state: false,
    light_conditions: "Day",
    soundtrack: null,
    world_type: "HouseInterior",
  };
}

function setChar(rows, r, c, ch) {
  if (r < 0 || r >= rows.length) return;
  const row = rows[r];
  if (typeof row !== "string" || c < 0 || c >= row.length) return;
  rows[r] = row.slice(0, c) + ch + row.slice(c + 1);
}

// Mirrors paint-pattern in Rust's house_*/shop prefabs: DarkWood floor in
// the centre, LightWall around the perimeter, with cutouts for the back
// doors so the player can exit. `doorBackCols` is the set of columns where
// the bottom wall row should NOT be a wall (where the back-teleporters sit).
function paintInteriorShell(interior, doorBackCols) {
  const biome = interior.biome_tiles.tiles;
  const cons  = interior.construction_tiles.tiles;
  const BIOME_DARK_WOOD = "6";
  const CONS_LIGHT_WALL = "4";

  for (let r = 0; r < HOUSE_INTERIOR_ROWS; r++) {
    for (let c = 0; c < HOUSE_INTERIOR_COLUMNS; c++) {
      setChar(biome, r + 2, c + 1, BIOME_DARK_WOOD);
    }
  }
  const wallRows = [0, 1, HOUSE_INTERIOR_ROWS + 2];
  for (const r of wallRows) {
    for (let c = 0; c <= HOUSE_INTERIOR_COLUMNS; c++) {
      if (r === HOUSE_INTERIOR_ROWS + 2 && doorBackCols.has(c)) continue;
      setChar(cons, r, c, CONS_LIGHT_WALL);
    }
  }
  for (let r = 0; r < HOUSE_INTERIOR_ROWS + 3; r++) {
    setChar(cons, r, 0, CONS_LIGHT_WALL);
  }
}

function addBackDoors(interior, sourceZoneId) {
  const x = Math.ceil(HOUSE_INTERIOR_COLUMNS / 2); // 5
  const y = HOUSE_INTERIOR_ROWS + 2;               // 8
  interior.entities.push(teleporter(x,     y, sourceZoneId));
  interior.entities.push(teleporter(x + 1, y, sourceZoneId));
  return new Set([x, x + 1]);
}

function addDefaultFurniture(interior) {
  interior.entities.push(entity(SPECIES_TABLE,      1, 4, 2, 2));
  interior.entities.push(entity(SPECIES_SEAT_GREEN, 1, 4, 1, 1));
  interior.entities.push(entity(SPECIES_SEAT_GREEN, 2, 4, 1, 1));
  interior.entities.push(entity(SPECIES_SEAT_GREEN, 1, 6, 1, 1));
  interior.entities.push(entity(SPECIES_SEAT_GREEN, 2, 6, 1, 1));
}

function smallHouse(sp, sourceZoneId, tileX, tileY) {
  const interiorId = nextInteriorZoneId();
  const interior = emptyInteriorRaw(interiorId);
  const doorCols = addBackDoors(interior, sourceZoneId);
  paintInteriorShell(interior, doorCols);
  addDefaultFurniture(interior);

  const building = buildingEntity(sp, tileX, tileY);
  const w = sp.width || 1;
  const door = teleporter(tileX + Math.ceil(w / 2), tileY + 2, interiorId);
  return { entities: [building, door], interiorZones: [interior] };
}

function singleFloorHouse(sp, sourceZoneId, tileX, tileY) {
  const interiorId = nextInteriorZoneId();
  const interior = emptyInteriorRaw(interiorId);
  const doorCols = addBackDoors(interior, sourceZoneId);
  paintInteriorShell(interior, doorCols);
  addDefaultFurniture(interior);

  const building = buildingEntity(sp, tileX, tileY);
  const w = sp.width || 1;
  const door = teleporter(tileX + Math.ceil(w / 2), tileY + 3, interiorId);
  return { entities: [building, door], interiorZones: [interior] };
}

function twoFloorHouse(sp, sourceZoneId, tileX, tileY) {
  const firstFloorId  = nextInteriorZoneId();
  const secondFloorId = nextInteriorZoneId();

  const first = emptyInteriorRaw(firstFloorId);
  const firstDoorCols = addBackDoors(first, sourceZoneId);
  paintInteriorShell(first, firstDoorCols);
  addDefaultFurniture(first);
  // Stairs up at the top-right of the floor.
  const stairsX = HOUSE_INTERIOR_COLUMNS - 2;
  first.entities.push(entity(SPECIES_STAIRS_UP, stairsX, 0, 1, 2));
  first.entities.push(teleporter(stairsX, 1, secondFloorId));

  // Second floor: same shell, no back-door (the stairs handle return).
  const second = emptyInteriorRaw(secondFloorId);
  paintInteriorShell(second, new Set());
  second.entities.push(entity(SPECIES_STAIRS_DOWN, stairsX, 1, 1, 2));
  second.entities.push(teleporter(stairsX, 2, firstFloorId));

  const building = buildingEntity(sp, tileX, tileY);
  const w = sp.width || 1;
  const door = teleporter(tileX + Math.ceil(w / 2), tileY + 4, firstFloorId);
  return { entities: [building, door], interiorZones: [first, second] };
}

function shopBuilding(sp, sourceZoneId, tileX, tileY) {
  const interiorId = nextInteriorZoneId();
  const interior = emptyInteriorRaw(interiorId);
  const doorCols = addBackDoors(interior, sourceZoneId);
  paintInteriorShell(interior, doorCols);
  addDefaultFurniture(interior);

  const cons = interior.construction_tiles.tiles;
  const CONS_COUNTER = "5";
  const CONS_LIBRARY = "6";
  for (const [r, c] of [[3,5],[2,5],[3,6],[3,7],[3,8],[2,8]]) setChar(cons, r, c, CONS_COUNTER);
  for (const [r, c] of [
    [1,1],[1,2],[1,3],[1,4],[2,1],[2,2],[2,3],[2,4],
    [1,9],[1,10],[2,9],[2,10],
  ]) setChar(cons, r, c, CONS_LIBRARY);

  const clerk = entity(SPECIES_NPC_SHOP_CLERK, 6, 1, 1, 2);
  clerk.dialogues = [];
  interior.entities.push(clerk);

  const building = buildingEntity(sp, tileX, tileY);
  const w = sp.width || 1;
  const door = teleporter(tileX + Math.ceil(w / 2), tileY + 3, interiorId);
  return { entities: [building, door], interiorZones: [interior] };
}
