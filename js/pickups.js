// Pickups + hints: when the player snaps onto a consumable entity we
// trigger its effect and remove it from the world.
//
// Hint entities show their dialogue, then vanish. Bundles play a pickup
// SFX and vanish (no inventory yet — we'll wire that when combat lands).

import { showDialogue, resolveEntityDialogue } from "./dialogue.js";
import { playSfx } from "./audio.js";

export function checkPickup(state) {
  const { world, player } = state;
  if (!world.entities) return;
  for (let i = 0; i < world.entities.length; i++) {
    const e = world.entities[i];
    if (!e.is_consumable && e.species_id !== 1019 /* teleporter handled elsewhere */) {
      // Only auto-trigger flagged consumables.
      if (!isAutoTrigger(e)) continue;
    }
    if (!isAutoTrigger(e)) continue;
    const f = e.frame; if (!f) continue;
    if (player.tileX < f.x || player.tileX >= f.x + f.w) continue;
    if (player.tileY < f.y || player.tileY >= f.y + f.h) continue;
    world.entities.splice(i, 1);
    trigger(e);
    return;
  }
}

function isAutoTrigger(e) {
  if (!e.is_consumable) return false;
  // Teleporters are consumable in the data but we treat them in transitions.js.
  if (e.species_id === 1019) return false;
  return true;
}

function trigger(e) {
  const lines = resolveEntityDialogue(e);
  if (lines && lines.length) {
    playSfx("pickup", { volume: 0.6 });
    showDialogue(lines);
  } else {
    playSfx("pickup", { volume: 0.7 });
  }
}
