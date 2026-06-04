// Per-frame visible-entity filter. Mirrors Rust's
// `features/hitmaps.rs::update_hitmaps`: only entities overlapping the
// camera viewport (plus a small set of always-visible types) are eligible
// for per-tick updates. This isn't only a perf win — it changes gameplay:
// a kunai thrown across the screen never hits a monster that has wandered
// off-screen, and monsters don't keep merging into bigger tiers behind
// the camera. Spawned bullets (_spawned) always tick so they keep moving
// even when they leave the viewport for a few frames before despawning.

import { getSpecies } from "./species.js";
import { shouldBeVisible } from "./entityVisibility.js";

const ALWAYS_VISIBLE_TYPES = new Set([
  "Hero",
  "PressurePlate",
  "PushableObject",
]);

// `cameras` may be a single camera rect or an array of them. An entity
// is visible if it overlaps ANY of them. Online co-op passes one viewport
// per player so a guest who wandered away from the host still has live
// mobs/pickups around them; offline / local co-op pass the single shared
// camera, exactly as before.
//
// `all` skips the viewport test and flags every entity visible. Tower Defense
// sets it: its camera follows one hero across a large arena, but the whole
// battlefield must keep simulating — off-screen enemies still take fire, deal
// melee damage and fuse, and off-screen allies still fight. Rendering culls on
// its own (entities.js::collect), so this only opens the combat/fusion gates
// that read `_visible` / `visibleEntities`; it never draws an off-screen prop.
export function updateVisibleEntities(zone, cameras, { all = false } = {}) {
  if (!zone) return;
  // Reuse the zone's existing visibleEntities array (clear + refill) instead of
  // allocating a fresh one each frame: it's stored on the zone and read later
  // the same frame by combat/mobs/monsters/minions, so it escapes the frame and
  // is a real per-frame heap allocation sized by the visible-entity count.
  let out = zone.visibleEntities;
  if (!Array.isArray(out)) { out = []; zone.visibleEntities = out; }
  out.length = 0;
  const isArr = Array.isArray(cameras);
  const ents = zone.entities || [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    let visible;
    if (e._spawned) {
      // Runtime spawns (bullets, coins, minions) carry no collected/display
      // flags and must keep ticking even off-screen, so they're always live.
      visible = true;
    } else if (!shouldBeVisible(e)) {
      // An entity the player can't see must not be simulated either. Mirrors
      // Rust world.insert_entity rejecting !should_be_visible entities at load,
      // so a monster killed in a previous run (item_collected.<id>=1) that
      // reloads on death-respawn no longer wanders and deals melee damage
      // while invisible. Re-checked every frame so a display-condition entity
      // still wakes up the moment its flag flips it visible.
      visible = false;
    } else if (all) {
      visible = true;
    } else {
      const sp = getSpecies(e.species_id);
      const et = sp?.entity_type;
      visible = ALWAYS_VISIBLE_TYPES.has(et) || overlapsCameras(cameras, isArr, e.frame);
    }
    e._visible = visible;
    if (visible) out.push(e);
  }
}

// `cameras` may be a single camera rect or an array of them — handled without
// wrapping a lone camera in a throwaway array (this runs every frame).
function overlapsCameras(cameras, isArr, f) {
  if (!isArr) return overlapsViewport(cameras, f);
  for (let i = 0; i < cameras.length; i++) {
    if (overlapsViewport(cameras[i], f)) return true;
  }
  return false;
}

// Camera + entity-frame overlap check, edges inclusive. Matches Rust
// FRect::overlaps_or_touches so a mob standing on the very edge of the
// viewport still counts as visible.
export function overlapsViewport(cam, f) {
  if (!cam || !f) return false;
  return cam.x <= f.x + f.w
      && cam.x + cam.w >= f.x
      && cam.y <= f.y + f.h
      && cam.y + cam.h >= f.y;
}
