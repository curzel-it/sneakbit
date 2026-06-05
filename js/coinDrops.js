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
import { isWalkable, isEntityBlocked } from "./zone.js";
import { isTowerDefenseMode, isPvp } from "./gameMode.js";
import { isCreativeMode } from "./creativeMode.js";
import { isExplosive } from "./explosives.js";

export const COIN_SPECIES_ID = 2010;

// Coin pickups get ids well below any hand-placed entity so they never collide
// with authored ids; the `_ephemeral` flag tells checkPickup not to persist an
// `item_collected` flag for them (that's for level-authored loot).
let nextCoinId = -2_000_000;

// Barrels aren't monsters, but the hero can shoot them apart — reward that with
// an occasional coin pop on its own weighted table. Cumulative thresholds over a
// single rng() in [0,1): mostly nothing, usually a single coin, rare bigger
// pours. Chances: 50%→0, 37%→1, 8%→2, 4%→5, 1%→10 (sums to 1.0).
const BARREL_COIN_TABLE = Object.freeze([
  { upTo: 0.5, coins: 0 },
  { upTo: 0.87, coins: 1 },
  { upTo: 0.95, coins: 2 },
  { upTo: 0.99, coins: 5 },
  { upTo: 1.0, coins: 10 },
]);

function rollBarrelCoinDrop(rng) {
  const r = rng();
  for (const tier of BARREL_COIN_TABLE) {
    if (r < tier.upTo) return tier.coins;
  }
  return 10; // rng() never returns 1, but never strand a roll uncounted.
}

// Pure + testable: how many coins this species drops on death. Returns 0 for a
// non-monster or a failed roll. `rng` is injectable for deterministic tests;
// defaults to Math.random.
export function rollCoinDrop(species, rng = Math.random) {
  if (!species) return 0;
  // Explosive barrels are StaticObjects, not CloseCombatMonsters, so they take
  // the dedicated barrel table rather than the per-species chance/amount fields.
  if (isExplosive(species.id)) return rollBarrelCoinDrop(rng);
  if (species.entity_type !== "CloseCombatMonster") return 0;
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

// How far nearestFreeTile will spiral out from the kill tile before giving up.
const MAX_SCATTER_RADIUS = 3;

// A coin must land where the hero can actually stand to grab it: walkable
// ground (biome + construction collision) AND clear of rigid props. This is the
// same pair of checks the player and co-op spawner walk against — a coin on a
// wall, in water, or inside a building is uncollectable. The dying barrel /
// monster is already flagged `_dying`, so isEntityBlocked ignores its own tile.
function isFreeTile(zone, x, y) {
  return isWalkable(zone, x, y) && !isEntityBlocked(zone, x, y);
}

// Pick a tile within ±1 of the corpse. If the random pick isn't free, spiral
// out from the corpse for the nearest tile that is, so a coin is never stranded
// where the hero can't step.
function scatterTile(zone, cx, cy, homeX, homeY, rng) {
  const ox = Math.round((rng() - 0.5) * 2); // -1..1
  const oy = Math.round((rng() - 0.5) * 2);
  const tx = Math.floor(cx) + ox;
  const ty = Math.floor(cy) + oy;
  if (isFreeTile(zone, tx, ty)) return { x: tx, y: ty };
  return nearestFreeTile(zone, homeX, homeY);
}

// Spiral outward (ring by ring) from the kill tile and return the first free
// tile found. Falls back to the home tile itself if nothing within
// MAX_SCATTER_RADIUS is free, so the coin still spawns rather than vanishing.
function nearestFreeTile(zone, homeX, homeY) {
  if (isFreeTile(zone, homeX, homeY)) return { x: homeX, y: homeY };
  for (let r = 1; r <= MAX_SCATTER_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const x = homeX + dx;
        const y = homeY + dy;
        if (isFreeTile(zone, x, y)) return { x, y };
      }
    }
  }
  return { x: homeX, y: homeY };
}

// Cosmetic sub-tile offset so coins that land on the same tile (common for a
// big drop like the grapevine's 20) fan out instead of stacking into one
// sprite. Derived purely from the coin's id — which is shipped in the co-op
// snapshot — so host and guest compute the identical offset with no extra
// state to sync. Returns null for anything that isn't a coin. The pickup
// hitbox is unaffected: it still keys off the integer frame.x/y.
const OFF_X = 0.12;
const OFF_Y = 0.1;
export function coinRenderOffset(entity) {
  if (!entity || entity.species_id !== COIN_SPECIES_ID) return null;
  const n = Math.abs(entity.id | 0);
  return {
    x: ((n % 3) - 1) * OFF_X,
    y: ((Math.floor(n / 3) % 3) - 1) * OFF_Y,
  };
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
