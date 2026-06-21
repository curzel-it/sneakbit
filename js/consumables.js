// Consumable inventory items: pickups you carry and "use" from the
// inventory screen to fire an effect — as opposed to weapons (which equip)
// or passive pickups (keys, coins). The registry keeps the inventory UI
// generic: a new potion becomes usable by adding one entry here, with no
// change to inventoryScreen.js.

import { getAmmo, removeAmmo } from "./inventory.js";
import { applyPlayerHeal, getPlayerHp, getPlayerMaxHp } from "./playerHealth.js";
import { playSfx } from "./audio.js";
import { getSpecies } from "./species.js";
import { showToast } from "./toast.js";
import { tr } from "./strings.js";
import { TILE_SIZE } from "./constants.js";
import { triggerGiant, isGiantIndex } from "./giantMode.js";
import { triggerSpeed, isSpeedActiveIndex } from "./speedMode.js";
import { triggerIce, isIceActiveIndex } from "./iceMode.js";
import { getNetRole } from "./onlineBootstrap.js";

const HEALTH_POTION_HEAL = 50;

// speciesId -> consumable definition.
//   verb    button label in the inventory list.
//   sfx     sound on a successful use (optional).
//   canUse  would using it right now actually do anything? Gates the button
//           so a potion isn't wasted (e.g. drinking a heal at full HP).
//   effect  runs after one unit is consumed.
const CONSUMABLES = {
  2020: {
    verb: "Drink",
    sfx: "playerResurrected",
    canUse: (idx) => getPlayerHp(idx) < getPlayerMaxHp(idx),
    effect: (idx) => applyPlayerHeal(HEALTH_POTION_HEAL, idx),
  },
  // Purple potion: restores all health (heal clamps to the missing amount).
  2021: {
    verb: "Drink",
    sfx: "playerResurrected",
    canUse: (idx) => getPlayerHp(idx) < getPlayerMaxHp(idx),
    effect: (idx) => applyPlayerHeal(getPlayerMaxHp(idx), idx),
  },
  // Yellow potion: grow to a towering 3×4 silhouette for a short while. Collision
  // stays normal-sized, but the giant gets two combat buffs — triple max HP
  // (playerHealth.maxHp) and bare-handed melee (melee.js). giantMode networks
  // the transform to every peer. Gated so it can't be re-taken while already a
  // giant. Topping the bar off to the new tripled max makes the survivability
  // buff felt immediately (it drains in over ~2s, like a potion).
  2024: {
    verb: "Drink",
    sfx: "playerResurrected",
    canUse: (idx) => !isGiantIndex(idx),
    effect: (idx) => { triggerGiant(idx); applyPlayerHeal(getPlayerMaxHp(idx), idx); },
  },
  // Silver potion: move at SPEED_MULTIPLIER× for SPEED_DURATION_MS (speedMode.js).
  // Online play is blocked — changing tile cadence desyncs networked peers, so
  // the buff is single-player / local co-op only and the button stays disabled
  // online (so the potion isn't wasted). Gated so it can't be re-drunk while
  // already sped up.
  2026: {
    verb: "Drink",
    sfx: "playerResurrected",
    canUse: (idx) => !getNetRole() && !isSpeedActiveIndex(idx),
    effect: (idx) => triggerSpeed(idx),
  },
  // Ice potion: for ICE_DURATION_MS every bullet the player fires freezes the
  // monsters it hits for a beat (freeze.js), and a frost aura renders under the
  // hero. Unlike the silver speed potion this is fully networked (iceMode.js
  // syncs the aura + per-monster frozen state to all peers), so it's NOT gated
  // online. Gated so it can't be re-drunk while already active.
  2025: {
    verb: "Drink",
    sfx: "playerResurrected",
    canUse: (idx) => !isIceActiveIndex(idx),
    effect: (idx) => triggerIce(idx),
  },
};

export function isConsumable(speciesId) {
  return !!CONSUMABLES[speciesId | 0];
}

export function consumableVerb(speciesId) {
  return CONSUMABLES[speciesId | 0]?.verb ?? "Use";
}

// True only when the player holds at least one and the effect would do
// something right now. Drives the button's enabled state.
export function canUseConsumable(speciesId, playerIndex = 0) {
  const def = CONSUMABLES[speciesId | 0];
  if (!def) return false;
  if (getAmmo(speciesId, playerIndex) <= 0) return false;
  return def.canUse ? def.canUse(playerIndex | 0) : true;
}

// Consume one unit and fire its effect. Returns true on success, false if
// the item isn't consumable, none are held, or it would have no effect
// right now (so the unit isn't wasted).
export function useConsumable(speciesId, playerIndex = 0) {
  const sid = speciesId | 0;
  const def = CONSUMABLES[sid];
  if (!canUseConsumable(sid, playerIndex)) return false;
  if (!removeAmmo(sid, 1, playerIndex)) return false;
  def.effect(playerIndex | 0);
  if (def.sfx) playSfx(def.sfx);
  const sp = getSpecies(sid);
  const name = tr(sp?.name) || sp?.name || "";
  showToast(tr("used_item").replace("%s", name), "hint", { image: inventoryIconFor(sp) });
  return true;
}

// Builds the ToastImage payload for a species' inventory icon, or null if
// the species has no inventory_texture_offset. Same source rect math as
// pickups.js / shop.js (inventory_texture_offset is [row, col]).
function inventoryIconFor(sp) {
  const off = sp?.inventory_texture_offset;
  if (!off) return null;
  return {
    url: "./assets/inventory.png",
    sx: (off[1] | 0) * TILE_SIZE,
    sy: (off[0] | 0) * TILE_SIZE,
    sw: TILE_SIZE,
    sh: TILE_SIZE,
    renderSize: 32,
  };
}
