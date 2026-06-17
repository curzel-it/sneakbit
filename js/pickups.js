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

import { resolveEntityDialogue, dialogueLines } from "./dialogue.js";
import { showToast } from "./toast.js";
import { playSfx } from "./audio.js";
import { getSpecies } from "./species.js";
import { addAmmo, getAmmo } from "./inventory.js";
import { addCoins } from "./wallet.js";
import { COIN_SPECIES_ID } from "./coinDrops.js";
import { getValue, setValue } from "./storage.js";
import { setEquipped, SLOT_MELEE, SLOT_RANGED } from "./equipment.js";
import {
  setSessionLoadout,
  getSessionLoadout,
} from "./sessionLoadouts.js";
import { tr } from "./strings.js";
import { shouldBeVisible } from "./entityVisibility.js";
import { isCreativeMode } from "./creativeMode.js";
import { isPlayerDead } from "./playerHealth.js";
import { broadcastHostEvent } from "./hostEvents.js";
import { isPvp } from "./gameMode.js";
import { addPvpAmmo, setPvpRangedWeapon } from "./pvpLoadout.js";

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

  // Collect every overlapping pickup in this single pass, not just the first.
  // One tile routinely holds several coins (a big drop fans out cosmetically
  // but the coins share an integer tile), and checkPickup only runs when a
  // player changes tile — so stopping after one would strand the rest until
  // the player stepped off the tile and back onto it. Iterate backward so
  // splicing a collected entity never shifts an unprocessed one out of reach.
  for (let i = zone.entities.length - 1; i >= 0; i--) {
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
      triggerHint(e, /* persist */ true, picker);
    } else {
      zone.entities.splice(i, 1);
      // Runtime loot (coins) carries `_ephemeral` and a throwaway negative id —
      // never persist a collected flag for it (that key is for level-authored
      // pickups, so they don't respawn on zone reload).
      if (e.id != null && !e._ephemeral && !zone.ephemeralState) {
        setValue(`item_collected.${e.id}`, 1);
      }
      trigger(e, kind, picker);
    }
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
    triggerHint(e, /* persist */ false, picker);
    return;
  }
  const playerIndex = picker?.index | 0;
  const sp = getSpecies(e.species_id);

  // Coins: credit the picker's wallet and stop. No toast (you collect them by
  // the dozen — it would spam), no ammo/weapon handling. In online co-op the
  // host tells the picking guest to credit its own wallet via the `coins`
  // event; the host's own pickup just credits index 0 locally.
  if (e.species_id === COIN_SPECIES_ID) {
    addCoins(1, playerIndex);
    playSfx("keyCollected");
    broadcastHostEvent("coins", { playerId: picker?.playerId ?? null, amount: 1 });
    return;
  }

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
  // "Picked up X" toast for plain collectibles (ammo, keys, consumables).
  // Weapon pickups get their own "Equipped: …" toast in maybeEquipWeapon,
  // and coins are handled (toast-free) above — so skip both here. Local
  // index 0 only, mirroring the weapon toast: a guest sees its own pickups
  // on its own client, not the host's.
  //
  // Single thrown-ammo bullets (a lone kunai on the floor) are skipped too:
  // they're scattered by the dozen like coins, so a toast each would spam.
  // The "kunai.x10" bundle still toasts — it has bundle_contents.
  const singleBullet = sp?.entity_type === "Bullet" && !sp?.bundle_contents?.length;
  if (playerIndex === 0 && !sp?.associated_weapon && !singleBullet) {
    const name = tr(sp?.name) || sp?.name || "";
    showToast(tr("picked_up_item").replace("%s", name), "hint", {
      image: inventoryIconFor(sp),
    });
  }
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

// Renders the hint as a toast for whoever walked into it. For persistent hints
// (Rust is_consumable=false) we suppress repeats by storing a read-flag under
// "hint.read.<text>" — same storage key as Rust entities/hint.rs::set_hint_read.
// The flag persists across reloads so a hint the player has already seen never
// spams again.
//
// In online co-op the host runs every player's pickup loop, so a hint a GUEST
// stepped on must be shown on the guest's own screen, not the host's — send it
// as a toast addressed to that guest. The host's own avatar (index 0, no
// playerId) shows it locally with the hint sound.
function triggerHint(e, persist, picker) {
  const dialogue = resolveEntityDialogue(e);
  const lines = dialogueLines(dialogue);
  if (!lines.length) return;
  const text = lines.join("\n");
  if (persist) {
    const key = `hint.read.${text}`;
    if (getValue(key)) return;
    setValue(key, 1);
  }
  if (picker?.playerId) {
    broadcastHostEvent("toast", { text, toastType: "hint", playerId: picker.playerId });
    return;
  }
  playSfx("hintReceived");
  showToast(text, "hint");
}
