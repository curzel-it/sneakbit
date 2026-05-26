// AfterDialogueBehavior: what an NPC does once the player closes its
// dialogue. Mirrors Rust entity.rs::handle_after_dialogue.
//   - "Nothing"     : no-op
//   - "Disappear"   : remove the entity from the world immediately
//   - "FlyAwayEast" : animate the entity sliding off to the right, then
//                     remove it once its lifespan runs out

const FLY_AWAY_SPEED = 6;       // tiles/sec
const FLY_AWAY_LIFESPAN = 1.5;  // seconds

export function handleAfterDialogue(world, entity) {
  const beh = entity?.after_dialogue;
  if (!beh || beh === "Nothing") return;
  if (beh === "Disappear") {
    const idx = world.entities.indexOf(entity);
    if (idx >= 0) world.entities.splice(idx, 1);
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
    if (e._flyAway.lifespan <= 0) world.entities.splice(i, 1);
  }
}
