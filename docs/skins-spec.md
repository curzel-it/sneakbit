# Skins — Specification

Status: draft for review · Author: spec compiled from existing systems + product answers · Date: 2026-06-08

Cosmetic hero outfits. The player starts with the default look; every other
skin is bought with coins in the existing clerk shop and equipped from a new
wardrobe screen in the pause menu. A skin only changes the hero's *appearance*
(its sprite column on `assets/heroes.png`) — never stats, hitbox, or gear.

---

## 1. Goals & non-goals

**Goals**
- Player starts with the **default** skin (the current P1 look). It is always owned and free.
- Other skins are **purchasable with coins** in the **existing shop** (clerk), priced as one-of-a-kind goods like weapons.
- Skins are **equipped from a new wardrobe screen** reached from the pause menu — buying and equipping are separate actions.
- Launch catalog: **P2, P3, P4 outfits** (the existing co-op color blocks) + **black, red, blue ninja** outfits.
- Skins are **per-player** (single-player, local co-op, and online co-op each pick their own), and **clashes are allowed** — two players may wear the same skin.
- A player still on the **default** skin keeps today's **per-index color** (P2/P3/P4 columns) so default-skin co-op guests stay visually distinct exactly as now.
- Works on keyboard, touch, and gamepad (the wardrobe is a `menuNav` surface like the shop).

**Non-goals (this pass)**
- New skin art — the seven color blocks already exist in `assets/heroes.png` (§3). No drawing required for the launch catalog.
- Selling skins back, refunds, trading, gifting.
- Skin-specific abilities, stat changes, or weapon-overlay recolors (weapons still draw from their own sheet unchanged).
- Animated/seasonal/unlock-by-achievement skins. Everything is coin-gated only.
- Tower Defense / PvP cosmetic overrides — TD keeps its fixed per-slot archetypes (see §6).

---

## 2. Source of truth & key facts (from the codebase)

| Concern | Where | Notes |
|---|---|---|
| Hero sprite column | `js/player.js` `heroFrameForIndex(index)` | `baseFrame = { x: 1 + index*4, y:1, w:1, h:2 }`. Columns **1, 5, 9, 13** = P1..P4. Stride 4, 4 anim frames each. |
| Draw uses baseFrame | `js/entities.js` `drawPlayer` → `getPlayerSpriteFrame(player)` | Reads `player.baseFrame.x` + direction-row + frame. The **only** thing a skin must change is `baseFrame.x`. |
| Remote avatar column | `js/mirrorWorld.js` (~L417, `heroFrameForIndex`) | Mirror copy computes the same column for networked avatars — a second place that must consult the skin. |
| Coins | `js/wallet.js` | `getCoins(p)`, `addCoins(amount,p)` (negative to spend), `onWalletChange`. Spending clamps at 0. Local co-op folds P2..P4 → P1. |
| Shop UI | `js/shop.js` | DOM overlay, `menuNav` surface. Stock rows render an **inventory.png** icon via `inventory_texture_offset`. |
| Shop logic (pure) | `js/shopPurchase.js` | `isStackable`, `isOwned`, `clampQty`, `canBuy`, `buy`, `grant`. Stock entry = `{ item:<speciesId>, price, stackable? }`. |
| Stock data | clerk entity `shop_stock` array (zone JSON); `js/prefabs.js` `DEFAULT_SHOP_STOCK` | A clerk with non-empty `shop_stock` opens the shop (`js/interact.js`). |
| Persistence | `js/storage.js` | `getValue(key)` / `setValue(key, intOrNull)`. Integer values; `null` = unset. Keys `player.{i}.…`. |
| Per-player loadout cache | `js/sessionLoadouts.js` | `resolveLoadout(player)` is the seam renderers use for online co-op gear. Skins follow the same pattern. |
| Online loadout sync | `js/guestLoadoutSync.js`, `js/hostLoadoutSync.js` | Guest sends `guest.loadout {melee,ranged}`; host fans out `event:loadout {playerId,melee,ranged}`. Skin rides this channel. |
| Pause menu | `js/menu.js` (`installMenu`, `isMenuOpen`) | Where the "Wardrobe" entry / screen attaches. |
| Menu surface contract | `js/menuNav.js` | `registerMenuSurface({ root, isOpen, priority })`; world pauses, kbd/pad/touch route in. |
| i18n | `data/strings.en.json`, `data/strings.it.json`, `js/strings.js` `tr()` | New `skins.*` UI keys + per-skin name keys. |

