// Pickups + hints: when the player snaps onto an auto-triggered entity we
// fire its effect and remove it from the world.
//
// Hint entities (consumable variant) show their dialogue, then vanish.
// Bundles and PickableObjects play a pickup SFX and vanish (no inventory
// yet — we'll wire that when combat lands). Teleporters are handled in
// transitions.js so they can fade between worlds.

import { showDialogue, resolveEntityDialogue } from "./dialogue.js";
import { playSfx } from "./audio.js";
import { getSpecies } from "./species.js";

// Bullet is here because in world data, placed Bullets (speed=0) act as
// stationary collectibles — same rule as the original Rust core. Once we
// add shooting we'll need to gate this on a moving/stationary flag.
const AUTO_PICKUP_TYPES = new Set(["Bundle", "PickableObject", "Bullet"]);

export function checkPickup(state) {
  const { world, player } = state;
  if (!world.entities) return;
  for (let i = 0; i < world.entities.length; i++) {
    const e = world.entities[i];
    const kind = classify(e);
    if (!kind) continue;
    const f = e.frame; if (!f) continue;
    if (player.tileX < f.x || player.tileX >= f.x + f.w) continue;
    if (player.tileY < f.y || player.tileY >= f.y + f.h) continue;
    world.entities.splice(i, 1);
    trigger(e, kind);
    return;
  }
}

function classify(e) {
  const sp = getSpecies(e.species_id);
  if (!sp) return null;
  if (AUTO_PICKUP_TYPES.has(sp.entity_type)) return "pickup";
  if (sp.entity_type === "Hint" && e.is_consumable) return "hint";
  return null;
}

function trigger(e, kind) {
  if (kind === "hint") {
    const lines = resolveEntityDialogue(e);
    playSfx("pickup", { volume: 0.6 });
    if (lines && lines.length) showDialogue(lines);
    return;
  }
  playSfx("pickup", { volume: 0.7 });
}
