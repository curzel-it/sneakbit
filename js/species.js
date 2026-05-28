// Species registry. Looks up species metadata by id and maps the
// sprite_sheet_id (matching the rust core) to one of the asset names
// loaded by assets.js.

import { getSprite } from "./assets.js?v=20260528d";
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
  SPRITE_SHEET_INVENTORY,
} from "./constants.js?v=20260528d";

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
  [SPRITE_SHEET_INVENTORY]: "inventory",
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

// Iterator over every loaded species. Used by the creative-mode editor
// to enumerate stockable items; not in any hot path.
export function allSpecies() {
  return Array.from(speciesById.values());
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
    directional: supportsDirections(raw.sprite_sheet_id, raw.entity_type),
    z_index: raw.z_index ?? 0,
    is_rigid: raw.is_rigid ?? false,
    base_speed: raw.base_speed ?? 0,
    hp: raw.hp ?? 100,
    dps: raw.dps ?? 0,
    movement_directions: raw.movement_directions ?? "None",
    melee_attacks_hero: !!raw.melee_attacks_hero,
    supports_bullet_boomerang: !!raw.supports_bullet_boomerang,
    supports_bullet_catching:  !!raw.supports_bullet_catching,
    bundle_contents: raw.bundle_contents ?? null,
    inventory_texture_offset: raw.inventory_texture_offset ?? null,
    bullet_species_id: raw.bullet_species_id ?? 0,
    bullet_lifespan: raw.bullet_lifespan ?? 1.5,
    cooldown_after_use: raw.cooldown_after_use ?? 0,
    melee_dps_multiplier: raw.melee_dps_multiplier ?? 1,
    equipment_usage_sound_effect: raw.equipment_usage_sound_effect ?? null,
    associated_weapon: raw.associated_weapon ?? null,
    received_damage_reduction: raw.received_damage_reduction ?? 0,
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

// The weapons sheet houses both directional sprites (bullets in flight,
// equipped weapons) and non-directional ones (PickableObject ground icons,
// dropped weapons). In Rust only entities whose update path calls
// `update_sprite_for_current_state` actually shift rows — for everything
// else the sprite stays on its original row. Mirror that here by gating
// directionality on entity_type, not just the sheet.
const DIRECTIONAL_TYPES = new Set([
  "Hero",
  "Npc",
  "CloseCombatMonster",
  "Bullet",
]);

function supportsDirections(sheetId, entityType) {
  return DIRECTIONAL_SHEETS.has(sheetId) && DIRECTIONAL_TYPES.has(entityType);
}
