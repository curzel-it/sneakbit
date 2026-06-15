// One mutually-exclusive loot roll per death: nothing / coins / ammo. Monsters
// and barrels use different odds. This replaces the old standalone coin roll at
// the kill site (combat.js) so a single death never yields both coins and ammo.
// Coins keep their tier-scaled amount; ammo is delegated to ammoDrops.js. No-op
// outside the real game (PvP / creative), matching coin drops.

import { getSpecies } from "./species.js";
import { isExplosive } from "./explosives.js";
import { isPvp } from "./gameMode.js";
import { isCreativeMode } from "./creativeMode.js";
import { dropCoins } from "./coinDrops.js";
import { dropAmmo } from "./ammoDrops.js";

// Cumulative thresholds over a single rng() in [0,1).
//   monsters: 40% nothing · 40% coins · 20% ammo
//   barrels:  60% nothing · 30% coins · 10% ammo (barrels far outnumber the
//             kunai budget, so their ammo share is lower — see docs/ammo-drops.md)
const MONSTER = { nothing: 0.40, coin: 0.80 };
const BARREL = { nothing: 0.60, coin: 0.90 };

// "nothing" | "coin" | "ammo" for this dead species. Only monsters and barrels
// drop; anything else (NPCs, props) yields nothing. Pure given an injected rng.
export function rollLootCategory(species, rng = Math.random) {
  if (!species) return "nothing";
  const barrel = isExplosive(species.id);
  if (!barrel && species.entity_type !== "CloseCombatMonster") return "nothing";
  const t = barrel ? BARREL : MONSTER;
  const r = rng();
  if (r < t.nothing) return "nothing";
  if (r < t.coin) return "coin";
  return "ammo";
}

// Roll and apply a dead entity's loot. `killerIndex` is the player whose bullet
// landed the kill (drives weapon-aware ammo type). Mutates zone.entities.
export function maybeDropLoot(zone, entity, killerIndex = 0, rng = Math.random) {
  if (!zone?.entities || !entity) return;
  if (isPvp() || isCreativeMode()) return;
  const sp = getSpecies(entity.species_id);
  const category = rollLootCategory(sp, rng);
  if (category === "coin") {
    const count = isExplosive(sp.id) ? 1 : (sp.coin_drop_amount ?? 1);
    dropCoins(zone, entity, count, rng);
  } else if (category === "ammo") {
    dropAmmo(zone, entity, killerIndex, rng);
  }
}
