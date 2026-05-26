// Species registry. Looks up species metadata by id and maps the
// sprite_sheet_id (matching the rust core) to one of the asset names
// loaded by assets.js.

import { getSprite } from "./assets.js";
import {
  SPRITE_SHEET_BUILDINGS,
  SPRITE_SHEET_HUMANOIDS_1X2,
  SPRITE_SHEET_STATIC_OBJECTS,
  SPRITE_SHEET_ANIMATED_OBJECTS,
  SPRITE_SHEET_HUMANOIDS_1X1,
  SPRITE_SHEET_HUMANOIDS_2X2,
  SPRITE_SHEET_WEAPONS,
  SPRITE_SHEET_MONSTERS,
  SPRITE_SHEET_HEROES,
} from "./constants.js";

const SHEET_NAMES = {
  [SPRITE_SHEET_HEROES]: "heroes",
  [SPRITE_SHEET_BUILDINGS]: "buildings",
  [SPRITE_SHEET_HUMANOIDS_1X1]: "humanoids_1x1",
  [SPRITE_SHEET_HUMANOIDS_1X2]: "humanoids_1x2",
  [SPRITE_SHEET_HUMANOIDS_2X2]: "humanoids_2x2",
  [SPRITE_SHEET_STATIC_OBJECTS]: "static_objects",
  [SPRITE_SHEET_ANIMATED_OBJECTS]: "animated_objects",
  [SPRITE_SHEET_WEAPONS]: "weapons",
  [SPRITE_SHEET_MONSTERS]: "monsters",
};

const speciesById = new Map();

export function loadSpeciesData(rawArray) {
  speciesById.clear();
  for (const raw of rawArray) {
    speciesById.set(raw.id, decorate(raw));
  }
}

export function getSpecies(id) {
  return speciesById.get(id) ?? null;
}

export function getEntitySheet(species) {
  const name = SHEET_NAMES[species.sprite_sheet_id];
  if (!name) return null;
  try { return getSprite(name); } catch { return null; }
}

export function getDefaultDirection(species) {
  return species.directional ? "down" : null;
}

function decorate(raw) {
  const f = raw.sprite_frame ?? { x: 0, y: 0, w: 1, h: 1 };
  return {
    id: raw.id,
    name: raw.name,
    entity_type: raw.entity_type,
    sprite_sheet_id: raw.sprite_sheet_id,
    texture_x: f.x,
    texture_y: f.y,
    width: f.w,
    height: f.h,
    frames: raw.sprite_number_of_frames ?? 1,
    directional: supportsDirections(raw.sprite_sheet_id),
    z_index: raw.z_index ?? 0,
    is_rigid: raw.is_rigid ?? false,
    base_speed: raw.base_speed ?? 0,
    hp: raw.hp ?? 100,
    dps: raw.dps ?? 0,
    movement_directions: raw.movement_directions ?? "None",
    melee_attacks_hero: !!raw.melee_attacks_hero,
    bundle_contents: raw.bundle_contents ?? null,
    inventory_texture_offset: raw.inventory_texture_offset ?? null,
  };
}

// Mirrors the original's `supports_directions(sheet_id)`: any sprite on
// one of these sheets has 8 rows (4 directions × moving/still).
const DIRECTIONAL_SHEETS = new Set([
  SPRITE_SHEET_HUMANOIDS_1X1,
  SPRITE_SHEET_HUMANOIDS_1X2,
  SPRITE_SHEET_HUMANOIDS_2X2,
  SPRITE_SHEET_MONSTERS,
  SPRITE_SHEET_HEROES,
  SPRITE_SHEET_WEAPONS,
]);

function supportsDirections(sheetId) {
  return DIRECTIONAL_SHEETS.has(sheetId);
}
