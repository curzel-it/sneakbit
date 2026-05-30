// Pickups + hints: when one of the live players snaps onto an auto-
// triggered entity we fire its effect and remove it from the zone.
//
// Hint entities (consumable variant) show their dialogue, then vanish.
// Bundles and PickableObjects play a pickup SFX and vanish; the ammo
// goes into the picking-up player's inventory, and weapon pickups equip
// into that player's slot. Teleporters are handled in transitions.js so
// they can fade between zones.
//
// Co-op rule: iterate every live player and the first one whose tile
// overlaps a pickup wins it. Single-player just passes one player.

import { resolveEntityDialogue, dialogueLines } from "./dialogue.js?v=20260530f";
import { showToast } from "./toast.js?v=20260530f";
import { playSfx } from "./audio.js?v=20260530f";
import { getSpecies } from "./species.js?v=20260530f";
import { addAmmo, getAmmo } from "./inventory.js?v=20260530f";
import { getValue, setValue } from "./storage.js?v=20260530f";
import { setEquipped, SLOT_MELEE, SLOT_RANGED } from "./equipment.js?v=20260530f";
import {
  setSessionLoadout,
  getSessionLoadout,
} from "./sessionLoadouts.js?v=20260530f";
import { tr } from "./strings.js?v=20260530f";
import { shouldBeVisible } from "./entityVisibility.js?v=20260530f";
import { isCreativeMode } from "./creativeMode.js?v=20260530f";
import { isPlayerDead } from "./playerHealth.js?v=20260530f";
import { broadcastHostEvent } from "./hostEvents.js?v=20260530f";
import { isPvp } from "./gameMode.js?v=20260530f";
import { addPvpAmmo, setPvpRangedWeapon } from "./pvpLoadout.js?v=20260530f";

// Bullet is here because in zone data, placed Bullets (speed=0) act as
// stationary collectibles — same rule as the original Rust core. Bundles
// expand into N copies of their bundle_contents species (e.g. one
// "kunai.x10" gives 10 kunai). Player-spawned bullets carry _spawned and
// are explicitly excluded so the kunai you just threw doesn't immediately
// re-collect itself.
const AUTO_PICKUP_TYPES = new Set(["Bundle", "PickableObject", "Bullet"]);

export function checkPickup(state) {
  const { zone } = state;
  if (!zone.entities) return;
  // Creative mode never auto-collects: pickups stay on the floor (so
  // the designer can keep arranging them), and hint signs don't fire
  // their toast (toast suppression also matches the re-skinned sprite
  // they get in creative). Mirrors Rust update_pickable_object and
  // hint handling early-returning in creative.
  if (isCreativeMode()) return;
  const players = livePlayers(state);
  if (!players.length) return;

  for (let i = 0; i < zone.entities.length; i++) {
    const e = zone.entities[i];
    if (e._spawned) continue;
    if (!shouldBeVisible(e)) continue;
    const kind = classify(e);
    if (!kind) continue;
    const f = e.frame; if (!f) continue;
    const picker = players.find(p =>
      p.tileX >= f.x && p.tileX < f.x + f.w &&
      p.tileY >= f.y && p.tileY < f.y + f.h
    );
    if (!picker) continue;
    if (kind === "hint-persistent") {
      // Non-consumable hint: show the toast (once per text), don't despawn.
      triggerHint(e, /* persist */ true);
    } else {
      zone.entities.splice(i, 1);
      if (e.id != null && !zone.ephemeralState) {
        setValue(`item_collected.${e.id}`, 1);
      }
      trigger(e, kind, picker);
    }
    return;
  }
}

