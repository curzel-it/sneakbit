// Death animation: a killed monster or destructible doesn't vanish on the
// frame it dies — it turns into a short-lived fireball, then is removed.
// Mirrors the Rust core's Entity::play_death_animation, which clears the
// entity's facing, drops its rigidity, gives it a one-second lifespan and
// swaps its sprite to the animated-objects fireball strip.
//
// The dying entity stays in zone.entities so the renderer can show the
// fireball, but is flagged `_dying` so combat, collision and AI all skip
// it — see the `_dying` guards in combat.js, zone.js, mobs.js, monsters.js
// and minions.js. The renderer reads DEATH_SPRITE for the fireball art.

import { ANIMATIONS_FPS } from "./constants.js";
import { setValue } from "./storage.js";

// Rust: `remaining_lifespan = 10.0 / ANIMATIONS_FPS` → 1.0s at 10fps.
const DEATH_LIFESPAN = 10 / ANIMATIONS_FPS;

// Fireball strip on the animated_objects sheet (sheet id 1012): row 11,
// 5 frames — the same source rect Rust's play_death_animation assigns.
export const DEATH_SPRITE = { sheet: "animated_objects", texX: 1, texY: 11, frames: 5 };

export function isDying(entity) {
  return !!entity?._dying;
}

// Turns a just-killed entity into its dying form: a 1×1 fireball centred on
// the old footprint, no facing, short lifespan. Idempotent — re-killing a
// dying entity is a no-op so a passing bullet can't reset the timer.
//
// opts lets non-combat callers reuse the same "play a strip in place then
// remove" lifecycle with their own art/timing (see afterDialogue.js's
// VanishSmoke / VanishTeleport):
//   - opts.sprite:   strip to draw instead of the fireball (drawDeath reads
//                    entity._deathSprite). Defaults to DEATH_SPRITE.
//   - opts.lifespan: seconds before removal. Defaults to DEATH_LIFESPAN.
//   - opts.onRemove: called once, just before the entity is spliced out
//                    (e.g. to persist "collected" state).
export function startDeathAnimation(entity, opts = {}) {
  if (entity._dying) return;
  const f = entity.frame || { x: 0, y: 0, w: 1, h: 1 };
  const cx = f.x + (f.w || 1) * 0.5;
  const cy = f.y + (f.h || 1) * 0.5;
  entity.frame = { x: cx - 0.5, y: cy - 0.5, w: 1, h: 1 };
  entity.direction = "None";
  entity._dying = true;
  entity._deathLifespan = opts.lifespan ?? DEATH_LIFESPAN;
  entity._deathSprite = opts.sprite ?? DEATH_SPRITE;
  entity._onDeathRemove = opts.onRemove ?? null;
}

// Ages dying entities and removes them when their fireball burns out. Runs
// host-side only (called from the combat tick); guests learn of the removal
// through the next snapshot delta.
export function tickDeathAnimations(zone, dt) {
  const ents = zone?.entities;
  if (!ents) return;
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i];
    if (!e._dying) continue;
    e._deathLifespan -= dt;
    if (e._deathLifespan <= 0) {
      if (typeof e._onDeathRemove === "function") e._onDeathRemove();
      else markDeadCollected(zone, e);
      ents.splice(i, 1);
    }
  }
}

// Persist a killed entity's removal under `item_collected.<id>`, mirroring
// Rust world.rs::mark_as_collected_if_needed (called from remove_entity_at_index).
// This keeps destroyed monsters/barrels from respawning on zone reload AND
// lets kill-gated dialogues detect the death — e.g. the haunted-pub empty
// seat's reward only unlocks once `item_collected.<monsterId>` is set.
// Runtime spawns (coins carry _ephemeral, minions/coins use negative ids,
// player bullets carry _spawned) are skipped so they never pollute the save.
// Entities with an _onDeathRemove hook persist their own state, so they take
// the branch above instead.
function markDeadCollected(zone, e) {
  if (zone?.ephemeralState) return;
  if (e._ephemeral || e._spawned) return;
  if (!(e.id > 0)) return;
  setValue(`item_collected.${e.id}`, 1);
}
