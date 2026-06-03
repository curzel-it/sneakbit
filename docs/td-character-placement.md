# Tower Defense — character-driven object placement

Status: **proposed (not built)** · Owner: Federico · Last updated: 2026-06-03

> Companion to [tower-defense-mode.md](./tower-defense-mode.md). This spec covers
> **how the player places and sells build-phase obstacles**, with a path that
> works on **touch** (where the current desktop-only mouse flow falls down). It
> does **not** change the economy, the anti-wall-off rule, or what a barrel *is* —
> only the *interaction* that drops and removes one.

## Why

Placement today (`js/tdBuild.js`) is **mouse-only**:

- `canvasEl.addEventListener("mousedown", …)` → place the selected item on the
  tapped tile (`onMouseDown` → `placeSelected`).
- `canvasEl.addEventListener("contextmenu", …)` → **right-click** to sell
  (`eraseAt`).

On a phone this breaks down in two ways:

1. **No sell.** There is no right-click on touch, so a placed barrel can never be
   removed/refunded.
2. **Awkward placement.** The board is camera-followed and the screen corners are
   taken by the d-pad (bottom-left) and action buttons (bottom-right, `js/touch.js`).
   Tapping an exact tile between your thumbs, on a scrolling board, is fiddly and
   competes with the controls overlay.

The mode already hands the player a **hero that walks the grid one tile at a
time**. Reusing that avatar as the "builder" turns placement into something the
touch controls are already perfect at — *walk to the spot, press a button* — and
gives sell a natural home (a button, not a mouse gesture).

## The idea

During the **build phase**, the **active hero is the cursor**. The player walks it
with the existing movement (d-pad / joystick / WASD), and two action buttons act
on the **tile the hero faces**:

- **Place** — buy + drop the currently-selected build item on the faced tile.
- **Sell** — remove + refund a placed barrel on the faced (or standing) tile.

This is **additive** to the existing tap-to-place: the canvas mouse path stays for
desktop; the character path is the touch-first (and controller-friendly) way in.

### The faced tile

The hero occupies an integer tile (`tileX`, `tileY`) and has a `direction`
(`"up" | "down" | "left" | "right"`). The build cursor is **one tile ahead** in
that direction — the same `DIR_DELTA` table `js/player.js` already uses:

```
cursorTile = { x: hero.tileX + DIR_DELTA[dir][0],
               y: hero.tileY + DIR_DELTA[dir][1] }
```

Facing-ahead (not under-foot) means the hero never has to stand on the tile it's
walling — important, because a hero can't occupy a barrel tile, and you often want
to build the wall you're standing next to.

> **Open question P1 — ahead vs. under-foot.** Facing-ahead is the default. An
> alternative is place-under-foot + step-off, which is simpler to aim but forces a
> shuffle to seal a corridor. Decide during feel-tuning.

### A ghost preview

While in the build phase, render a **ghost** of the selected item on the cursor
tile, tinted by legality:

- **green/normal** — legal (`isLegalBuildTile` true *and* affordable *and* won't
  wall off), 
- **red** — illegal (occupied, out of bounds, would seal the goal, or can't
  afford).

The ghost is **world-space, not UI** — a tinted sprite at a tile, drawn in the
renderer pass, *not* a HUD widget. So it legitimately lives on the canvas and does
not violate the "UI is DOM" rule (which is about buttons / counters / dialogues,
not about a placement preview that exists in tile space).

> **Open question P2 — legality preview cost.** A full wall-off check
> (`spawnsReachGoal` after a hypothetical place) is a flow-field recompute; doing
> it every frame for the ghost may be wasteful. Options: only recompute the
> legality tint on hero-move/selection-change (not per frame), or show a cheaper
> "occupied / affordable" tint live and let the real wall-off rejection fire on
> the actual Place press (with a toast, as today).

## Reused seams (no new placement logic)

All the gameplay rules already exist in `js/tdBuild.js` and stay authoritative —
the character path is a **second caller** of them, not a reimplementation:

| Need | Existing export (`js/tdBuild.js`) |
| --- | --- |
| Place the selected item on (x,y), with afford + wall-off checks + toast | `placeSelected(x, y)` |
| Remove + refund a placed barrel on (x,y) | `eraseAt(x, y)` |
| Is this tile legal to build on? (bounds / walkable / no stack / not goal-or-spawn) | `isLegalBuildTile(state, x, y)` |
| Which item is selected / select another | `getSelectedItem()` / `setSelectedItem(id)` |

