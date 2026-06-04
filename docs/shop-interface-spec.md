# Shop Interface — Specification

Status: draft for review · Author: spec compiled from existing systems + product answers · Date: 2026-06-04

A Game Boy Pokémon–style shop where the hero buys old equipment and ammo from a
clerk, with a modern icon-driven DOM UI that works on keyboard, touch, and gamepad.

---

## 1. Goals & non-goals

**Goals**
- Talk to the shop clerk → a buy menu opens, Pokémon (Game Boy) flow.
- Sell list: old equipment — **Sword, Kunai (ammo), AR-15 ("rifle"), Cannon, Shield**, plus **ammo bundles**.
- Each row shows **icon + name + price + description**, and current **coin balance** is always visible.
- Weapons are **one-of-a-kind**: you cannot buy one you already own (shown as *Owned*, disabled).
- Ammo is stackable: the player can **choose a quantity** before buying.
- Works perfectly on **all platforms / all controls** (keyboard, touch, gamepad).
- Modern look (icons, cards) that still *feels* Pokémon-like.

**Non-goals (this pass)**
- **Selling** items back — buy-only for now (confirmed). Leave room in the data model but don't build it.
- Per-NPC haggling, discounts, stock depletion, restock timers.
- Online-coop shared-shop semantics beyond "each player spends their own wallet" (see §10).

---

## 2. Source of truth & key facts (from the codebase)