> **Key architectural fact:** appearance is decided in exactly two places — `createPlayer` (local avatar `baseFrame`) and `mirrorWorld.js` (remote avatar `baseFrame`). A single `resolveSkinColumn(player)` helper feeds both. Keep skins out of the canvas-drawing code; it already just reads `baseFrame`.

---

## 3. The sprite sheet & the catalog

`assets/heroes.png` is **464×304** = 29 cols × 19 rows (16px tiles). A full hero
occupies one 4-wide column block × 16 rows (8 direction-states × `h:2`). Columns
were verified against the actual art: there are **six** hero blocks at
`x = 1, 5, 9, 13, 17, 21` (default + 5 purchasable). Column 25 is **empty** — no
7th skin.

| Skin id | Display | `column` (baseFrame.x) | Rarity | Notes |
|---|---|---|---|---|
| `default` | Default | per-index (`1 + index*4`) | — | Always owned, free, never in shop. **Renders the per-index color** (P1=1, P2=5, …). |
| `outfit_red` | Red Outfit | 5 | common | Same block co-op P2 uses by default. |
| `outfit_yellow` | Yellow Outfit | 9 | common | Co-op P3's default block. |
| `outfit_blue` | Blue Outfit | 13 | common | Co-op P4's default block. |
| `tracksuit_black` | Black Tracksuit | 17 | rare | |
| `ninja_black` | Black Ninja | 21 | rare | |

Skin ids are **strings**, not species ids — skins are not inventory items and
must not pollute the ammo/weapon-ownership map. (`storage.js` stores integers,
so ownership is persisted as a per-skin numeric flag keyed by the string id —
see §4.)

---

## 4. Data model — `js/skins.js` (new feature file)

One feature, one file. `skins.js` owns the catalog, ownership, selection, and
the rendering helper. No DOM.

```js
// Catalog: ordered list, id → { id, nameKey, column, rarity, price }
export const SKINS = [
  { id: "default",     nameKey: "skins.name.default",   column: null, rarity: "default", price: 0 },
  { id: "outfit_p2",   nameKey: "skins.name.outfit_p2", column: 5,    rarity: "common",  price: 150 },
  { id: "outfit_p3",   nameKey: "skins.name.outfit_p3", column: 9,    rarity: "common",  price: 150 },
  { id: "outfit_p4",   nameKey: "skins.name.outfit_p4", column: 13,   rarity: "common",  price: 150 },
  { id: "ninja_blue",  nameKey: "skins.name.ninja_blue",column: 17,   rarity: "rare",    price: 400 },
  { id: "ninja_red",   nameKey: "skins.name.ninja_red", column: 21,   rarity: "rare",    price: 400 },
  { id: "ninja_black", nameKey: "skins.name.ninja_black",column: 25,  rarity: "rare",    price: 400 },
];
```

**Persistence keys** (mirror `equipment.js` / `wallet.js`):
- Ownership: `player.{i}.skin.owned.{skinId}` → `1` when owned (`null`/absent = not owned). `default` is implicitly owned, never stored.
- Selection: `player.{i}.skin.selected` — stored as the **catalog index** (integer, since `storage.js` is integer-only) or `null`/absent = default. A tiny id↔index map in `skins.js` converts.

