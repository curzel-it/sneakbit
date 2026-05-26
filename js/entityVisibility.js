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

// Rect used for tile-collision tests. Matches Rust npc_hittable_frame for
// NPCs/Hero entities (a small box at the feet of the sprite) and falls
// back to the full entity frame for everything else.
export function entityHittableFrame(entity, species) {
  const f = entity?.frame;
  if (!f) return null;
  const sp = species || (entity ? getSpecies(entity.species_id) : null);
  const t = sp?.entity_type;
  if (t === "Npc" || t === "Hero") {
    const tall = f.h > 1.0;
    const xOff = 0.15;
    const yOff = tall ? 1.15 : 0.1;
    const w = f.w - 0.3;
    const h = f.h - (tall ? 1.35 : 0.2);
    return { x: f.x + xOff, y: f.y + yOff, w, h };
  }
  return f;
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
