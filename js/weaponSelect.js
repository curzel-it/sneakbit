// Quick weapon-switch: a single input equips the next/previous weapon in
// one slot, live (no pause). Ranged and melee are independent slots with
// their own prev/next bindings (the only model that fits a game where both
// slots are equipped at once and fired by different keys). The ranged
// shoulder pair (RB/LB) makes this most useful on a controller — there's
// otherwise no fast way to re-equip without opening the pause menu. The
// ammo HUD already follows the equipped ranged weapon, so the swap shows
// up there with no overlay of its own.
//
// Equipping is a bare setEquipped(): host/guest loadout sync both listen
// on onEquipmentChange, so a local switch propagates in every mode with
// no extra wiring here.

import { nextWeaponInSlot } from "./weaponSlots.js";
import { setEquipped, SLOT_RANGED, SLOT_MELEE } from "./equipment.js";
import { resolveAction } from "./keyBindings.js";
import { localPlayerCount } from "./coopMode.js";
import { isPvp } from "./gameMode.js";
import { isPlayerDead } from "./playerHealth.js";

// action id → [slot, direction]
const ACTION_MAP = {
  rangedNext: [SLOT_RANGED, +1],
  rangedPrev: [SLOT_RANGED, -1],
  meleeNext:  [SLOT_MELEE,  +1],
  meleePrev:  [SLOT_MELEE,  -1],
};

// Whether an overlay (pause menu, dialogue, …) is up — a stray Tab behind
// the menu shouldn't silently swap your gun. Injected by main.js, which
// already owns that set, so this feature doesn't reach into six UI modules.
let isBlocked = () => false;

// Equip the next/previous weapon in `slot` for the given local player.
// No-op in PvP, while dead, while an overlay is open, or when the slot has
// fewer than 2 weapons.
export function cycleWeapon(slot, playerIndex = 0, dir = +1) {
  if (isPvp()) return;
  if (isBlocked()) return;
  if (isPlayerDead(playerIndex)) return;
  const id = nextWeaponInSlot(slot, playerIndex, dir);
  if (id == null) return;
  setEquipped(slot, id, playerIndex); // sync handled via onEquipmentChange
}

let installed = false;

// opts.isBlocked: () => boolean — true while a blocking overlay is open.
export function installWeaponSelect(opts = {}) {
  if (typeof opts.isBlocked === "function") isBlocked = opts.isBlocked;
  if (installed) return;
  installed = true;
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", onKey);
}

function onKey(e) {
  if (e.repeat) return; // edge-trigger: ignore OS auto-repeat so holding doesn't spin
  if (isBlocked()) return;
  const r = resolveAction(e.code);
  if (!r) return;
  const map = ACTION_MAP[r.action];
  if (!map) return;
  // Only route to a local player slot that's actually active (same gate as input.js).
  if (r.playerIndex >= 1 && (r.playerIndex + 1) > localPlayerCount()) return;
  e.preventDefault(); // Tab must not walk DOM focus
  cycleWeapon(map[0], r.playerIndex, map[1]);
}
