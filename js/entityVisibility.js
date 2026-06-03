// Per-entity visibility and collision-rect helpers. Mirrors Rust's
// `features/entity.rs::should_be_visible` and `npc_hittable_frame`.
//
// `shouldBeVisible(entity)` walks the entity's `display_conditions` and
// returns the `.visible` flag of the first condition whose key matches
// the current storage state. If no condition matches, the entity is
// visible. An entity flagged as collected (item_collected.<id>=1) is
// always hidden.
//
// `entityHittableFrame(entity, species)` shrinks NPC collision down to a
// "feet" rect so the player can walk behind the upper part of a 2-tile
// NPC sprite — matching the Rust core's collision model where a standing
// NPC only blocks the floor tile they stand on.

import { getValue, keyMatches } from "./storage.js";
import { getSpecies } from "./species.js";
import { isCreativeMode } from "./creativeMode.js";

export function shouldBeVisible(entity) {
  if (!entity) return false;
  // Creative mode shows every entity, including ones the player would
  // normally never see (story-flag-hidden NPCs, collected items, etc.).
  // Mirrors Rust Entity::should_be_visible returning true in creative.
  if (isCreativeMode()) return true;
  if (entity.id != null && getValue(`item_collected.${entity.id}`) === 1) {
    return false;
  }
  const conds = entity.display_conditions;
  if (Array.isArray(conds)) {
    for (const c of conds) {
      if (!c) continue;
      if (keyMatches(c.key, c.expected_value | 0)) return !!c.visible;
    }
  }
  return true;
}

// Rect used for tile-collision tests. Mirrors Rust Entity::hittable_frame
// (entity.rs), which dispatches by entity type. The shared idea across every
// arm is that a sprite only blocks the floor it stands on: a 2-tile-tall
// barrel, table or building blocks its bottom row and lets the player walk
// behind the upper tile, exactly like a standing NPC.
export function entityHittableFrame(entity, species) {
  const f = entity?.frame;
  if (!f) return null;
  const sp = species || (entity ? getSpecies(entity.species_id) : null);
  const t = sp?.entity_type;
  if (t === "Npc" || t === "Hero") {
    // entities/npcs.rs::npc_hittable_frame
    const tall = f.h > 1.0;
    const w = f.w - 0.3;
    const h = f.h - (tall ? 1.35 : 0.2);
    return { x: f.x + 0.15, y: f.y + (tall ? 1.15 : 0.1), w, h };
  }
  if (t === "PushableObject" || t === "PressurePlate") {
    // pushable_object.rs / pressure_plate.rs: frame.padded_all(0.1)
    return { x: f.x + 0.1, y: f.y + 0.1, w: f.w - 0.2, h: f.h - 0.2 };
  }
  // entity.rs generic `_` arm: feet box for tables, barrels, buildings, …
  const tall = f.h > 1.0;
  const w = f.w - 0.3;
  const h = f.h - (tall ? 1.3 : 0.3);
  return { x: f.x + 0.15, y: f.y + (tall ? 1.15 : 0.15), w, h };
}

// Does the (integer) tile at (tx, ty) overlap the given rect? Used by
// callers that want a tile-versus-hitbox check rather than a tile-versus-
// frame check. A tile occupies [tx, tx+1) x [ty, ty+1).
export function rectOverlapsTile(rect, tx, ty) {
  if (!rect) return false;
  if (rect.x + rect.w <= tx) return false;
  if (rect.y + rect.h <= ty) return false;
  if (rect.x >= tx + 1) return false;
  if (rect.y >= ty + 1) return false;
  return true;
}
