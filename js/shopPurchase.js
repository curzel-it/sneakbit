// Shop purchase logic — pure, DOM-free, unit-testable. The shop UI
// (js/shop.js) renders and routes input; this module owns the rules:
// what's stackable, what you already own, what you can afford, and the
// actual spend-then-grant transaction. Mirrors the floor-pickup path in
// pickups.js so a bought item behaves exactly like a found one.
//
// Stock entries come from a clerk's `shop_stock` array in zone data:
//   { item: <species id>, price: <coins>, stackable?: <bool override> }

import { getSpecies } from "./species.js";
import { getCoins, addCoins } from "./wallet.js";
import { addAmmo, getAmmo } from "./inventory.js";
import { setEquipped, SLOT_MELEE, SLOT_RANGED } from "./equipment.js";

// Hard ceiling on a single purchase; the wallet clamps it further down.
export const MAX_PURCHASE_QTY = 99;

// A good is "stackable" (quantity-selectable) when it's ammo — a Bundle or
// a raw Bullet. Weapons and other one-of-a-kind pickups are not. An explicit
// `stackable` on the stock entry overrides the species-derived default.
export function isStackable(entry) {
  if (entry && typeof entry.stackable === "boolean") return entry.stackable;
  const sp = getSpecies(entry?.item);
  return sp?.entity_type === "Bundle" || sp?.entity_type === "Bullet";
}

// The equip slot an inventory item grants, or null if it isn't a weapon item.
// Mirrors weaponSlots.js: a weapon item carries `associated_weapon` pointing
// at a WeaponMelee/WeaponRanged species.
export function weaponSlotForItem(itemId) {
  const sp = getSpecies(itemId);
  const w = sp?.associated_weapon;
  if (!w) return null;
  const wsp = getSpecies(w);
  if (wsp?.entity_type === "WeaponMelee") return SLOT_MELEE;
  if (wsp?.entity_type === "WeaponRanged") return SLOT_RANGED;
  return null;
}

export function isWeaponItem(itemId) {
  return weaponSlotForItem(itemId) !== null;
}

// One-of-a-kind goods (weapon items) you already hold can't be re-bought.
// Ownership is derived exactly as weaponSlots derives it — you hold the
// granting item. Non-weapon goods are never "owned" (always re-buyable).
export function isOwned(itemId, playerIndex = 0) {
  if (!isWeaponItem(itemId)) return false;
  return getAmmo(itemId, playerIndex) > 0;
}

// Largest quantity the wallet can afford, clamped to [0, cap]. Free goods
// (price <= 0) clamp straight to the cap.
export function maxAffordable(price, playerIndex = 0, cap = MAX_PURCHASE_QTY) {
  const p = price | 0;
  if (p <= 0) return cap;
  return Math.max(0, Math.min(cap, Math.floor(getCoins(playerIndex) / p)));
}

// Clamp a requested quantity to what's valid for this good: 0 if owned or
// unaffordable, 1 for one-of-a-kind goods, else [1, maxAffordable].
export function clampQty(entry, requested, playerIndex = 0) {
  if (isOwned(entry?.item, playerIndex)) return 0;
  if (!isStackable(entry)) return maxAffordable(entry?.price, playerIndex, 1);
  const max = maxAffordable(entry?.price, playerIndex);
  if (max <= 0) return 0;
  return Math.max(1, Math.min(max, requested | 0));
}

// Validate a prospective purchase. Returns { ok, reason } — reason is one of
// "invalid" | "quantity" | "owned" | "poor" when ok is false.
export function canBuy(entry, qty, playerIndex = 0) {
  if (!entry || !getSpecies(entry.item)) return { ok: false, reason: "invalid" };
  const n = qty | 0;
  if (n < 1) return { ok: false, reason: "quantity" };
  if (!isStackable(entry) && n > 1) return { ok: false, reason: "quantity" };
  if (isOwned(entry.item, playerIndex)) return { ok: false, reason: "owned" };
  const total = (entry.price | 0) * n;
  if (getCoins(playerIndex) < total) return { ok: false, reason: "poor" };
  return { ok: true };
}

// Grant `qty` units of a stock item, mirroring the floor-pickup path in
// pickups.js: a Bundle expands into its contents (one kunai.x10 → 10 kunai),
// anything else lands as one count per unit. Weapon items auto-equip.
function grant(itemId, qty, playerIndex) {
  const sp = getSpecies(itemId);
  for (let i = 0; i < qty; i++) {
    if (sp?.bundle_contents?.length) {
      const counts = new Map();
      for (const cid of sp.bundle_contents) counts.set(cid, (counts.get(cid) || 0) + 1);
      for (const [cid, n] of counts) addAmmo(cid, n, playerIndex);
    } else {
      addAmmo(itemId, 1, playerIndex);
    }
  }
  const slot = weaponSlotForItem(itemId);
  if (slot) setEquipped(slot, sp.associated_weapon, playerIndex);
}

// Execute a purchase after validation. Spends coins, then grants the goods.
// Charges nothing and returns the failing verdict if canBuy rejects.
export function buy(entry, qty, playerIndex = 0) {
  const verdict = canBuy(entry, qty, playerIndex);
  if (!verdict.ok) return verdict;
  const n = qty | 0;
  const total = (entry.price | 0) * n;
  addCoins(-total, playerIndex);
  grant(entry.item, n, playerIndex);
  return { ok: true, spent: total, qty: n };
}
