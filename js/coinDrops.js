// Coin drops: when a monster dies in the real game, roll its species' drop and
// scatter individual coins on the ground for the hero to collect.
//
// "N separate coins": a monster worth N coins drops N identical 1-value
// PickableObject coins around its corpse — there is no per-entity value to
// track, which keeps co-op sync trivial (each coin is just a vanilla pickup).
//
// Host-side only: maybeDropCoin runs where the kill resolves (combat.js), so
// the scatter RNG never runs on a guest, and the spawned coins reach guests
// through the normal zone-entity snapshot. Gated out of Tower Defense (its own
// gold), PvP (no monsters) and creative (arranging the world, not farming).

import { getSpecies } from "./species.js";
import { isWalkable } from "./zone.js";
import { isTowerDefenseMode, isPvp } from "./gameMode.js";
import { isCreativeMode } from "./creativeMode.js";

export const COIN_SPECIES_ID = 2010;

// Coin pickups get ids well below any hand-placed entity so they never collide
// with authored ids; the `_ephemeral` flag tells checkPickup not to persist an
// `item_collected` flag for them (that's for level-authored loot).
let nextCoinId = -2_000_000;

// Pure + testable: how many coins this species drops on death. Returns 0 for a
// non-monster or a failed roll. `rng` is injectable for deterministic tests;
// defaults to Math.random.
export function rollCoinDrop(species, rng = Math.random) {
  if (!species || species.entity_type !== "CloseCombatMonster") return 0;
  const chance = species.coin_drop_chance ?? 0.5;
  const amount = species.coin_drop_amount ?? 1;
  if (chance <= 0 || amount <= 0) return 0;
  if (rng() >= chance) return 0;
  return amount | 0;
}

// Roll the dead entity's species and scatter that many coins around its
// footprint. No-op outside the real game. Mutates zone.entities.
export function maybeDropCoin(zone, entity, rng = Math.random) {
  if (!zone?.entities || !entity) return;
  if (isTowerDefenseMode() || isPvp() || isCreativeMode()) return;
  const count = rollCoinDrop(getSpecies(entity.species_id), rng);
  if (count <= 0) return;
  const f = entity.frame || { x: 0, y: 0, w: 1, h: 1 };
  const cx = f.x + (f.w || 1) * 0.5;
  const cy = f.y + (f.h || 1) * 0.5;
  const homeX = Math.floor(cx);
  const homeY = Math.floor(cy);
  for (let i = 0; i < count; i++) {
    const t = scatterTile(zone, cx, cy, homeX, homeY, rng);
    zone.entities.push(makeCoin(t.x, t.y));
  }
}

// Pick a tile within ±1 of the corpse, falling back to the corpse's own tile
// when the random pick would land somewhere unwalkable (wall / water / void)
// so a coin is never stranded where the hero can't step.
function scatterTile(zone, cx, cy, homeX, homeY, rng) {
  const ox = Math.round((rng() - 0.5) * 2); // -1..1
  const oy = Math.round((rng() - 0.5) * 2);
  const tx = Math.floor(cx) + ox;
  const ty = Math.floor(cy) + oy;
  if (isWalkable(zone, tx, ty)) return { x: tx, y: ty };
  return { x: homeX, y: homeY };
}

function makeCoin(tileX, tileY) {
  return {
    id: nextCoinId--,
    species_id: COIN_SPECIES_ID,
    _ephemeral: true,
    direction: "None",
    is_consumable: false,
    frame: { x: tileX, y: tileY, w: 1, h: 1 },
    dialogues: [],
  };
}