**Co-op folding — deliberately split from equipment/wallet:**
- **Ownership** folds like the wallet: in **local** co-op (`isCoopMode()`), `effectiveIndex(i)` collapses P2..P4 → P1, so all local heroes share one closet bought from the shared purse. (Online co-op keeps indices independent.)
- **Selection** is stored at the **raw** index, *not* folded — so each local split-screen player can wear a different owned skin and stay distinguishable. This is the one place skins diverge from equipment's folding rule, and it's intentional: a shared closet, individual outfits.

**Public API:**
```js
getCatalog()                      // SKINS
isOwned(skinId, index=0)          // default → true; else storage flag (folded)
ownedSkins(index=0)               // [skin, …] the player can equip
markOwned(skinId, index=0)        // shop grant path; fires change
getSelected(index=0)              // skinId (raw index); falls back "default" if unowned
setSelected(skinId, index=0)      // refuses if !isOwned; fires change
resolveSkinColumn(player)         // ← the render seam (see §5)
onSkinChange(fn)                  // listeners (wardrobe live preview, avatar refresh)
```

`window.skins` devtools shim for parity with `window.equipment` / `window.skills`.

---

## 5. Rendering

The render path already funnels through `player.baseFrame.x`. Add **one helper**
and call it in the two places that build a hero `baseFrame`.

```js
// skins.js
export function resolveSkinColumn(player) {
  // Online co-op: prefer the synced skin for this playerId (sessionSkins),
  // else the local selection by index. Default → per-index fallback column.
  const id = sessionSkinFor(player.playerId) ?? getSelected(player.index | 0);
  const skin = byId(id);
  if (!skin || skin.column == null) return 1 + (player.index | 0) * 4; // default = per-index
  return skin.column;
}
```

1. **`js/player.js`** — `heroFrameForIndex` keeps producing the *default*
   per-index frame, but `createPlayer` sets `baseFrame.x` from
   `resolveSkinColumn(player)`. Subscribe to `onSkinChange` (or have the
   wardrobe call a small `refreshPlayerSkin(player)`) so swapping a skin
   updates the live avatar without a reload.
2. **`js/mirrorWorld.js`** — where it calls `heroFrameForIndex(curr.index)` for
   the mirror avatar, take the column from `resolveSkinColumn(curr)` instead so
   remote/co-op avatars render their wearer's skin.

`getPlayerSpriteFrame` and `drawPlayer` are **unchanged** — they already read
`baseFrame.x`. No canvas code learns about skins (project rule).

---

## 6. Co-op, online sync & modes

Product decision: **per-player skins, clashes allowed**, *and* default-skin
players still get their per-index P2/P3/P4 color.

- **Single-player:** index 0. Selection + ownership at `player.0.*`.
- **Local split-screen co-op:** ownership folds to P1 (shared closet/purse);
  selection is per raw index (each hero wears its own). A hero left on
  `default` renders its per-index column → identical to today. ✔
- **Online co-op:** ownership/selection are per-client (each on its own save).
  The chosen skin must be visible on the host and all peers, so it **rides the
  existing loadout-sync channel**:
  - Extend the guest→host op `guest.loadout` with a `skin` field (the selected
    skin id, or null for default). `guestLoadoutSync.js` sends it on connect and
    whenever `onSkinChange` fires (alongside the existing equipment trigger).
  - Extend the host→peers `event:loadout` frame with `skin`. Host stores it in a
    `sessionSkins` map keyed by `playerId` (new tiny module, or a field added to
    `sessionLoadouts` — prefer a sibling `js/sessionSkins.js` for one-feature-one-file).
  - `resolveSkinColumn` consults `sessionSkins` first (by `playerId`), then the
    local selection (by index) — exactly the `resolveLoadout` fallback shape.
  - Write-through for self (like `guestLoadoutSync` does for equipment) is **not**
    needed: the guest already owns its selection in local storage; the host echo
    is purely for *other* clients' rendering.
