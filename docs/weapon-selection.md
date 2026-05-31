# Weapon selection (quick-switch overlay)

Port of the original game's **quick weapon-switch** feature: a single button that
pops a compact weapon picker over live gameplay so you can swap your equipped
melee/ranged weapon without diving into the pause menu. It exists mostly for
**controller play** — on a gamepad there's no fast way to re-equip today (the only
path is Esc → menu → Inventory tab → click *Equip*), which is clumsy mid-fight.

Status: **spec / not implemented.**

---

## What the original does (reference: `../dev/sneakbit`)

A read of the Rust source establishes the canonical behavior we're porting:

- **Binding** — `game/src/features/inputs.rs`: `KEY_TAB`, or gamepad
  `GAMEPAD_BUTTON_RIGHT_FACE_UP` (Y on Xbox / Triangle on PlayStation). Tracked as a
  one-shot `weapon_selection_pressed` edge in `keyboard_events_provider.rs`, resolved
  **per player** (`index_of_any_player_who_is_pressing_weapon_selection()`).
- **UI** — `game/src/gameui/weapon_selection.rs`: a **grid** (`columns: 5`) drawn
  bottom-center as a HUD overlay, listing every weapon the player owns. State machine
  is `Closed` / `SelectingWeapon(index)`. Navigation: ↑/↓ jump by a row (±5), ←/→ by
  one; confirm with X/A; back/Esc closes. Each cell shows the weapon icon; the
  selection shows name + ammo count.
- **Gate** — only opens when there's a real choice:
  `melee_count >= 2 || ranged_count >= 2`. With one weapon per kind there's nothing to
  pick, so the press is swallowed.
- **Effect** — confirming calls `set_equipped()`, which writes the per-player,
  per-kind slot (`currently_equipped_ranged_weapon` / `..._melee_weapon`). Melee and
  ranged are independent slots; picking a sword sets the melee slot, picking the AR15
  sets the ranged slot.
- **Weapons** (`game_core/src/entities/known_species.rs`): melee = Sword (1159);
  ranged = Kunai launcher (1160, the default, "invisible"), AR15 (1154), Dark AR15
  (1182), Cannon (1167). Ranged consume ammo from inventory; melee do not.

The world **keeps running** behind the overlay — it's a HUD layer updated each frame,
not a hard pause.

### Where this port deliberately diverges

The original is a grid you open, navigate, and confirm. We're **not** porting that.
For the HTML version the goal is a *rapid* switch — one button that flips between your
ranged weapons (kunai launcher ↔ AR15 ↔ …) without ever stopping play. So:

- **Cycle, not grid.** Each press equips the next weapon in that slot; no cursor, no
  confirm step, no modal you navigate.
- **Live, never paused.** The world keeps running, in every mode (the original's grid
  also ran live, so this is faithful in spirit even though the widget differs).
- **Per-slot, not unified.** Melee and ranged are *both* equipped at once and fired by
  different keys (shoot vs. swing), so there is no single "active weapon" to cycle. A
  flat all-weapons list would be incoherent (switching to the sword can't unequip the
  AR15 — they coexist). Instead each slot cycles **independently on its own input**, the
  Dark-Souls model: `SLOT_RANGED` and `SLOT_MELEE` each get their own prev/next inputs.
  Each is gated on owning `≥2` weapons of that kind.
- **Bidirectional.** Cycling goes both ways (prev / next) — a shoulder pair on the pad,
  two keys on the keyboard — so you can back up one weapon instead of looping all the
  way around.
- **Melee cycle is future-proofing.** The game's current content has exactly one melee
  weapon (Sword), so the melee cycle is inert until a second one ships. We build the
  mechanism now but leave its binding **unbound by default** — see the binding section.

---

## How this maps onto the HTML port

The port already has every primitive this feature needs; we are adding an input path
and a DOM overlay, not new game state.

