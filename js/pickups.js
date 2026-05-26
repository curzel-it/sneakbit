// Pickups + hints: when the player snaps onto an auto-triggered entity we
// fire its effect and remove it from the world.
//
// Hint entities (consumable variant) show their dialogue, then vanish.
// Bundles and PickableObjects play a pickup SFX and vanish (no inventory
// yet — we'll wire that when combat lands). Teleporters are handled in
// transitions.js so they can fade between worlds.

import { resolveEntityDialogue, dialogueLines } from "./dialogue.js";
import { showToast } from "./toast.js";
import { playSfx } from "./audio.js";
import { getSpecies } from "./species.js";
import { addAmmo } from "./inventory.js";

// Bullet is here because in world data, placed Bullets (speed=0) act as
// stationary collectibles — same rule as the original Rust core. Bundles
// expand into N copies of their bundle_contents species (e.g. one
// "kunai.x10" gives 10 kunai). Player-spawned bullets carry _spawned and
// are explicitly excluded so the kunai you just threw doesn't immediately
// re-collect itself.
const AUTO_PICKUP_TYPES = new Set(["Bundle", "PickableObject", "Bullet"]);

export function checkPickup(state) {
  const { world, player } = state;
  if (!world.entities) return;
  for (let i = 0; i < world.entities.length; i++) {
    const e = world.entities[i];
    if (e._spawned) continue;
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
    const dialogue = resolveEntityDialogue(e);
    const lines = dialogueLines(dialogue);
    playSfx("hintReceived");
    if (lines.length) showToast(lines.join("\n"), "hint");
    return;
  }
  const sp = getSpecies(e.species_id);
  if (sp?.bundle_contents?.length) {
    const counts = new Map();
    for (const cid of sp.bundle_contents) counts.set(cid, (counts.get(cid) || 0) + 1);
    for (const [cid, n] of counts) addAmmo(cid, n);
  } else {
    addAmmo(e.species_id, 1);
  }
  playSfx("ammoCollected");
}