- **Tower Defense:** squad archetypes are fixed per slot (`sessionLoadouts.TD_HERO_LOADOUTS`)
  and TD never reads saved equipment. Skins are likewise ignored — TD heroes keep
  their per-slot columns. Gate `resolveSkinColumn` to return the per-index column
  when `isTowerDefenseMode()`.
- **PvP:** out of scope this pass — arena avatars keep per-index columns. (Easy
  to enable later by removing the gate; flagged as non-goal to bound testing.)
- **Creative mode:** single-player only (project memory) — nothing special.

> Because online sync touches `guestLoadoutSync.js` / `hostLoadoutSync.js` /
> `sessionLoadouts.js`-adjacent code, this feature **must run `npm run test:e2e`**
> before any push (per CLAUDE.md's file list).

---

## 7. Shop integration ("existing shop sells")

Skins are sold from the **same clerk shop**, as **one-of-a-kind** goods (no
quantity, "Owned" once bought) — the weapon-item pattern, but for a skin id
instead of a species id.

**Stock entry shape.** Skins can't reuse `{ item: <speciesId> }` (no species).
Add a sibling marker the shop logic branches on:

```jsonc
"shop_stock": [
  { "item": 7001, "price": 10 },          // existing goods unchanged
  { "skin": "outfit_p2",  "price": 150 }, // ← skin good
  { "skin": "ninja_black","price": 400 }
]
```

**`js/shopPurchase.js` changes** (minimal, keep it pure):
- `isSkinEntry(entry)` → `typeof entry.skin === "string"`.
- `isStackable` → `false` for skin entries.
- `isOwned(entry, p)` → `skins.isOwned(entry.skin, p)` for skin entries (extends
  the current weapon-only ownership so skin rows grey out as "Owned").
- `canBuy` → reuse the affordability/owned checks; price from `entry.price`.
- `grant` → for a skin entry, `skins.markOwned(entry.skin, p)` (no `addAmmo`, no
  auto-equip — buying does **not** auto-wear; equipping is the wardrobe's job, so
  buying a skin while wearing another doesn't yank the player's current look).

> Decision: **buying does not auto-equip.** Mirrors the product split (shop sells,
> menu equips) and avoids surprise appearance changes. The buy toast can hint
> "Equip it in the Wardrobe."

**`js/shop.js` changes** (presentation only):
- Row/detail icon: skins have no `inventory_texture_offset`. Paint a **hero
  preview** by blitting `getSprite("heroes")` at the skin's `column` (down-facing
  still frame, `x=column, y=5` per `DIRECTION_ROW.down.still`×`h` → `sy = 5*2*TILE`…
  reuse `getPlayerSpriteFrame` math). A small `paintHeroIcon(canvas, column)`
  helper, analogous to `paintIcon`.
- Name via `tr(skin.nameKey)`; description via `skins.desc.{id}` with the same
  empty-string fallback the shop already uses.
- Everything else (focus desc, owned/greyed, affordability, buy flow, toast/SFX)
  is the existing path.

---

## 8. Wardrobe screen ("menu equips")

New feature file **`js/wardrobe.js`** — a `menuNav` DOM surface opened from the
pause menu (a new "Wardrobe" entry in `js/menu.js`).

```
┌──────────────────────────────────────────┐
│  WARDROBE                                  │
├──────────────────────────────────────────┤
│  [P1]   [P2]   [P3]   [P4]                 │  ← grid of owned skins, hero preview each
│ default  ✓                                 │
│  [🥷]   [🥷]   [🥷]   (locked…)            │
│  blue    red   black                       │
├──────────────────────────────────────────┤
│  "Red Ninja"  — equipped                   │  ← focused skin name + state
│                              [ Close ]      │
└──────────────────────────────────────────┘
```

