// Ammo drops: when a monster or barrel dies in the real game it may drop a few
// rounds of ammo for a weapon the killer can actually use, scattered like coins.
// Mirrors coinDrops.js (and shares its scatter); like coins the pickups are
// ephemeral — auto-collected by pickups.js (Bullet is an auto-pickup type) and
// never persisted. The coin-vs-ammo-vs-nothing decision lives in lootDrops.js;
// this module owns only the ammo case: how much, which type, and the scatter.

import { getSpecies } from "./species.js";
import { isExplosive } from "./explosives.js";
import { scatterPickups } from "./coinDrops.js";
import { weaponsInSlot } from "./weaponSlots.js";
import { SLOT_RANGED } from "./equipment.js";

const KUNAI = 7000;
const AR15 = 1169;
const CANNON = 1170;

// Dropped ammo is always single rounds of a bullet species (the ×10 bundles
// stay hand-authored). Generated pickups take their own negative id band, clear
// of coins (−2M) and generated monsters (−9M), so ids never collide.
let nextAmmoId = -8_000_000;

// Relative likelihood of each ammo type when the killer owns the matching
// ranged weapon — kunai is the staple, cannon the rare treat.
const TYPE_WEIGHT = { [KUNAI]: 6, [AR15]: 3, [CANNON]: 1 };

export function makeAmmoDrop(speciesId, tileX, tileY) {
  return {
    id: nextAmmoId--,
    species_id: speciesId,
    _ephemeral: true,
    direction: "None",
    is_consumable: false,
    frame: { x: tileX, y: tileY, w: 1, h: 1 },
    dialogues: [],
  };
}

// Rounds a dead entity drops when its roll lands on "ammo": barrels give 1;
// monsters give half their coin amount (floored at 1), so the size still scales
// with tier through fusion. Pure + testable.
export function ammoDropAmount(species) {
  if (!species) return 0;
  if (isExplosive(species.id)) return 1;
  const coin = species.coin_drop_amount ?? 1;
  return Math.max(1, Math.floor(coin / 2));
}

// Which ammo to drop: a weighted pick among the ranged weapons the killer owns
// (kunai > AR-15 > cannon), so we never drop ammo the player can't fire.
// Defaults to kunai (everyone owns the launcher) when ownership is unknown —
// e.g. a co-op guest's loadout the host can't see. Pure given an injected rng.
export function pickAmmoType(killerIndex = 0, rng = Math.random) {
  const owned = [];
  try {
    for (const w of weaponsInSlot(SLOT_RANGED, killerIndex | 0)) {
      const b = w?.species?.bullet_species_id;
      if (b && TYPE_WEIGHT[b] && !owned.includes(b)) owned.push(b);
    }
  } catch { /* fall through to the kunai default */ }
  if (!owned.length) return KUNAI;

  let total = 0;
  for (const id of owned) total += TYPE_WEIGHT[id];
  let r = rng() * total;
  for (const id of owned) {
    r -= TYPE_WEIGHT[id];
    if (r < 0) return id;
  }
  return owned[owned.length - 1];
}

// Scatter this entity's ammo reward (the gate already decided "ammo"). No-op if
// the species drops nothing. Mutates zone.entities.
export function dropAmmo(zone, entity, killerIndex = 0, rng = Math.random) {
  const count = ammoDropAmount(getSpecies(entity?.species_id));
  if (count <= 0) return;
  const speciesId = pickAmmoType(killerIndex, rng);
  scatterPickups(zone, entity, count, (x, y) => makeAmmoDrop(speciesId, x, y), rng);
}