Build-phase gating is already enforced inside those functions (each early-returns
unless `isBuildPhase()`), so the character path inherits it for free.

## Input wiring

### Touch

Add **build-phase-only action buttons** to the touch overlay, following the exact
pattern already in `js/touch.js` (`data-action` buttons whose `onPress` dispatches
an intent). Two new buttons, shown **only while `?mode=td` is in the build phase**,
replacing (or sitting alongside) the combat actions that are meaningless mid-build:

- **Place** (`data-action="td-place"`) → calls `placeSelected(cursorX, cursorY)`.
- **Sell** (`data-action="td-sell"`) → calls `eraseAt(cursorX, cursorY)`.

Because `touch.js` must not import the TD feature directly (one-feature-one-file,
and TD modules only load on the TD path), wire these through a small callback the
TD controller registers — mirror how `touch.js` already calls `tryShoot()` /
`tryMelee()` via imported functions, but gate the TD ones behind a registered
handler so the base game never pulls in `tdBuild`. Concretely: `towerDefense.js`
(which already owns the TD frame) registers `{ onBuildPlace, onBuildSell }` with
`touch.js` at TD boot, and `touch.js` shows the two buttons only when that handler
is present and the phase is build.

A new **Switch-hero** touch action is also worth adding here (today switching is
keyboard Tab / the dialog button only) — same registered-handler approach,
calling the controller's `onSwitch`.

### Desktop / controller parity

- Keyboard: bind **Place** / **Sell** to a build-phase key (e.g. the existing
  `shoot` / `melee` actions are free during build, or dedicated keys), routed
  through the same controller callbacks. The canvas mouse path
  (`mousedown` / `contextmenu`) **stays** for mouse users.
- Gamepad inherits the touch action buttons through the existing input-device
  abstraction.

## HUD interplay

This composes with the mobile HUD pass (the status bar + controls dialog in
`js/tdHud.js`):

- The **controls dialog** stays the place to *pick which barrel* and to recruit /
  revive / start the wave.
- The **character path** is how that picked barrel gets onto the board — so the
  flow becomes: open dialog → pick barrel → (dialog can stay open or close) →
  walk hero → Place. No precise tile-tapping required.
- The dialog's build hint should describe the active scheme on touch
  (e.g. *"Walk a hero and tap Place"*) vs. desktop (*"Tap a tile to place · Sell to remove"*).

## What this fixes vs. the interim

| | Interim (mobile HUD pass) | With this spec |
| --- | --- | --- |
| Pick a barrel | ✅ dialog palette | ✅ dialog palette |
| Place on touch | ⚠️ tap canvas (imprecise) | ✅ walk + Place button |
| **Sell on touch** | ❌ none (right-click only) | ✅ Sell button |
| Desktop | ✅ mouse unchanged | ✅ mouse unchanged + parity keys |

## Testing posture

- **Unit (`tests/`):** the placement *rules* are already covered
  (`tests/tdBuild.test.js`: obstacle collision, flow-field block, anti-wall-off,
  palette economy). The cursor math (`hero + DIR_DELTA → cursorTile`) is a pure
  function and unit-testable in isolation.
- **E2E (`tests/e2e/towerDefense.test.mjs`):** extend the existing run to drive a
  Place/Sell **via the registered controller callbacks** (the same way the suite
  already drives `window.td.place(x,y)`), asserting a barrel appears / refunds and
  that the wall-off rejection still fires on an illegal faced tile.
- **Manual:** `?mode=td&touch=1` — walk a hero in build phase, Place a corridor,
  Sell a barrel, confirm the ghost tint tracks legality.

## Open questions

- **P1** — cursor ahead-of-hero vs. under-foot (see above).
- **P2** — ghost legality preview cost: live wall-off check vs. cheap tint +
  on-press rejection (see above).
- **P3** — button real estate: do Place/Sell **replace** the combat actions during
  build (they're useless then) or sit alongside? Replacing is cleaner but means a
  context-swap of the right-hand pad between phases.
- **P4** — should picking a barrel in the dialog **auto-close** it on touch so the
  player drops straight into walk-and-place, or stay open for rapid multi-buys?
- **P5** — multi-place ergonomics: hold-to-place a line of barrels as the hero
  walks, or one press per tile? (One-press is safer for the wall-off check.)
```
