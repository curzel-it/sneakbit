// Summoning-circle dismissal: the player is summoned into the world standing
// on the big magic circle at the start of zone 1001 (Evergrove). A couple of
// seconds after arriving it puffs out of existence — the summoning is done —
// rather than sitting there forever.
//
// This reuses the fade vanish from vanishEffect.js — a plain fade-out with no
// smoke puff layered on top (the puff reads as a smoke bomb, which it isn't);
// once the fade plays out tickVanish (driven from tickAfterDialogue) removes
// the entity. We persist the removal
// under `item_collected.<id>` so the circle stays gone on later visits, exactly
// like a collected item.

import { STARTING_ZONE_ID } from "./constants.js";
import { startVanish } from "./vanishEffect.js";
import { getValue, setValue } from "./storage.js";
import { isCreativeMode } from "./creativeMode.js";

// objects.name.magic_circle.summoning — the 3×3 circle the hero spawns on.
const SUMMONING_CIRCLE_SPECIES = 11000;
const DISMISS_DELAY = 2.0; // seconds on the circle before it fades away

let armedId = null;
let elapsed = 0;

// Driven once per frame from main.js. Counts up while the summoning circle is
// on screen in zone 1001, then fades it out. A no-op everywhere else.
export function tickSummoningCircle(zone, dt) {
  // Creative mode keeps every placed entity visible for the designer, so never
  // dismiss the circle there (mirrors how the after-dialogue exits bail out in
  // creative).
  if (isCreativeMode() || zone?.id !== STARTING_ZONE_ID) {
    armedId = null; elapsed = 0;
    return;
  }
  const circle = (zone.entities || []).find(e =>
    e.species_id === SUMMONING_CIRCLE_SPECIES &&
    e.id != null &&
    !e._vanish &&
    getValue(`item_collected.${e.id}`) !== 1);
  if (!circle) { armedId = null; elapsed = 0; return; }

  if (armedId !== circle.id) { armedId = circle.id; elapsed = 0; }
  elapsed += dt;
  if (elapsed < DISMISS_DELAY) return;

  startVanish(circle, "fade", () => {
    if (!zone.ephemeralState && circle.id != null) {
      setValue(`item_collected.${circle.id}`, 1);
    }
  });
  armedId = null; elapsed = 0;
}
