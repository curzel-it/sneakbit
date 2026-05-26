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
import { getValue, setValue } from "./storage.js";
import { setEquipped, SLOT_MELEE, SLOT_RANGED } from "./equipment.js";
import { tr } from "./strings.js";

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
    if (kind === "hint-persistent") {
      // Non-consumable hint: show the toast (once per text), don't despawn.
      triggerHint(e, /* persist */ true);
    } else {
      world.entities.splice(i, 1);
      trigger(e, kind);
    }
    return;
  }
}

function classify(e) {
  const sp = getSpecies(e.species_id);
  if (!sp) return null;
  if (AUTO_PICKUP_TYPES.has(sp.entity_type)) return "pickup";
  if (sp.entity_type === "Hint") {
    return e.is_consumable ? "hint" : "hint-persistent";
  }
  return null;
}

function trigger(e, kind) {
  if (kind === "hint") {
    triggerHint(e, /* persist */ false);
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
  maybeEquipWeapon(sp);
}

// When a pickup is associated with a weapon (sword pickup → sword,
// AR15 pickup → AR15, …) auto-equip it into the matching slot so the
// player can immediately see — and use — the weapon they just grabbed.
// Mirrors how `available_weapons` in Rust surfaces a weapon as soon as
// its pickup species lands in the inventory, with the JS twist that
// we equip it directly instead of opening a chooser (no inventory UI yet).
function maybeEquipWeapon(pickupSp) {
  if (!pickupSp) return;
  const weaponId = pickupSp.associated_weapon;
  if (!weaponId) return;
  const weaponSp = getSpecies(weaponId);
  if (!weaponSp) return;
  let slot = null;
  if (weaponSp.entity_type === "WeaponMelee")  slot = SLOT_MELEE;
  if (weaponSp.entity_type === "WeaponRanged") slot = SLOT_RANGED;
  if (!slot) return;
  setEquipped(slot, weaponId);
  const name = tr(weaponSp.name) || weaponSp.name || "weapon";
  showToast(`Equipped: ${name}`, "hint");
}

// Renders the hint as a toast. For persistent hints (Rust is_consumable=false)
// we suppress repeats by storing a read-flag under "hint.read.<text>" — same
// storage key as Rust entities/hint.rs::set_hint_read. The flag persists
// across reloads so a hint the player has already seen never spams again.
function triggerHint(e, persist) {
  const dialogue = resolveEntityDialogue(e);
  const lines = dialogueLines(dialogue);
  if (!lines.length) return;
  const text = lines.join("\n");
  if (persist) {
    const key = `hint.read.${text}`;
    if (getValue(key)) return;
    setValue(key, 1);
  }
  playSfx("hintReceived");
  showToast(text, "hint");
}