| Concern | Where | Notes |
|---|---|---|
| Coins | `js/wallet.js` | `getCoins(p)`, `addCoins(amount, p)` (negative to spend), `onWalletChange(fn)`. Spending clamps at 0. |
| Coin HUD | `js/coinHud.js` | Already top-center; stays visible. Pattern for painting an inventory icon onto a `<canvas>`. |
| Inventory counts | `js/inventory.js` | `getAmmo(id,p)`, `addAmmo(id,n,p)`, `snapshotInventory(p)`. Keyed `player.{p}.inventory.amount.{sid}`. |
| Equipment | `js/equipment.js` | `getEquipped(slot,p)`, `setEquipped(slot,id,p)`. |
| Weapon ownership (derived!) | `js/weaponSlots.js` | A weapon is "owned" when the player holds an inventory **item** whose `associated_weapon` points at that weapon species. Ownership is **not** a flag. |
| Auto-equip on grant | `js/pickups.js` `maybeEquipWeapon()` | Picking up a weapon item equips it. Shop grant should reuse the same path. |
| Bundle expansion | `js/pickups.js` (lines ~150) | A `Bundle` item expands into `bundle_contents` → `addAmmo(cid, n)` per content id. |
| Clerk entity | `data/12900001.json`, entity `id: 12900010`, `species_id: 3008` | Currently `dialogues: []`. This is where per-shop stock attaches. |
| Interaction → dialogue | `js/interact.js`, `js/dialogue.js`, `js/afterDialogue.js` | `performInteract` finds the faced entity, runs its dialogue, then `handleAfterDialogue`. |
| DOM helpers | `js/dom.js` | `el(tag, props, children)`, `showOnly(map, key)`. |
| Menu nav (kbd/pad) | `js/menuNav.js` | `registerMenuSurface({ isOpen, onConfirm, onCancel, priority })`. Game pauses while a surface is open. |
| Touch | `js/touch.js` | On-screen buttons synthesize `keydown`/`keyup`. Shop UI gets its own tap targets (it's DOM). |
| Item icons | `assets/inventory.png` + `species.inventory_texture_offset` `[row,col]` | Blit `col*TILE, row*TILE` (see `coinHud.js` / `ammoHud.js`). |
| Strings / i18n | `data/strings.en.json`, `data/strings.it.json`, `js/strings.js` `tr()` | Names exist as `objects.name.*`. **No description strings exist yet** — must be authored. |

---

## 3. The catalog — real item ids

Three-tier model in `data/species.json`:
- **`*.weapon`** (`WeaponMelee`/`WeaponRanged`) — the equippable; never held in inventory directly.
- **`*.item`** (`PickableObject`, `associated_weapon → weapon`) — the thing you *hold*; holding ≥1 marks the weapon owned. These are the **one-of-a-kind** shop goods.
- **`*.bullet`** (`Bullet`) and **bundles** (`Bundle`, with `bundle_contents`) — ammo.

Concrete goods for the starter shop:

| Display | Sell species id | Kind | Grants / contains | Qty? |
|---|---|---|---|---|
| Sword | `1164` (`sword.item`) | weapon item → `1159` | melee weapon Sword | one-of-a-kind |
| AR-15 ("rifle") | `1162` (`ar15.item`) | weapon item → `1154` | ranged weapon AR-15 | one-of-a-kind |
| Cannon | `1168` (`cannon.item`) | weapon item → `1167` | ranged weapon Cannon | one-of-a-kind |
| Shield | `1172` (`shield.item`) | weapon item → `1171` | melee Shield | one-of-a-kind |
| Kunai ×10 | `7001` (`kunai.x10`) | bundle | 10× kunai `7000` | **quantity** |
| .223 ×10 (AR-15 ammo) | `1176` (`ar15.bullet.x10`) | bundle | 10× `1169` | **quantity** |
| .223 ×100 | `1173` (`ar15.bullet.x100`) | bundle | 100× `1169` | **quantity** |
| Cannonball ×100 | `1174` (`cannon.bullet.x100`) | bundle | 100× `1170` | **quantity** |

> The kunai launcher (`1160`) is the **default ranged weapon** — already owned, so it is not sold; only its ammo is.

This reconciles the two product answers: **weapons = one-of-a-kind** (no quantity, hidden/greyed once owned), **ammo bundles = quantity-selectable**. The "select quantity" requirement applies to bundles.

---

## 4. Per-shop stock data model

Stock lives **on the clerk entity** in the interior zone JSON (answer: per-shop in zone data). Add one new field to the clerk in `data/12900001.json`:

```jsonc
{
  "id": 12900010,
  "species_id": 3008,
  // ...existing fields...
  "shop_stock": [
    { "item": 7001, "price": 10,  "stackable": true },  // Kunai ×10   (anchor: ~1 kunai ≈ 1 coin)
    { "item": 1176, "price": 30,  "stackable": true },  // .223 ×10
    { "item": 1173, "price": 250, "stackable": true },  // .223 ×100   (bulk discount vs 10×30)
    { "item": 1174, "price": 400, "stackable": true },  // Cannonball ×100
    { "item": 1164, "price": 99  },                     // Sword       (weapon anchor)
    { "item": 1172, "price": 150 },                     // Shield
    { "item": 1162, "price": 450 },                     // AR-15
    { "item": 1168, "price": 999 }                      // Cannon
  ]
}
```

Rules:
- `stackable` is **optional**; default it from species: `entity_type === "Bundle" || "Bullet"` → stackable, weapon items → not. The explicit flag is an override/escape hatch.
- A shop is "open-able" iff its clerk has a non-empty `shop_stock`. A clerk with only `dialogues` stays a plain NPC.
- **Prices are final** (decided). Anchor: a single kunai is ~1 coin, so **Kunai ×10 = 10**; **Sword = 99** anchors the weapon tier and the rest scales up. Starting purse is **50 coins** (`wallet.STARTING_COINS`) → Kunai ×10 is affordable day one; weapons require some grinding. Progression is **gated purely by price** (no display conditions). **Per-purchase quantity cap = 99** (also clamped by wallet).

> The interior was prefab-generated once then persisted as JSON, so editing the clerk entity in `data/12900001.json` is sufficient. For *future* shops, the `shopBuilding()` prefab in `js/prefabs.js` should seed a sensible default `shop_stock` on the clerk it spawns, which level data can then override.

---

## 5. Open flow (Game Boy Pokémon style)

1. Hero faces the clerk, presses **interact**.
2. `interact.js` detects the clerk. Because the clerk has `shop_stock`, instead of (or after) a greeting line, it opens the shop.
   - **Greeting (Pokémon Crystal style):** the clerk speaks **one** short line via the existing `dialogue.js` (e.g. *"Welcome! How may I help you?"*), then on dismiss → shop panel opens. Closing the panel returns through a brief *"Please come again!"* line, matching Crystal's mart cadence. Qty cap **99**, money shown top-right of the panel.
3. Shop panel is a **modal DOM overlay** (like `gameOver.js` / `menu.js`), registered via `registerMenuSurface` so the game pauses and gamepad/keyboard route into it.
4. Player browses rows, picks an item → quantity step (if stackable) → confirm → purchase resolves with a toast + SFX.
5. **Cancel/close** (Esc / B / close button / tap scrim) returns to play. No second "Sell/See ya" branch needed since buy-only — closing *is* "See ya".

Pause/resume must match dialogue/menu behavior exactly (input is swallowed by the surface; main loop paused). Reuse the menu-surface contract rather than inventing a new pause path.

---

## 6. UI structure (DOM, not canvas)

New feature file: **`js/shop.js`** (one feature, one file), plus a small CSS block injected the way `menu.js`/`touch.js` do, or appended to the existing stylesheet. The shop is **never drawn on the canvas** (project rule).

Two logical screens inside one overlay, switched with `showOnly()`:

**Screen A — Storefront (list)**
```
┌─────────────────────────────────────────────┐
│  SHOP                         🪙  50          │  ← title + live coin balance
├─────────────────────────────────────────────┤
│ [icon] Sword            120 🪙   [ Owned ]    │  ← greyed/disabled if owned
│ [icon] Shield            90 🪙   ▸            │
│ [icon] AR 15            300 🪙   ▸ (locked*)  │  ← *dim if unaffordable
│ [icon] Kunai x10         15 🪙   ▸            │
│ ...                                          │
├─────────────────────────────────────────────┤
│ "An old but reliable blade."                 │  ← description of focused row
│                                   [ Close ]   │
└─────────────────────────────────────────────┘
```
- Each row: `<button>` with a `<canvas>` (or CSS-sprite) icon, name, price, affordability/owned state.
- Description shows for the **focused/hovered** row (keyboard/gamepad focus or pointer hover) — keeps rows compact, modern, and Pokémon-like (GB showed the description under the list).
- Coin balance subscribes to `onWalletChange` so it updates live after a buy.

**Screen B — Quantity / Confirm**
```
┌──────────────────────────────┐
│ [icon]  Kunai x10            │
│ "Ten kunai for your launcher"│
│                              │
│   Qty   ◀   3   ▶            │  ← only for stackable items
│   Total        45 🪙          │
│                              │
│   [ Buy ]        [ Cancel ]  │
└──────────────────────────────┘
```
- For **one-of-a-kind** weapons, skip the qty stepper: show item + description + "Buy (price)" + Cancel.
- Qty clamps to `[1, maxAffordable]`; `maxAffordable = floor(coins / price)`; Buy disabled if `maxAffordable < 1`.

Visual language: reuse menu card styling (rounded panel, dim scrim `rgba(0,0,0,.78)`, `zIndex` above HUD), pixel-perfect icons (`image-rendering: pixelated`, integer blits).

---

## 7. Icons

Mirror `coinHud.js`/`ammoHud.js`: for a species with `inventory_texture_offset = [row, col]`, blit from `getSprite("inventory")` at `col*TILE_SIZE, row*TILE_SIZE`. Provide a tiny shared helper if one doesn't already exist (`inventoryIconFor` is referenced in `pickups.js` — reuse it if exported; otherwise factor a `js/inventoryIcon.js`). Each shop row owns a small `<canvas>`; repaint on asset-ready.

---

## 8. Input across platforms

The shop is a `menuNav` surface, so it inherits the established multi-input contract:

- **Keyboard:** Up/Down (or bound nav) move focus; **interact/Enter** confirms (→ qty screen → buy); **Esc/menu** cancels/closes. On qty screen, Left/Right adjust quantity.
- **Gamepad:** D-pad/stick move focus; **A** confirms; **B** cancels/back; Left/Right on qty. Wire through `registerMenuSurface({ onConfirm, onCancel })` + focus handling like other surfaces.
- **Touch:** every actionable element is a real DOM button — direct taps work with no synthesis. Rows, ◀/▶ steppers, Buy, Cancel, Close, and a tappable scrim to dismiss. Ensure hit targets ≥44px and that `touch.js`'s on-screen D-pad is hidden/ignored while the shop is open (the surface owns input).

Focus model: maintain a `focusIndex`, render an `is-focused` class, keep DOM focus and visual focus in sync so hover-description and pad-focus-description use one code path.

---

## 9. Purchase logic

A pure, unit-testable core in `js/shop.js` (or split a `js/shopPurchase.js` if the UI file gets large):

```
canBuy(stockEntry, playerIndex):
  sp = getSpecies(stockEntry.item)
  if isWeaponItem(sp) && alreadyOwned(sp, playerIndex): return { ok:false, reason:"owned" }
  if getCoins(playerIndex) < stockEntry.price * qty: return { ok:false, reason:"poor" }
  return { ok:true }

buy(stockEntry, qty, playerIndex):
  total = stockEntry.price * qty
  addCoins(-total, playerIndex)               // spend first
  grant(stockEntry.item, qty, playerIndex)    // mirror pickups.js non-PvP path
  playSfx("ammoCollected" / a purchase sfx)
  showToast(`Bought: ${name}`, { image: icon })
```

`grant(itemId, qty, p)` mirrors `pickups.js`:
- If species is a **Bundle**: for each of `qty` units, expand `bundle_contents` → `addAmmo(cid, count, p)`.
- Else (weapon item / plain pickable): `addAmmo(itemId, 1, p)` then reuse `maybeEquipWeapon(sp, picker)` so a bought weapon auto-equips just like a found one.

`alreadyOwned` reuses the **same derivation** as `weaponSlots.js`: the weapon is owned iff `getAmmo(weaponItemId, p) > 0` (or, more precisely, any item with that `associated_weapon` is held). Use `weaponsInSlot()` membership to stay consistent with the inventory screen.

Ordering: spend coins **after** validating, before granting; guard against double-fire (disable Buy button during the transaction).

---

## 10. Multiplayer / modes

- **Single-player:** wallet + inventory at index 0. Straightforward.
- **Local co-op:** `inventory.js`/`wallet.js` already fold P2→P1 (shared slot). One shared shop is fine.
- **Online co-op:** wallets/inventories are per-player. The shop should buy into the **interacting player's** index. Out of scope to deeply sync; confirm only that opening the shop on a guest spends the guest's wallet (likely already true via player index threading). Flag for E2E only if shop touches networked files (it shouldn't).
- **Creative mode:** single-player only (per project memory) — no special handling.
- **PvP:** shops not present in PvP maps; no work.

---

## 11. i18n & descriptions

Names already exist (`objects.name.*`). **Descriptions must be authored** in both `data/strings.en.json` and `data/strings.it.json` under a new key convention, e.g. `objects.desc.sword`, `objects.desc.ar15`, `objects.desc.shield`, `objects.desc.cannon`, `objects.desc.kunai.x10`, etc. UI resolves via `tr()`; fall back to empty string if missing so a shop never breaks on a missing description. Draft copy is a content task for review (short, flavorful, GB-style).

---

## 12. Files

**New**
- `js/shop.js` — shop overlay feature: open/close, render storefront + qty screen, input wiring, registers menu surface. (Split `js/shopPurchase.js` for the pure buy/grant/own logic if `shop.js` grows past ~200 lines — keeps logic unit-testable without DOM.)
- `js/inventoryIcon.js` — *only if* a reusable icon-blit helper isn't already exported (check `pickups.js`'s `inventoryIconFor`).
- `tests/shop.test.js` — unit tests for pricing/affordability/quantity-clamp/own-detection/grant (bundle expansion vs weapon equip).

**Changed**
- `data/12900001.json` — add `shop_stock` (+ optional greeting `dialogues`) to clerk `12900010`.
- `js/interact.js` — if a faced entity has `shop_stock`, open the shop (after optional greeting) instead of/after dialogue.
- `js/prefabs.js` `shopBuilding()` — seed a default `shop_stock` on the spawned clerk so future shops work out of the box.
- `data/strings.en.json`, `data/strings.it.json` — description strings.
- Stylesheet — shop card/list CSS (wherever menu/touch styles live).

Respect **one feature, one file**: the shop overlay, the purchase logic, and the icon helper are distinct responsibilities.

---

## 13. Edge cases & polish

- **Already owned weapon:** row disabled, labeled *Owned*; `buy()` refuses defensively.
- **Can't afford:** row dimmed; qty clamps so Buy can't exceed wallet; if `price > coins` entirely, Buy disabled with a subtle "Not enough coins" hint + a soft error SFX.
- **Exactly enough coins:** buying to 0 is allowed (wallet clamps at 0, never negative).
- **Default kunai launcher:** never appears as a weapon to buy; its ammo does.
- **Closing mid-quantity:** Cancel returns to storefront, no charge.
- **Opening with empty stock:** clerk falls back to plain dialogue/no-op (shouldn't happen for a real shop).
- **Asset not yet loaded:** icon canvases paint when `getSprite("inventory")` is ready (guard like the HUDs).
- **Pause integrity:** entering the shop pauses the world; leaving resumes — verify hero can't be hit while shopping (same as dialogue/menu).
- **Touch D-pad bleed-through:** suppress `touch.js` controls while the shop surface is open.

---

## 14. Testing

- **Unit (`tests/shop.test.js`, node, ~no DOM):**
  - price × qty math; `maxAffordable` clamp; Buy gating.
  - `grant()` bundle expansion grants correct ammo counts; weapon item grants 1 + marks owned.
  - own-detection matches `weaponSlots.weaponsInSlot`.
  - buying a weapon you own is refused; spending never drives coins below 0.
- **Manual / visual:** open shop on keyboard, touch (mobile viewport), and gamepad; confirm description-on-focus, qty stepper, owned/greyed states, live coin counter, auto-equip of a bought weapon, toast + SFX.
- **E2E:** only if shop logic touches the networked files listed in CLAUDE.md (it shouldn't). If online-coop wallet/inventory threading is modified, run `test:e2e`.

---

## 15. Resolved decisions

All open items are now locked:

1. **Prices** — final (§4). Kunai ×10 = 10 (≈1 coin/kunai), Sword = 99, scaling up to Cannon = 999.
2. **Greeting** — one Pokémon-Crystal-style line on open, a "come again" line on close (§5).
3. **Descriptions** — drafted in EN **and** IT below (§16); user will edit later.
4. **Stock list** — §3 set confirmed; progression gated purely by price (no display conditions).
5. **Quantity cap** — 99 per purchase, additionally clamped by wallet affordability.

---

## 16. i18n appendix — draft strings (paste into `data/strings.*.json`)

New `objects.desc.*` keys (short, GB/Crystal-flavored). The UI resolves via `tr()` and falls back to empty string if a key is missing.

**`data/strings.en.json`**
```json
"objects.desc.kunai.x10": "Ten throwing blades for your launcher.",
"objects.desc.ar15.bullet.x10": "Ten .223 rounds for the AR 15.",
"objects.desc.ar15.bullet.x100": "A full box — one hundred .223 rounds.",
"objects.desc.cannon.bullet.x100": "One hundred heavy cannonballs.",
"objects.desc.sword.item": "A sturdy old blade. Still bites.",
"objects.desc.shield.item": "Worn but dependable. Stops what bites back.",
"objects.desc.ar15.item": "Rapid-fire rifle. Hungry for .223 rounds.",
"objects.desc.cannon.item": "Heavy and loud. Lobs cannonballs downrange.",
"shop.greeting": "Welcome! How may I help you?",
"shop.farewell": "Please come again!",
"shop.title": "Shop",
"shop.owned": "Owned",
"shop.buy": "Buy",
"shop.cancel": "Cancel",
"shop.close": "Close",
"shop.quantity": "Qty",
"shop.total": "Total",
"shop.too_poor": "Not enough coins.",
"shop.bought": "Bought: {name}"
```

**`data/strings.it.json`**
```json
"objects.desc.kunai.x10": "Dieci lame da lancio per il tuo lanciatore.",
"objects.desc.ar15.bullet.x10": "Dieci munizioni .223 per l'AR 15.",
"objects.desc.ar15.bullet.x100": "Una scatola intera: cento munizioni .223.",
"objects.desc.cannon.bullet.x100": "Cento pesanti palle di cannone.",
"objects.desc.sword.item": "Una vecchia lama robusta. Morde ancora.",
"objects.desc.shield.item": "Logoro ma affidabile. Para i colpi.",
"objects.desc.ar15.item": "Fucile a raffica. Affamato di munizioni .223.",
"objects.desc.cannon.item": "Pesante e rumoroso. Spara palle di cannone.",
"shop.greeting": "Benvenuto! Come posso aiutarti?",
"shop.farewell": "Torna a trovarci!",
"shop.title": "Negozio",
"shop.owned": "Posseduto",
"shop.buy": "Compra",
"shop.cancel": "Annulla",
"shop.close": "Chiudi",
"shop.quantity": "Qtà",
"shop.total": "Totale",
"shop.too_poor": "Monete insufficienti.",
"shop.bought": "Comprato: {name}"
```

> Description key convention follows each item's existing name key (`objects.name.sword.item` → `objects.desc.sword.item`) so they're trivially paired in code. `shop.*` are UI chrome strings. `{name}` is interpolated by the shop's toast call.

---

## 17. Final price table (locked)

| Good | Sell id | Price | Stackable |
|---|---|---|---|
| Kunai ×10 | 7001 | 10 | yes |
| .223 ×10 | 1176 | 30 | yes |
| .223 ×100 | 1173 | 250 | yes |
| Cannonball ×100 | 1174 | 400 | yes |
| Sword | 1164 | 99 | no (one-of-a-kind) |
| Shield | 1172 | 150 | no |
| AR-15 | 1162 | 450 | no |
| Cannon | 1168 | 999 | no |
