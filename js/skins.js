// Hero skins — cosmetic outfits. A skin only changes which column of the
// `heroes` sheet the hero draws from (see player.js getPlayerSpriteFrame); it
// never touches stats, hitbox, or gear. The default skin is always owned and
// free; the rest are bought with coins in the shop (shopPurchase.js) and
// equipped from the Skin slot in the inventory panel (inventoryScreen.js).
//
// Persistence (mirrors wallet.js / equipment.js key conventions):
//   * ownership: player.{i}.skin.owned.{skinId}  -> 1 when owned
//   * selection: player.{i}.skin.selected        -> the skin's stable `key`
//                                                    (null/absent = default)
// storage.js stores integers only, so selection is keyed by each skin's stable
// numeric `key` rather than its string id or catalog position.
//
// Co-op folding is deliberately split:
//   * OWNERSHIP folds like the wallet — local split-screen P2..P4 share P1's
//     closet (bought from the shared purse). Network co-op stays independent.
//   * SELECTION is per RAW index (never folded) so each local hero can wear a
//     different owned skin and stay visually distinct.

import { getValue, setValue } from "./storage.js";
import { isCoopMode } from "./coopMode.js";
import { skinFor as sessionSkinFor } from "./sessionSkins.js";

export const DEFAULT_SKIN_ID = "default";

// Hero sprite columns on the `heroes` sheet. Default renders the per-index
// column (P1=1, P2=5, P3=9, P4=13) so default-skin co-op players stay distinct.
const HERO_BASE_COLUMN = 1;
const HERO_COLUMN_STRIDE = 4;

// `key` is the stable storage id for selection (never renumber a shipped one).
// `column` is the heroes-sheet column; null = "use the per-index default".
// Columns confirmed against assets/heroes.png: 1/5/9/13/17/21 are the six hero
// blocks (default, red, yellow, blue outfits, black tracksuit, black ninja);
// column 25 is empty, so there is no 7th skin.
export const SKINS = [
  { id: "default",         key: 0, nameKey: "skins.name.default",         column: null, rarity: "default", price: 0 },
  { id: "outfit_red",      key: 1, nameKey: "skins.name.outfit_red",      column: 5,    rarity: "common",  price: 150 },
  { id: "outfit_yellow",   key: 2, nameKey: "skins.name.outfit_yellow",   column: 9,    rarity: "common",  price: 150 },
  { id: "outfit_blue",     key: 3, nameKey: "skins.name.outfit_blue",     column: 13,   rarity: "common",  price: 150 },
  { id: "tracksuit_black", key: 4, nameKey: "skins.name.tracksuit_black", column: 17,   rarity: "rare",    price: 400 },
  { id: "ninja_black",     key: 5, nameKey: "skins.name.ninja_black",     column: 21,   rarity: "rare",    price: 400 },
];

const byId = new Map(SKINS.map((s) => [s.id, s]));
const byKey = new Map(SKINS.map((s) => [s.key, s]));

const listeners = new Set();

export function getCatalog() { return SKINS; }
export function getSkin(id) { return byId.get(id) || null; }

function ownedKey(skinId, idx) { return `player.${idx}.skin.owned.${skinId}`; }
function selectedKey(idx) { return `player.${idx}.skin.selected`; }

// Ownership folds onto P1 in local co-op (shared closet / shared purse). Network
// co-op (isCoopMode() false there) keeps indices independent. Mirrors wallet.js.
function ownedIndex(index) {
  const i = index | 0;
  if (i > 0 && isCoopMode()) return 0;
  return i;
}

export function isOwned(skinId, index = 0) {
  if (skinId === DEFAULT_SKIN_ID) return true;
  if (!byId.has(skinId)) return false;
  return getValue(ownedKey(skinId, ownedIndex(index))) ? true : false;
}

export function ownedSkins(index = 0) {
  return SKINS.filter((s) => isOwned(s.id, index));
}

export function markOwned(skinId, index = 0) {
  if (skinId === DEFAULT_SKIN_ID || !byId.has(skinId)) return;
  setValue(ownedKey(skinId, ownedIndex(index)), 1);
  fire(index | 0);
}

// Clear an ownership flag — used when a real-money entitlement is revoked
// (refund/chargeback) so the skin reverts to not-owned. getSelected() then
// auto-falls-back to default if the revoked skin was equipped. The default skin
// is always owned and can't be cleared.
export function markUnowned(skinId, index = 0) {
  if (skinId === DEFAULT_SKIN_ID || !byId.has(skinId)) return;
  setValue(ownedKey(skinId, ownedIndex(index)), null);
  fire(index | 0);
}

// Selection is per RAW index (not folded). Falls back to default if the stored
// skin is unknown or no longer owned (e.g. a wiped save mid-session).
export function getSelected(index = 0) {
  const raw = getValue(selectedKey(index | 0));
  if (raw == null) return DEFAULT_SKIN_ID;
  const skin = byKey.get(raw | 0);
  if (!skin || !isOwned(skin.id, index)) return DEFAULT_SKIN_ID;
  return skin.id;
}

export function setSelected(skinId, index = 0) {
  const skin = byId.get(skinId);
  if (!skin) return false;
  if (!isOwned(skinId, index)) return false;
  setValue(selectedKey(index | 0), skin.key === 0 ? null : skin.key);
  fire(index | 0);
  return true;
}

// The per-index default column (P1..P4), shared by player.js and mirrorWorld.
export function defaultColumn(index) {
  return HERO_BASE_COLUMN + (index | 0) * HERO_COLUMN_STRIDE;
}

// The render seam: which heroes-sheet column a given avatar draws from.
// Online co-op prefers the synced skin by playerId; otherwise the local
// selection by index.
export function resolveSkinColumn(player) {
  if (!player) return HERO_BASE_COLUMN;
  const index = player.index | 0;
  const id = sessionSkinFor(player.playerId) ?? getSelected(index);
  const skin = byId.get(id);
  if (!skin || skin.column == null) return defaultColumn(index);
  return skin.column;
}

export function onSkinChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function fire(index) {
  for (const fn of listeners) fn(index);
}

if (typeof window !== "undefined") {
  window.skins = {
    catalog: getCatalog,
    isOwned,
    owned: ownedSkins,
    markOwned,
    getSelected,
    setSelected,
  };
}
