// Per-frame visible-entity filter. Mirrors Rust's
// `features/hitmaps.rs::update_hitmaps`: only entities overlapping the
// camera viewport (plus a small set of always-visible types) are eligible
// for per-tick updates. This isn't only a perf win — it changes gameplay:
// a kunai thrown across the screen never hits a monster that has wandered
// off-screen, and monsters don't keep merging into bigger tiers behind
// the camera. Spawned bullets (_spawned) always tick so they keep moving
// even when they leave the viewport for a few frames before despawning.

import { getSpecies } from "./species.js";

const ALWAYS_VISIBLE_TYPES = new Set([
  "Hero",
  "PressurePlate",
  "PushableObject",
]);

export function updateVisibleEntities(zone, camera) {
  if (!zone) return;
  const out = [];
  const ents = zone.entities || [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    let visible;
    if (e._spawned) {
      visible = true;
    } else {
      const sp = getSpecies(e.species_id);
      const et = sp?.entity_type;
      visible = ALWAYS_VISIBLE_TYPES.has(et) || overlapsViewport(camera, e.frame);
    }
    e._visible = visible;
    if (visible) out.push(e);
  }
  zone.visibleEntities = out;
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
