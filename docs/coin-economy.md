# Coin economy (in-game currency)

The first pass at a real-game **economy**: a classic in-game currency — **coins** —
that monsters drop on death and the hero collects by walking over them. A HUD
counter shows the balance. This is the *real game's* money; it has nothing to do
with Tower Defense, which keeps its own transient gold pool (`arcadeCurrency.js`).

Status: **implemented** (this branch). Covered by `tests/economy.test.js` (unit)
and `tests/e2e/coinEconomy.test.mjs` (real boot + HUD + drop→collect loop).

Two deliberate v1 simplifications vs. the design below:
- **No despawn timer.** Uncollected coins live in `zone.entities` until the zone
  unloads (then they're gone — they're ephemeral and unsaved). The optional
  ageing-loop timer wasn't needed for a first cut; revisit if zones ever pile up
  loot.
- **`clearWallet` isn't wired into New-game.** That button does a full
  `localStorage.clear()` + reload, which already zeroes the wallet; `clearWallet`
  is exported for symmetry/tests only.

Scope of this first cut: monsters drop coins, the hero picks them up, the balance
persists and is shown on the HUD. Spending coins (shops, upgrades, fast-travel
tolls, …) is **out of scope** here — it's the next layer, designed against the
`wallet.js` API this doc establishes.

---

## Behaviour

- **Drop on kill.** When a `CloseCombatMonster` dies, roll a drop. On success it
  scatters coins on the ground at the corpse. Default: **50% chance, 1 coin**.
- **Per-species config.** Both the chance and the amount are configurable per
  monster species (`coin_drop_chance`, `coin_drop_amount`), defaulting to
  `0.5` / `1`. Tougher monsters are tuned to drop more (see table below).
- **N separate coins.** A monster worth *N* coins drops *N* individual 1-value
  coin pickups scattered around the corpse (a small "loot pop"), **not** one coin
  carrying the full value. Each coin the hero walks over is worth exactly 1.
- **Physical pickup.** Coins are auto-pickup ground entities (the existing
  `PickableObject` path) — the hero collects one by stepping onto its tile. No
  button.
- **Persistent, per-hero.** The balance survives reloads and, in network co-op,
  **each hero owns their own wallet** (whoever grabs the coin gets it) — identical
  to how ammo/inventory already works (`inventory.js`). Local split-screen co-op
  shares one save slot, so it **folds both heroes onto P1's wallet**, same rule as
  ammo.
- **Real game only.** Drops, pickups and the HUD are gated **out of Tower Defense,
  PvP and creative mode**. TD has its own economy; PvP has no monsters/coins;
  creative is for arranging the world, not farming.

---

## Where it hooks into the existing code

The design deliberately reuses three systems that already exist, rather than
inventing parallel machinery:

1. **Kill detection** — `combat.js` `resolveBullets()`, at the point a target's
   HP crosses 0 and `startDeathAnimation(t)` fires (combat.js:174–180). This is
   the single host-side kill path: bullets *and* melee swings both resolve here
   (a melee swing is a short-lived cross of bullets). Explosive barrels also die
   here but are excluded — coins only drop for `CloseCombatMonster`.
2. **Auto-pickup** — `pickups.js` `checkPickup()` already collects any
   `PickableObject` the hero overlaps. A coin is just a `PickableObject`; the only
   new code is a branch in `trigger()` that credits the wallet instead of ammo.
3. **Persistence + co-op sync** — `storage.js` for the saved balance, and the
   `broadcastHostEvent` / `guestEvents.js` channel that already fans `pickup` /
   `ammoSet` to the right guest. Coins add one parallel event (`coins`).

---

## New files (one feature, one file)

| File | Responsibility |
|---|---|
| `js/wallet.js` | The coin balance store. Per-player count, persisted via `storage.js` (`player.{i}.coins`), local-co-op folds onto P1, network co-op independent. Mirrors `inventory.js` exactly. Exports `getCoins`, `addCoins`, `onWalletChange`, `clearWallet`. Built on `storage.js` (not a raw `localStorage` scan) so it's pure-node testable. |
| `js/coinDrops.js` | The drop logic. `rollCoinDrop(species, rng)` → `{ count }` (pure, deterministic with an injected `rng`, for tests). `maybeDropCoin(zone, entity, rng)` rolls and scatters `count` coin pickups around the dead monster's footprint. Owns the coin-spawn id counter and the TD/PvP/creative gate. |
| `js/coinHud.js` | The HUD counter chip. Mirrors `ammoHud.js`: coin icon (inventory sheet) + balance, listens to `onWalletChange`. Hidden in TD/PvP. |

## Edits to existing files

