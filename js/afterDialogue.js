// AfterDialogueBehavior: what an NPC does once the player closes its
// dialogue. Mirrors Rust entity.rs::handle_after_dialogue and
// world.rs::mark_as_collected_if_needed: on non-ephemeral zones the
// removal sticks across reloads via the `item_collected.<id>` flag, so
// the entity stays gone after the player walks away and comes back.

import { setValue } from "./storage.js";
import { isCreativeMode } from "./creativeMode.js";

const FLY_AWAY_SPEED = 6;       // tiles/sec
const FLY_AWAY_LIFESPAN = 1.5;  // seconds

export function handleAfterDialogue(zone, entity) {
  const beh = entity?.after_dialogue;
  if (!beh || beh === "Nothing") return;
  if (beh === "Disappear") {
    // Creative mode keeps "Disappear" NPCs around so the designer can
    // keep re-opening their dialogue. Mirrors the Rust core skipping the
    // removal in GameMode::Creative.
    if (!isCreativeMode()) removeEntity(zone, entity);
    return;
  }
  if (beh === "FlyAwayEast") {
    entity._flyAway = { vx: FLY_AWAY_SPEED, lifespan: FLY_AWAY_LIFESPAN };
  }
}

export function tickAfterDialogue(zone, dt) {
  if (!zone?.entities) return;
  for (let i = zone.entities.length - 1; i >= 0; i--) {
    const e = zone.entities[i];
    if (!e._flyAway) continue;
    if (e.frame) e.frame.x += e._flyAway.vx * dt;
    e._flyAway.lifespan -= dt;
    if (e._flyAway.lifespan <= 0) {
      zone.entities.splice(i, 1);
      markCollected(zone, e);
    }
  }
}

function removeEntity(zone, entity) {
  const idx = zone.entities.indexOf(entity);
  if (idx >= 0) zone.entities.splice(idx, 1);
  markCollected(zone, entity);
}

function markCollected(zone, entity) {
  if (!entity || entity.id == null) return;
  if (zone?.ephemeralState) return;
  setValue(`item_collected.${entity.id}`, 1);
}