| Concern | Already exists | File |
|---|---|---|
| Equipped melee/ranged slot, per player | `getEquipped` / `setEquipped(slot, id, index)`, `SLOT_MELEE`/`SLOT_RANGED`, `DEFAULT_RANGED_WEAPON_ID` (1160) | `js/equipment.js` |
| What weapons the player owns | `snapshotInventory(index)` → `{speciesId: count}`; weapons are items whose `associated_weapon` points at the weapon species | `js/inventory.js`, `js/inventoryScreen.js` |
| Equip-change broadcast (HUD/touch/sprite resync) | `onEquipmentChange(fn)` | `js/equipment.js` |
| Rebindable keyboard action + code→action routing | `ACTIONS`, `codesFor`, `resolveAction`, `actionForCode` | `js/keyBindings.js` |
| Rebindable gamepad action + button→action routing | `GAMEPAD_ACTIONS`, `buttonFor`, `actionForButton` | `js/gamepadBindings.js` |
| Network-coop loadout sync (the path pickups already use) | session map + `event:loadout` broadcast | `js/sessionLoadouts.js`, `js/pickups.js` |
| Weapon icon source | species `inventory_texture_offset` `[row,col]` on the inventory sheet (same icons the ammo HUD + inventory screen draw) | `js/ammoHud.js`, `js/inventoryScreen.js` |

Per the project rule (*"if it's a UI thing, don't implement it in the canvas"*) the
overlay is **DOM**, layered over `<canvas id="game">`, like every other HUD element in
[`hud-inventory.md`](hud-inventory.md). One feature, one file.

---

## Proposed design

One press = equip the next weapon **in one slot**. No modal, no confirm, no pause. The
only UI is a small **transient ribbon** that flashes the weapons you own in that slot
with the newly equipped one highlighted, then fades — so you get a preview of what you
switched to without anything to dismiss. Ranged and melee are two independent bindings
driving the same mechanism.

### New file: `js/weaponSlots.js` — shared per-slot enumeration

The quick-switch cycle and the inventory screen must agree on *"what weapons are in this
slot, in what order, which is active."* If each computed that itself they'd drift, so it
lives in one place (the architecture rule: when two features keep reaching into each
other, push the shared bit into its own file). Pure logic, no DOM — directly unit-testable.

```js
// One ordered entry per equippable weapon for the slot.
// { id, species, count, ammo, isEquipped, isDefault }
export function weaponsInSlot(slot, playerIndex = 0)
```

Rules it encodes (the single source of truth for both UIs):
- **Ranged** — always leads with the default kunai launcher (1160, `isDefault`), then
  every owned ranged weapon (inventory item whose `associated_weapon` →
  `WeaponRanged`), ordered by species id. `ammo` from `inventory.js`.