function livePlayers(state) {
  const arr = [];
  if (state.player && !isPlayerDead(state.player.index | 0)) arr.push(state.player);
  if (state.player2 && !isPlayerDead(state.player2.index | 0)) arr.push(state.player2);
  if (Array.isArray(state.players)) {
    for (const s of state.players) {
      if (s.player && !isPlayerDead(s.player.index | 0)) arr.push(s.player);
    }
  }
  return arr;
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

function trigger(e, kind, picker) {
  if (kind === "hint") {
    triggerHint(e, /* persist */ false);
    return;
  }
  const playerIndex = picker?.index | 0;
  const sp = getSpecies(e.species_id);

  // PvP scavenging: weapon crates swap the picker's equipped ranged weapon;
  // ammo crates fill the matching caliber in the picker's per-player pool
  // (pvpLoadout.js). The persisted inventory is never touched.
  if (isPvp()) {
    const weaponId = sp?.associated_weapon;
    const weaponSp = weaponId ? getSpecies(weaponId) : null;
    if (weaponSp?.entity_type === "WeaponRanged") {
      setPvpRangedWeapon(playerIndex, weaponId);
      playSfx("ammoCollected");
      if (playerIndex === 0) {
        const name = tr(weaponSp.name) || weaponSp.name || "weapon";
        showToast(`Equipped: ${name}`, "longHint", { image: inventoryIconFor(weaponSp) });
      }
    } else if (sp?.bundle_contents?.length) {
      const counts = new Map();
      for (const cid of sp.bundle_contents) counts.set(cid, (counts.get(cid) || 0) + 1);
      for (const [cid, n] of counts) addPvpAmmo(playerIndex, cid, n);
      playSfx("ammoCollected");
    } else if (sp?.entity_type === "Bullet") {
      addPvpAmmo(playerIndex, e.species_id, 1);
      playSfx("ammoCollected");
    }
    return;
  }

  const items = [];
  if (sp?.bundle_contents?.length) {
    const counts = new Map();
    for (const cid of sp.bundle_contents) counts.set(cid, (counts.get(cid) || 0) + 1);
    for (const [cid, n] of counts) {
      addAmmo(cid, n, playerIndex);
      items.push({ speciesId: cid, amount: n });
    }
  } else {
    addAmmo(e.species_id, 1, playerIndex);
    items.push({ speciesId: e.species_id, amount: 1 });
  }
  playSfx("ammoCollected");
  maybeEquipWeapon(sp, picker);
  // Per-player inventory in online co-op: the picker.playerId tag lets
  // the matching guest's handler addAmmo into their own counts; other
  // clients see the event but skip the inventory side-effect.
  broadcastHostEvent("pickup", { playerId: picker?.playerId ?? null, items });
  // Also push absolute counts via ammoSet so the picker's HUD adopts the
  // host's authoritative pool (covers any drift between pickup deltas
  // and shoot consumptions the guest may have missed).
  if (picker?.playerId) {
    const after = items.map(({ speciesId }) => ({
      speciesId,
      count: getAmmo(speciesId, picker.index | 0),
    }));
    broadcastHostEvent("ammoSet", { playerId: picker.playerId, items: after });
  }
}

// When a pickup is associated with a weapon (sword pickup → sword,
// AR15 pickup → AR15, …) auto-equip it into the matching slot so the
// player can immediately see — and use — the weapon they just grabbed.
// Mirrors how `available_weapons` in Rust surfaces a weapon as soon as
// its pickup species lands in the inventory, with the JS twist that
// we equip it directly instead of opening a chooser (no inventory UI yet).
//
// In online co-op:
//   * For the host's own pickups (picker is local index 0) we still hit
//     setEquipped(0), which writes to the host's save AND drives the
//     onEquipmentChange path in hostLoadoutSync that fans event:loadout.
//   * For a guest's pickup we update the session map for the picker's
//     playerId and broadcast event:loadout directly — the guest's local
//     equipment store is the authoritative save for the guest, not the
//     host's, so we don't touch setEquipped here. guestLoadoutSync
//     writes the new id into the guest's local storage when the event
//     arrives, so the pickup persists past the session.
function maybeEquipWeapon(pickupSp, picker) {
  if (!pickupSp) return;
  const weaponId = pickupSp.associated_weapon;
  if (!weaponId) return;
  const weaponSp = getSpecies(weaponId);
  if (!weaponSp) return;
  let slot = null;
  let hint = "";
  if (weaponSp.entity_type === "WeaponMelee")  { slot = SLOT_MELEE;  hint = "Press G to swing"; }
  if (weaponSp.entity_type === "WeaponRanged") { slot = SLOT_RANGED; hint = "Press F to shoot"; }
  if (!slot) return;
  const playerIndex = picker?.index | 0;
  const pickerId = picker?.playerId || null;
  if (playerIndex === 0 || !pickerId) {
    setEquipped(slot, weaponId, playerIndex);
  } else {
    const prev = getSessionLoadout(pickerId) || { melee: null, ranged: null };
    const next = {
      melee: slot === SLOT_MELEE ? weaponId : prev.melee,
      ranged: slot === SLOT_RANGED ? weaponId : prev.ranged,
    };
    setSessionLoadout(pickerId, next.melee, next.ranged);
    broadcastHostEvent("loadout", {
      playerId: pickerId,
      melee: next.melee,
      ranged: next.ranged,
    });
  }
  const name = tr(weaponSp.name) || weaponSp.name || "weapon";
  // Local "you got a weapon" toast only fires on the host's machine for
  // the host's own pickup — a guest's auto-equip surfaces on the guest's
  // own client via guestLoadoutSync's write-through (which is what their
  // user is looking at).
  if (playerIndex === 0) {
    showToast(`Equipped: ${name}\n${hint}`, "longHint", {
      image: inventoryIconFor(weaponSp),
    });
  }
}

// Builds the ToastImage payload for a species' inventory icon. Returns
// null if the species has no inventory_texture_offset. Mirrors Rust
// ToastImage::static_image(species.inventory_sprite_frame(), SHEET_INVENTORY).
function inventoryIconFor(sp) {
  const off = sp?.inventory_texture_offset;
  if (!off) return null;
  const TILE = 16;
  return {
    url: "./assets/inventory.png",
    // inventory_texture_offset is [row, col] in Rust.
    sx: (off[1] | 0) * TILE,
    sy: (off[0] | 0) * TILE,
    sw: TILE,
    sh: TILE,
    renderSize: 32,
  };
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
