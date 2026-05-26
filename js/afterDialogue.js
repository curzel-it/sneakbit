// AfterDialogueBehavior: what an NPC does once the player closes its
// dialogue. Mirrors Rust entity.rs::handle_after_dialogue and
// world.rs::mark_as_collected_if_needed: on non-ephemeral worlds the
// removal sticks across reloads via the `item_collected.<id>` flag, so
// the entity stays gone after the player walks away and comes back.

import { setValue } from "./storage.js";

const FLY_AWAY_SPEED = 6;       // tiles/sec
const FLY_AWAY_LIFESPAN = 1.5;  // seconds

export function handleAfterDialogue(world, entity) {
  const beh = entity?.after_dialogue;
  if (!beh || beh === "Nothing") return;
  if (beh === "Disappear") {
    removeEntity(world, entity);
    return;
  }
  if (beh === "FlyAwayEast") {
    entity._flyAway = { vx: FLY_AWAY_SPEED, lifespan: FLY_AWAY_LIFESPAN };
  }
}

export function tickAfterDialogue(world, dt) {
  if (!world?.entities) return;
  for (let i = world.entities.length - 1; i >= 0; i--) {
    const e = world.entities[i];
    if (!e._flyAway) continue;
    if (e.frame) e.frame.x += e._flyAway.vx * dt;
    e._flyAway.lifespan -= dt;
    if (e._flyAway.lifespan <= 0) {
      world.entities.splice(i, 1);
      markCollected(world, e);
    }
  }
}

function removeEntity(world, entity) {
  const idx = world.entities.indexOf(entity);
  if (idx >= 0) world.entities.splice(idx, 1);
  markCollected(world, entity);
}

function markCollected(world, entity) {
  if (!entity || entity.id == null) return;
  if (world?.ephemeralState) return;
  setValue(`item_collected.${entity.id}`, 1);
}