- **Melee** — every owned `WeaponMelee`, ordered by species id. No implicit default
  (melee has no baseline). The inventory screen adds an explicit *Unarmed / none* choice
  on top of this list; the cycle does not (you don't cycle *to* nothing).
- `isEquipped` compares against `getEquipped(slot, playerIndex)`.

It reads `inventory.js` + `species.js` + `equipment.js`; it does **not** write — commits
stay with the callers so the netcode/broadcast path isn't duplicated.

### New file: `js/weaponSelect.js`

Owns the cycle logic and the transient ribbon element. Pure DOM for the ribbon; the
list comes from `weaponSlots.js`. Public surface:

```js
export function cycleWeapon(slot, playerIndex = 0, dir = +1) // equip next/prev in weaponsInSlot(slot,…); no-op if < 2
```

There's no open/close/isOpen state because there's no modal — the ribbon is
self-dismissing (a timer, like `toast.js`). The `< 2` gate reads
`weaponsInSlot(slot,…).length`.

### New rebindable actions (bidirectional, per slot)

The cycle goes both ways, so each slot gets a **prev** and a **next** action — four in
all — in **both** `keyBindings.js` (`ACTIONS` / `ACTIONS_P2`) and `gamepadBindings.js`
(`GAMEPAD_ACTIONS` / `GAMEPAD_ACTIONS_P2`). Each maps to `cycleWeapon(slot, …, dir)`
with `dir = -1` (prev) or `+1` (next); direction comes from *which action fired*, which
keeps it inside the existing single-code binding model (no modifier combos to store).

| Action | Label | Default key (P1) | Default gamepad |
|---|---|---|---|
| `rangedNext` | Next ranged weapon | **`Tab`** | **RB** (button `5`) |
| `rangedPrev` | Prev ranged weapon | **`Backquote`** (`` ` ``, next to Tab) | **LB** (button `4`) |
| `meleeNext`  | Next melee weapon  | **unbound** | **unbound** |
| `meleePrev`  | Prev melee weapon  | **unbound** | **unbound** |

Why these defaults:
- **Gamepad LB/RB** (shoulder pair) is the genre-standard for weapon cycling and is
  inherently bidirectional — a better fit than the original's single Y button, so we
  diverge here deliberately. (Y / button 3 stays free for a future binding.)
- **Keyboard Tab / Backquote** — Tab matches the original's key for "next"; Backquote
  sits right next to it and is otherwise unused, giving a natural "prev" without a
  modifier combo (the binding model stores plain `e.code`, so `Shift+Tab` isn't
  expressible; a dedicated key is cleaner).
- **Melee unbound** because current content has only one melee weapon so it'd never
  fire. Wiring the actions now means enabling melee cycling later is a default change
  (or the player binds keys/buttons in Settings) — no new plumbing.
- **P2–P4** ship all four unbound, consistent with the other extra-player secondaries.

Notes:
- `Tab` is the browser focus-traversal key — the keydown handler must `preventDefault()`
  on it when consumed so focus doesn't walk the DOM.
- Both bindings modules migrate by overlaying stored values onto defaults, so **no
  storage migration is needed** — existing saves just gain the new actions.

### Input wiring

- Keyboard: `input.js` already routes a keydown through `resolveAction(code)` →
  `{playerIndex, action}`. Add branches mapping the four actions to
  `cycleWeapon(slot, playerIndex, dir)` — `ranged*`→`SLOT_RANGED`, `melee*`→`SLOT_MELEE`,
  `*Next`→`+1`, `*Prev`→`-1`. One-shot edge (fires on keydown, ignores auto-repeat);
  `preventDefault()` so `Tab` doesn't move DOM focus. **No input capture** —
  movement/shoot/melee keep working, since nothing is modal.
- Gamepad: `gamepad.js` resolves a pressed button via `actionForButton`; same one-shot
  edge dispatch to `cycleWeapon`. LB/RB give prev/next out of the box.

### Cycle behavior (per slot)

1. **Candidate list** — `weaponsInSlot(slot, playerIndex)` from `weaponSlots.js` (the
   shared enumeration above). The cycle ignores the inventory screen's extra *Unarmed*
   choice — you cycle only among actual weapons.
2. **Gate** — if the slot's list has `< 2` entries, the press is a no-op (optionally a
   brief toast: "No other weapons"). This is what makes melee inert today (one Sword)
   and the ranged cycle silent until you've picked up a second gun.
3. **Advance** — find the currently-equipped weapon for the slot, step by `dir`
   (`+1` next / `-1` prev), wrapping at both ends, and equip that weapon.
4. **Commit** — equipping routes through the **same path pickups use** so all modes
   stay in sync: set the slot via `setEquipped(slot, weaponId, index)`, and in network
   co-op also update the session map + broadcast `event:loadout` (factor the shared bit
   out of `pickups.js` if it isn't already reusable). `onEquipmentChange` then resyncs
   the ammo HUD, the on-sprite equipment overlay, and the touch melee-button visibility
   automatically.
5. **Feedback** — show the transient ribbon (the slot's weapons, active one highlighted,
   name + ammo for ranged) for ~1.5 s, refreshed on each press so rapid presses keep it
   visible. The ammo HUD also updates live via its existing `onEquipmentChange`
   listener.

### HUD registration

The ribbon (`#weapon-switch`, owned by `weaponSelect.js`) is a transient,
**screen-centered** flash: the slot's weapons in a horizontal strip, active one
highlighted, fading after ~1.5 s (refreshed on each press). Dead-center is currently
uncontested — the crowded regions in [`hud-inventory.md`](hud-inventory.md) are the top
corners/top-center, not the middle — so it won't collide with the HP/ammo/toast/turn
HUD. Add a row + z-index entry to that doc; the toast/dialogue band (~14–16) is right,
and it never needs to sit over the pause menu.

---

## Inventory screen changes (`inventoryScreen.js`)

Today the inventory tab (`inventoryScreen.js`) shows a two-line *equipped* header
(Melee / Ranged) plus one flat, weapons-first item list with inline **Equip** /
**Equipped** / **Unequip** controls. That treats equipping as an attribute of an item.
Once quick-switch exists, the organizing concept is the **slot**, and the menu should
read the same way the ribbon does — a slot is a small set of weapons with exactly one
active. The two surfaces become the persistent and the transient view of the same model.

### New layout

Two **slot panels** at the top, then a plain items list:

```
RANGED                            MELEE
 ◉ Kunai launcher   x∞ (default)   ◯ Unarmed
 ◯ AR-15            x24            ◉ Sword
 ◯ Cannon          x3

ITEMS
 Health potion  x2
 Gold key       x1
```

- Each panel renders `weaponsInSlot(slot, playerIndex)` from `weaponSlots.js` — the
  **same source the cycle uses**, so the menu and the ribbon never disagree on contents
  or order. The melee panel prepends an explicit **Unarmed** row (melee can be empty;
  ranged cannot, it falls back to the kunai launcher).
- It's a **single-select per panel** (radio semantics): the active weapon is marked
  (`◉` / highlight); clicking another row equips it. This replaces the per-item *Equip*
  button and the separate melee *Unequip* button — "Unequip melee" is now just selecting
  *Unarmed*, and the kunai launcher's "(default)" tag stays.
- Ranged rows show ammo count; melee rows don't (parity with the ribbon and the original).
- **No `≥2` gate here** — the cycle hides when there's nothing to switch to, but the
  menu always shows the slot and lets you pick whatever you own (including re-selecting
  the only option). The gate is a quick-switch nicety, not a model rule.

### Commit path — unified

All three equip surfaces (pickup auto-equip, quick-switch cycle, inventory panel) must
run the **same commit** so co-op stays in sync. Factor it into one helper — the natural
home is `equipment.js` or a thin `equipWeapon(slot, id, playerIndex)` that:
1. `setEquipped(slot, id, playerIndex)`, and
2. in network co-op, updates the session map + broadcasts `event:loadout`
   (`sessionLoadouts.js` / the path `pickups.js` already uses).

`inventoryScreen.js` currently calls bare `setEquipped`/`clearEquipped` — that's a
latent co-op bug (equipping from the menu in network co-op may not broadcast). Routing
it through the shared helper fixes that as a side effect of this work. The panel
re-renders on `onEquipmentChange` so the radio state flips live, including when the
*ribbon* or a *pickup* changes the slot while the menu is open.

### Out of scope / unchanged

- Non-weapon items keep their display-only list (counts, names) — slots are a
  weapons-only concept.
- Local co-op still renders a single shared section (P2 folds to index 0), as today.

---

## Mode-specific behavior

- **Single player** — straightforward; `playerIndex` 0. The press never interrupts
  play; you can cycle while moving.
- **Local co-op (shared screen)** — `equipment.js` folds P2→P1 (index 0) onto one save
  slot, so any local co-op player's press edits the **shared** ranged loadout, same as
  the inventory screen does today. Routed to the pressing player via `resolveAction`,
  but the slot is shared. Since nothing is modal, both players keep playing — no
  freeze, no screen ownership problem.
- **Network co-op** — must go through the session-map + `event:loadout` path
  (`sessionLoadouts.js`), not a bare `setEquipped`, or the host's view of the guest's
  loadout won't update. The guest applies locally (write-through to localStorage) just
  like pickups do.
- **PvP** — loadouts live in `pvpLoadout.js` (non-persisted, per-match pool). PvP
  weapon assignment is its own system; **disable the cycle in PvP for v1** (early return
  in `cycleWeapon` when `isPvp()`), revisit later if mid-match switching is wanted.
- **Touch** — the on-screen control stack (`touch.js`) can gain a small "switch weapon"
  button that calls `cycleWeapon(SLOT_RANGED, 0)` — trivial since there's no modal to
  drive, just a tap that advances. Nice-to-have for v1; the ribbon feedback already
  works on touch for free, and the slot panels in the inventory tab are tap-friendly.

---

## Edge cases

- **Tab default + browser focus** — must `preventDefault()` the `Tab` keydown when the
  action fires, or focus walks the DOM. Route it through `input.js`'s existing handler
  rather than a fresh listener.
- **Only the kunai launcher owned** (ranged) / **only the Sword owned** (melee) — gate
  returns false (`< 2` candidates); the press does nothing. This is the normal melee
  state in current content.
- **Ranged with zero ammo** — still cyclable/equippable (matches original; shooting then
  plays the no-ammo SFX). Ribbon shows the `x0` count.
- **Equipped weapon dropped from inventory** elsewhere — the candidate list is rebuilt
  on each press, so a stale equipped id just means the cycle starts from the default.
- **Holding the key / auto-repeat** — cycle is an **edge-triggered** one-shot (fires on
  keydown, not on OS key-repeat), consistent with `keyboard_events_provider`'s
  pressed-this-frame semantics. Otherwise holding Tab would spin through every weapon.
- **Cycle while dead / in a dialogue / menu open** — suppress, same guards
  `shooting.js`/`melee.js` already apply before acting.

---

## Decisions (locked)

- **Cycle, not grid** — one press advances to the next/prev weapon in a slot. ✅
- **Live, never paused** — in every mode. ✅
- **Per-slot, bidirectional bindings** — `ranged{Next,Prev}` (default `Tab`/`` ` `` and
  RB/LB) and `melee{Next,Prev}` (unbound), each gated on `≥2` owned weapons of that
  kind. Mechanism is built now; melee bindings are dormant until a second melee weapon
  exists. ✅
- **Ribbon** — yes, a transient **screen-centered** strip highlighting the new
  selection, fading after ~1.5 s. ✅
- **PvP** — disabled in v1. ✅

Everything is decided; no open questions remain.

---

## Testing

- **Unit** (`tests/`, node, no DOM) — `weaponSlots.js` is the prize, since both UIs
  depend on it: `weaponsInSlot(slot, …)` list building + order, ranged-includes-default-
  kunai vs. melee-has-no-default, `isEquipped`/`isDefault`/`ammo` fields, and the
  cycle's wrap-around index advance (current → next, last → first) + `< 2` gate. All
  pure, no DOM.
- **Note** — per [unit-tests-skip-dom-modules], a syntax error in the DOM-touching
  modules (`weaponSelect.js`, `inventoryScreen.js`) passes `test:unit` green. Validate
  both with `node --check`, and since the equip path now broadcasts, run an e2e check
  before pushing.
- **E2E** (`tests/e2e/`) — the shared commit path broadcasts `event:loadout`, so
  add/extend a co-op test asserting the host sees a guest's switch — exercise it from
  **both** the cycle and the inventory panel (the latter is the path that historically
  used a bare `setEquipped` and may not have broadcast).
- **Manual** — controller: RB/LB cycle ranged weapon forward/back, ammo HUD + on-sprite
  weapon resync, centered ribbon flashes the new weapon; holding the button doesn't
  spin; nothing happens with only the kunai launcher owned; disabled in a PvP match.
  Keyboard: `Tab` next, `` ` `` prev. Inventory tab: ranged/melee slot panels show
  radio-select, *Unarmed* clears melee, selection flips live if the ribbon changes it.

---

## Files touched

| File | Change |
|---|---|
| `js/weaponSlots.js` | **New.** Shared `weaponsInSlot(slot, index)` enumeration — single source of truth for both UIs. Pure, unit-tested. |
| `js/weaponSelect.js` | **New.** `cycleWeapon(slot, index, dir)` + transient ribbon DOM. |
| `js/keyBindings.js` | Add `rangedNext`/`rangedPrev` (default `Tab`/`` ` ``) + `meleeNext`/`meleePrev` (unbound). |
| `js/gamepadBindings.js` | Add `rangedNext`/`rangedPrev` (default RB/LB = btn 5/4) + `meleeNext`/`meleePrev` (unbound). |
| `js/input.js` | Route the four new actions to `cycleWeapon(slot,…,dir)`; `preventDefault` on `Tab`. |
| `js/gamepad.js` | Route the four new gamepad actions to `cycleWeapon(slot,…,dir)`. |
| `js/inventoryScreen.js` | Redesign to slot panels (radio-select per slot, *Unarmed* for melee, items list below). |
| `js/equipment.js` *(or new helper)* | Shared `equipWeapon(slot, id, index)` commit used by cycle, inventory, and pickups (fixes the inventory-menu co-op broadcast gap). |
| `js/pickups.js` | Point auto-equip at the shared commit helper. |
| `docs/hud-inventory.md` | Add the ribbon row + z-index; note the inventory tab now renders slot panels. |
