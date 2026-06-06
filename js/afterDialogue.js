// AfterDialogueBehavior: what an NPC does once the player closes its
// dialogue. Mirrors Rust entity.rs::handle_after_dialogue and
// world.rs::mark_as_collected_if_needed: on non-ephemeral zones the
// removal sticks across reloads via the `item_collected.<id>` flag, so
// the entity stays gone after the player walks away and comes back.
//
// Behaviors (entity.after_dialogue, a string enum):
//   "Nothing"            — stay put, re-openable.
//   "Disappear"          — vanish instantly.
//   "FlyAwayEast"        — drift east off-screen, then vanish.
//   "VanishSmoke"        — fade out behind a puff of smoke, then vanish.
//   "VanishTeleport"     — fade out behind a teleport flash, then vanish.
//   "WalkToNearestExit"  — path-find to the nearest teleporter and walk
//                          there, then vanish (falls back to an instant
//                          vanish if no exit is reachable).
//
// The two "Vanish*" effects defer to vanishEffect.js, which fades the NPC
// body while a one-shot effect strip plays in front of it.

import { setValue } from "./storage.js";
import { isCreativeMode } from "./creativeMode.js";
import { startVanish, tickVanish } from "./vanishEffect.js";
import { findPathToNearest } from "./pathfinding.js";
import { teleporterTiles } from "./transitions.js";

// The full set of after-dialogue behaviors, in menu order. Single source
// of truth shared with the creative-mode entity inspector
// (entityInspector.js) so its dropdown can never drift from what
// handleAfterDialogue below actually understands.
export const AFTER_DIALOGUE_BEHAVIORS = [
  "Nothing",
  "Disappear",
  "FlyAwayEast",
  "VanishSmoke",
  "VanishTeleport",
  "WalkToNearestExit",
];

const FLY_AWAY_SPEED = 6;       // tiles/sec
const FLY_AWAY_LIFESPAN = 1.5;  // seconds
const WALK_AWAY_SPEED = 4;      // tiles/sec the NPC walks toward the exit

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
  if (beh === "VanishSmoke" || beh === "VanishTeleport") {
    if (isCreativeMode()) return;
    // startVanish fades the body while the effect strip plays; tickVanish
    // (driven from tickAfterDialogue below) does the removal and fires
    // onRemove so the despawn persists like Disappear.
    const kind = beh === "VanishSmoke" ? "smoke" : "teleport";
    startVanish(entity, kind, () => markCollected(zone, entity));
    return;
  }
  if (beh === "WalkToNearestExit") {
    if (isCreativeMode()) return;
    startWalkAway(zone, entity);
    return;
  }
  if (beh === "FlyAwayEast") {
    entity._flyAway = { vx: FLY_AWAY_SPEED, lifespan: FLY_AWAY_LIFESPAN };
  }
}

// Path-find from the NPC's feet to the nearest teleporter and stash a
// walker on the entity. With no reachable exit we just vanish, so the NPC
// still leaves the way the dialogue implied.
function startWalkAway(zone, entity) {
  const f = entity.frame;
  if (!f) { removeEntity(zone, entity); return; }
  const footH = f.h || 1;
  const startX = f.x;
  const startY = f.y + footH - 1;             // ground tile under the NPC
  const path = findPathToNearest(zone, startX, startY, teleporterTiles(zone));
  if (!path || path.length === 0) { removeEntity(zone, entity); return; }
  entity._walkAway = { path, idx: 0, footH };
}

export function tickAfterDialogue(zone, dt) {
  if (!zone?.entities) return;
  tickVanish(zone, dt);
  for (let i = zone.entities.length - 1; i >= 0; i--) {
    const e = zone.entities[i];
    if (e._flyAway) { tickFlyAway(zone, e, i, dt); continue; }
    if (e._walkAway) { tickWalkAway(zone, e, dt); continue; }
  }
}

function tickFlyAway(zone, e, i, dt) {
  if (e.frame) e.frame.x += e._flyAway.vx * dt;
  e._flyAway.lifespan -= dt;
  if (e._flyAway.lifespan <= 0) {
    zone.entities.splice(i, 1);
    markCollected(zone, e);
  }
}

// Slides the NPC's frame toward the next path tile at WALK_AWAY_SPEED,
// snapping on arrival and advancing to the next tile. Sets direction +
// moving so the renderer plays the directional walk animation. When the
// path runs out the NPC is removed and the despawn persists.
function tickWalkAway(zone, e, dt) {
  const w = e._walkAway;
  const tile = w.path[w.idx];
  if (!tile || !e.frame) { e.moving = false; removeEntity(zone, e); return; }
  const tx = tile.x;
  const ty = tile.y - (w.footH - 1);          // anchor for this feet tile
  const dx = tx - e.frame.x;
  const dy = ty - e.frame.y;
  const dist = Math.hypot(dx, dy);
  e.direction = directionFor(dx, dy);
  e.moving = true;
  const step = WALK_AWAY_SPEED * dt;
  if (dist <= step || dist === 0) {
    e.frame.x = tx;
    e.frame.y = ty;
    w.idx++;
    if (w.idx >= w.path.length) {
      e.moving = false;
      removeEntity(zone, e);
    }
  } else {
    e.frame.x += (dx / dist) * step;
    e.frame.y += (dy / dist) * step;
  }
}

function directionFor(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
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