- Grid of **owned** skins (hero preview blit from `heroes.png`, like the shop
  icon). Optionally show unowned ones greyed with a "Buy in shop" hint + price —
  but never purchasable here (buying is the shop's job).
- Selecting an owned skin → `skins.setSelected(id, playerIndex)`; the focused
  card gets an "Equipped" badge; `onSkinChange` refreshes the live avatar.
- Per-platform input inherited from `menuNav` (kbd nav, gamepad A/B, real DOM
  buttons for touch ≥44px), same contract the shop uses.
- **Which player?** Single-player → index 0. Local co-op → the wardrobe targets
  the player who opened the menu (selection is per raw index). Online co-op →
  the local player (index 0 on that client); the change syncs out via §6.

---

## 9. Pricing (tiered by rarity)

| Tier | Skins | Price |
|---|---|---|
| common | Red / Yellow / Blue outfits | **150** each |
| rare | Black Tracksuit / Black Ninja | **400** each |

Anchored to the weapon shop (`docs/shop-interface-spec.md`): Sword 99, Shield
150, AR-15 450. Common outfits ≈ a Shield (mid-game affordable on a 50-coin start
plus some grinding); the tracksuit/ninja ≈ AR-15 tier (a real goal). Numbers live
in the `SKINS` catalog (default price) and can be overridden per `shop_stock`
entry, so tuning is a one-line data edit. Final values open to playtest tuning.

---

## 10. i18n strings (draft)

New keys; `tr()` resolves, empty-string fallback on miss.

**`data/strings.en.json`**
```json
"skins.title": "Wardrobe",
"skins.equipped": "Equipped",
"skins.equip": "Equip",
"skins.locked": "Buy in shop",
"skins.name.default": "Default",
"skins.name.outfit_red": "Red Outfit",
"skins.name.outfit_yellow": "Yellow Outfit",
"skins.name.outfit_blue": "Blue Outfit",
"skins.name.tracksuit_black": "Black Tracksuit",
"skins.name.ninja_black": "Black Ninja",
"skins.desc.tracksuit_black": "Dressed to sprint.",
"skins.desc.ninja_black": "Unseen in the dark."
```

**`data/strings.it.json`**
```json
"skins.title": "Guardaroba",
"skins.equipped": "Indossato",
"skins.equip": "Indossa",
"skins.locked": "Compra al negozio",
"skins.name.default": "Predefinito",
"skins.name.outfit_red": "Completo Rosso",
"skins.name.outfit_yellow": "Completo Giallo",
"skins.name.outfit_blue": "Completo Blu",
"skins.name.tracksuit_black": "Tuta Nera",
"skins.name.ninja_black": "Ninja Nero",
"skins.desc.tracksuit_black": "Pronto a scattare.",
"skins.desc.ninja_black": "Invisibile nel buio."
```

> Names confirmed against the actual sprite colors (columns 5/9/13/17/21). The
> "Wardrobe" menu button label is hard-coded English in `js/menu.js`, matching
> the file's other entry labels.

---

## 11. Files

**New**
- `js/skins.js` — catalog, ownership, selection, `resolveSkinColumn`, listeners. Pure (no DOM).
- `js/sessionSkins.js` — per-`playerId` synced skin cache for online co-op (sibling to `sessionLoadouts.js`).
- `js/wardrobe.js` — the equip screen (DOM, `menuNav` surface).
- `tests/skins.test.js` — unit: ownership default-true / flag round-trip, selection refuses unowned, `resolveSkinColumn` default→per-index vs explicit column, co-op fold (ownership folds, selection doesn't), TD gate.
- `tests/shopPurchase.test.js` additions (or extend existing) — skin entry: not stackable, owned after buy, grant marks owned + no auto-equip.

**Changed**
- `js/player.js` — `getPlayerSpriteFrame` resolves the column via `resolveSkinColumn(player)` instead of the baked-in `baseFrame.x`. This is the **single render seam**: every avatar (local, local-coop, and networked mirror copies) draws through `drawPlayer → getPlayerSpriteFrame`, so `mirrorWorld.js` needs no change — its interpolated player already carries `index`/`playerId`.
- `js/shopPurchase.js` — skin-entry branch in `isStackable` / `isEntryOwned` / `canBuy` / `buy` (grant path).
- `js/shop.js` — hero-preview icon for skin rows; name/desc via skin keys.
- `js/wardrobe.js` wiring in `js/menu.js` — "Wardrobe" entry that opens it.
- `js/guestLoadoutSync.js`, `js/hostLoadoutSync.js` — carry `skin` on `guest.loadout` / `event:loadout`.
- `data/strings.en.json`, `data/strings.it.json` — keys above.
- A clerk's `shop_stock` (zone JSON) and/or `prefabs.js` `DEFAULT_SHOP_STOCK` — add skin goods.

Respect **one feature, one file**: catalog/state (`skins.js`), network cache
(`sessionSkins.js`), and the equip UI (`wardrobe.js`) are distinct
responsibilities.

---

## 12. Edge cases & polish

- **Owned skin in shop:** row disabled / "Owned"; `buy()` refuses defensively.
- **Equipping then buying nothing changes the look** — buy never auto-equips.
- **Selected skin somehow not owned** (corrupt save / removed catalog entry):
  `getSelected` falls back to `default`; never render a missing column.
- **Default keeps per-index color** in every multi-player mode — the core
  compatibility guarantee; covered by a unit test.
- **Live swap:** equipping in the wardrobe updates the on-screen hero immediately
  (listener → `baseFrame.x`), no reload, no mid-step glitch (only `baseFrame.x`
  changes; direction/frame state untouched).
- **Online latency:** until a guest's `event:loadout` with `skin` arrives, peers
  render that guest's per-index default — graceful, self-corrects on the next frame.
- **New game wipe:** `localStorage.clear()` resets ownership/selection → back to
  default, consistent with wallet/inventory.
- **Asset not loaded:** hero-preview canvases paint when `getSprite("heroes")` is
  ready (guard like the HUDs / shop icons).

---

## 13. Testing

- **Unit (`tests/skins.test.js`, node, no DOM):** ownership (default always
  owned; buy→owned; round-trips storage), selection refuses unowned + persists,
  `resolveSkinColumn` (default→per-index for indices 0..3, explicit skin→its
  column, TD→per-index), co-op folding (ownership shared, selection per-index).
- **Unit (shop):** skin entry not stackable; owned after `buy`; `grant` marks
  owned and does **not** add ammo or equip a weapon; can't re-buy owned.
- **Manual / visual:** buy a skin in the clerk shop (owned/greyed, coins
  deducted, hero-preview icon), open Wardrobe, equip, see the live hero change;
  default still shows per-index colors in local co-op.
- **E2E (`npm run test:e2e`, required):** online co-op — a guest equipping a skin
  is reflected on the host and other peers' avatars; default guest still shows
  per-index column. Touches the loadout-sync files, so this gate is mandatory
  per CLAUDE.md before pushing.

---

## 14. Resolved decisions

1. **Co-op identity** — per-player skins, **clashes allowed**; default-skin
   players still get their per-index P2/P3/P4 color. (§6)
2. **Vendor & UI** — sold in the **existing clerk shop** (one-of-a-kind goods);
   equipped from a new **Wardrobe** screen in the pause menu. (§7, §8)
3. **Buying does not auto-equip** — keeps sell/equip cleanly separated. (§7)
4. **Pricing** — tiered by rarity: outfits 150, ninja 400 (data-overridable,
   playtest-tunable). (§9)
5. **No new art** — the 7 color blocks already exist in `heroes.png`. (§3)

## 15. Open questions (for review)

1. Confirm the **actual colors** of columns 5/9/13/17/21/25 so the display names
   in §10 match the art (placeholders used now).
2. Should **unowned** skins appear (greyed, "buy in shop") in the wardrobe, or
   only owned ones? Spec assumes owned-only with an optional greyed teaser.
3. Local split-screen: confirm the **shared-closet / per-player-outfit** model
   (§4) is desired over fully-independent per-player wallets (which the codebase
   does not currently support locally).
