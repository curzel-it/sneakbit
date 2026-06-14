// The Tower Defense shop's stock list. TD reuses the regular shop UI
// (shop.js) and purchase rules (shopPurchase.js) verbatim — this module just
// supplies what's for sale and at what price, the same shape a clerk's
// `shop_stock` array uses in zone data: { item: <species id>, price, stackable? }
// for goods, { skill: <id>, price } for unlocks.
//
// It's a real shop: every non-cosmetic good is here — weapons (re-arm the
// active hero), ammo (finite now, per hero), consumables, and the knockback
// aura. Cosmetic skins are deliberately excluded (TD heroes render by squad
// slot, not by skin, and a throwaway run is the wrong place to sell permanent
// looks). Prices are TD-tuned (its own coin economy: ~150 start, kills pay
// 5–24, waves stipend ~40+), separate from the campaign clerks' prices.
//
// Item ids match data/species.json:
//   weapons  1164 sword · 1172 shield · 1180 darkblade · 1162 AR-15 ·
//            1183 dark AR-15 · 1168 cannon
//   ammo     7001 kunai×10 · 1176/1173 .223 ×10/×100 · 1177/1174 cannon ×10/×100
//   heals    2020 health potion (+50) · 2028 red pill (full)
//   skill    aura (knockback)

const TD_STOCK = [
  // — Consumables ——————————————————————————————————————————————————————————
  { item: 2020, price: 30,  stackable: true },  // health potion (+50 HP)
  { item: 2028, price: 70,  stackable: true },  // red pill (full heal)

  // — Ammo (Bundles → stackable by species default) ————————————————————————
  { item: 7001, price: 8 },                     // kunai ×10
  { item: 1176, price: 20 },                    // .223 ×10
  { item: 1173, price: 160 },                   // .223 ×100
  { item: 1177, price: 50 },                    // cannon ×10
  { item: 1174, price: 420 },                   // cannon ×100

  // — Weapons (one-of-a-kind; re-arm the active hero) ——————————————————————
  { item: 1164, price: 120 },                   // sword (melee)
  { item: 1172, price: 140 },                   // shield (melee)
  { item: 1180, price: 320 },                   // darkblade (melee)
  { item: 1162, price: 300 },                   // AR-15 (ranged)
  { item: 1168, price: 500 },                   // cannon (ranged)
  { item: 1183, price: 650 },                   // dark AR-15 (ranged)

  // — Skill ————————————————————————————————————————————————————————————————
  { skill: "aura", price: 60 },                 // knockback aura
];

// The stock for a TD shop visit. Returned fresh each call so a caller can't
// mutate the shared list (shop.js filters it in place to drop unknown ids).
export function tdShopStock() {
  return TD_STOCK.map((e) => ({ ...e }));
}