| File | Change |
|---|---|
| `data/species.json` | Add the **coin species `2010`** (`PickableObject`, sheet `1012`). Add `coin_drop_chance` / `coin_drop_amount` to the monster species that should differ from the default. |
| `js/species.js` | `decorate()` gains `coin_drop_chance ?? 0.5` and `coin_drop_amount ?? 1`. |
| `js/combat.js` | At the kill site, call `maybeDropCoin(zone, t)` right after `startDeathAnimation(t)`. |
| `js/pickups.js` | In `trigger()`, a coin branch *before* the ammo logic: `addCoins(1, playerIndex)`, pickup SFX, broadcast a `coins` host event; skip ammo/weapon/bundle handling. Also skip the `item_collected.<id>` persist for ephemeral coin entities. |
| `js/guestEvents.js` | Handle the `coins` event (a guest credits its own wallet + HUD), mirroring the existing `pickup` / `ammoSet` cases (idempotency-stamped like `pickup`, since it's additive). |
| `js/main.js` | `installCoinHud()` next to `installAmmoHud()`. |
| `data/strings.en.json` · `data/strings.it.json` | Add the `objects.name.coin` display string (EN + IT). |
| New-game wipe path | Wherever "New game (wipe save)" / `clearInventory` resets per-player state, also call `clearWallet()` so a wiped save starts at 0 coins. |

---

## The coin species (`2010`)

```jsonc
{
  "id": 2010,
  "name": "objects.name.coin",
  "entity_type": "PickableObject",
  "sprite_sheet_id": 1012,                  // animated_objects
  "sprite_frame": { "x": 0, "y": 18, "w": 1, "h": 1 },  // ground coin strip
  "sprite_number_of_frames": 6,             // animates via the normal entity pipeline
  "inventory_texture_offset": [11, 5],      // HUD icon: inventory.png cell (row 11, col 5)
  "is_rigid": false,
  "base_speed": 0.0,
  "z_index": 14
}
```

Art coordinates (final, no placeholders):
- **Ground sprite** — `animated_objects` (sheet `1012`), `sprite_frame
  { x: 0, y: 18, w: 1, h: 1 }`, 6 frames. Animates through the normal entity
  pipeline like the keys do.
- **HUD icon** — `inventory.png` cell at row 11, col 5
  (`inventory_texture_offset: [11, 5]` — the codebase reads the offset as
  `[row, col]`). The ammo/kunai chip reads its icon the same way.

Coin pickup entities spawned at runtime carry a **negative ephemeral id** and an
`_ephemeral` flag so `checkPickup` skips writing the `item_collected.<id>` save
key (that key is for hand-placed, level-authored pickups, not loot).

---

## Coin lifetime & placement

- **Scatter.** `count` coins spawn at small random offsets (≈ ±0.5–1 tile) around
  the corpse's footprint centre. Each offset tile is validated against the walk-
  collision mask — a coin that would land on a wall/water/void tile is clamped
  back to the monster's own (reachable) tile rather than stranded somewhere the
  hero can't step. Several coins may share a tile; that's fine (see throughput).
- **Worth exactly 1.** Because the drop is *N separate coins*, every coin entity is
  identical and carries no per-entity value — a plain vanilla `PickableObject`.
  This is what keeps co-op sync trivial (below).
- **Ephemeral, never saved.** Coins live only in `zone.entities`; they are not
  written to the zone's authored JSON and carry no `item_collected` flag. **Leaving
  the zone or reloading drops any uncollected coins** — accepted for the first cut
  (collect-before-you-leave). State this so it isn't mistaken for a bug.
- **Despawn timer (optional, recommended).** Give each coin a lifespan (≈ 30 s)
  after which it's spliced out, so a zone the player lingers in doesn't accumulate
  uncollected loot forever. Implemented like the existing damage-indicator /
  death-fireball ageing loops (a `_lifespan` decremented in a host-side tick), not
  a new scheduler. If we'd rather coins never time out for v1, drop this — but the
  ageing-loop pattern is already there and cheap.
- **Pickup throughput.** `checkPickup()` collects **one** pickup per frame (it
  returns after the first match). A pile of coins on the hero's tile therefore
  drains at one coin/frame — ~20 coins clear in ~⅓ s at 60 fps, which reads as a
  quick "slurp". Worth knowing; not worth special-casing.

## Pickup feel (SFX, no toast)

- **SFX:** reuse `keyCollected` (or `ammoCollected`) for now; a dedicated coin
  "ching" is a trivial later swap. Play it on each coin collected.
- **No toast.** Regular pickups show a `#toast` ("Picked up: …"). Coins **must
  not** — you collect them by the dozen and the toast would spam the top-centre.
  The only feedback is the SFX + the HUD counter ticking up. (This is why the coin
  branch in `trigger()` returns *before* the toast/`showToast` paths.)

---

## Per-species drop tuning (proposed)

Defaults (`0.5` / `1`) apply unless overridden. The intent: chance stays
~50–100%, *amount* scales with how dangerous the monster is.

| Species | id | HP | Proposed chance | Proposed coins |
|---|---|---|---|---|
| Chokeberry | 4003 | 80 | *default* 0.5 | *default* 1 |
| Grapeberry | 4009 | 80 | *default* 0.5 | *default* 1 |
| Blackberry | 4004 | 200 | 0.6 | 2 |
| Blueberry | 4005 | 500 | 0.7 | 3 |
| Strawberry | 4006 | 900 | 0.8 | 5 |
| Gooseberry | 4007 | 1100 | 0.9 | 6 |
| Grapevine (boss) | 4008 | 4800 | 1.0 | 20 |

These are starting values, not load-bearing — easy to retune once there's
something to spend coins on.

---

## Co-op sync (network)

Per-hero wallets, mirroring the ammo path exactly:

- The **host** is authoritative. `checkPickup()` runs host-side against every live
  player (including guests), so the host resolves who grabbed a coin.
- For the **host's own** pickup: `addCoins(1, 0)` locally — done.
- For a **guest's** pickup: the host `addCoins`es nothing to its own wallet and
  instead broadcasts `coins { playerId, amount: 1 }`. The addressed guest credits
  its **own** local wallet (its save is authoritative for the guest, same as
  inventory) and refreshes its HUD.
- The coin **entity** itself reaches guests through the normal zone-entity
  snapshot delta (like any spawned bullet), so guests *see* the coins on the
  ground; only the credit is event-driven.
- **No custom payload to sync.** Because every coin is worth 1 (the *N separate
  coins* decision), the entity is a plain `PickableObject` — no `_coinValue` field
  to serialise, nothing the snapshot whitelist needs to learn about.
- **No desync from the drop roll.** `maybeDropCoin` runs **host-side only** (the
  kill resolves on the host), so the scatter `rng` never runs on a guest — the
  same discipline `mobs.js` already follows for host-side `Math.random`. Guests
  only ever receive the resulting entities.

There is **no save migration**: `player.{i}.coins` is a brand-new key; absent
reads as 0, so existing saves load unchanged.

Local split-screen co-op needs none of this: it's one process, one save slot, and
`wallet.js`'s `effectiveIndex` folds P2→P1 just like `inventory.js`.

---

## HUD placement

A single coin chip (icon + count), DOM, mirroring `ammoHud.js`. Per the project
rule, it's **not** drawn on the canvas. Anchored **top-centre** for the first cut
(health owns top-left, ammo + menu own top-right, the joystick owns the bottom).

> Note: top-centre is already contested (interact hint, toast, TD status bar, host-
> lagging overlay all anchor there — see *Known structural issues* in
> `hud-inventory.md`). The coin chip should be a quiet, narrow pill and may need a
> small offset to coexist; a managed top-centre stack is a separate future pass.

Visibility follows the gate: shown in the normal/co-op game, **hidden in TD and
PvP**. Local split-screen shows one shared chip (the folded P1 wallet); a
per-slice chip per player, like the ammo HUD, is a possible follow-up.

---

## Testing

`tests/economy.test.js` (pure node, no DOM):

- `rollCoinDrop`: chance `0` → `count 0`; chance `1` → `count === coin_drop_amount`;
  a non-`CloseCombatMonster` species → no drop; deterministic via an injected
  `rng`.
- `species.js` decorate defaults: a monster with no coin fields reads back
  `0.5` / `1`.
- `wallet.js`: `addCoins` / `getCoins` round-trip, persistence through
  `storage.js`'s in-memory node shim, and the local-co-op P2→P1 fold.

The drop hook in `combat.js` and the pickup branch in `pickups.js` are exercised
by the existing combat/pickup tests' harness shape; `coinDrops`/`wallet` keep
their DOM-free logic in functions that node can import directly (the same split
`pickups.js` / `combat.js` already use).

---

## Open questions / future layers

1. **Spending.** This doc only mints and stores coins. Shops, upgrades, revive
   costs, fast-travel tolls etc. build on `wallet.js`'s `getCoins` / a future
   `spendCoins` (which would fail if the balance is short).
2. **Drop source breadth.** Only `CloseCombatMonster` drops today. Barrels /
   destructibles / chests could later opt in via the same `coin_drop_*` fields.
3. **Coin magnetism / auto-collect radius.** Walking exactly onto each coin's tile
   is fine for a first cut; a small pickup radius or coins drifting toward a
   nearby hero is a polish pass.
```
