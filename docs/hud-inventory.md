# HUD / UI inventory

A complete map of every on-screen UI element in the game. Per the project rule
(*"if it's a UI thing, don't implement it in the canvas"*), **all of this is DOM**
— each element owned by exactly one feature file, layered over `<canvas id="game">`.

This is a reference for anyone touching the HUD: where an element lives, who
updates it, and the conditions under which it shows. It's also the starting point
for a future HUD-layout pass — see [Known structural issues](#known-structural-issues).

## Persistent in-game HUD (visible during normal play)

| Element | DOM id | File | Notes |
|---|---|---|---|
| Player HP bars | `#health-hud` | `healthHud.js` | Up to 4 cards (`P# HP X/Y`), per-player color (P1 red, P2 cyan, P3 green, P4 amber). Top-left. Hides on death except P1 (kept for the game-over modal). |
| Ammo / kunai counter | `#ammo-hud` | `ammoHud.js` | Icon + `x#`. Active player's ammo in PvP, shared pool in co-op. Top-right; shifts left (`76px`) in touch mode to clear the menu button. |
| Controls hint + zone/FPS | `#hud` (`#hud-controls`, `#hud-meta`) | `hud.js` | "WASD / arrows · Esc for menu" and "Zone #### · ## fps". FPS line toggled in Settings. Top-left. |
| Interact hint | `#interact-hint` | `interact.js` | "Press E to talk", only when an interactable NPC is directly in front. Center-top. |

## Transient / contextual

| Element | DOM id | File | When |
|---|---|---|---|
| Toast | `#toast` | `toast.js` | Pickups / hints, auto-dismiss (regular 1s, hint 2s, longHint 3s). Optional sprite icon, optional network broadcast. Top-center. |
| Weapon-switch ribbon | `#weapon-switch` | `weaponSelect.js` | Quick weapon-cycle feedback (Tab / `` ` `` / gamepad RB·LB). Anchored just above the player's head (screen-centered fallback in split-screen), fades ~1.5s; shows the slot's weapons with the active one highlighted + its name/ammo. |
| Dialogue box | `#dialogue` | `dialogue.js` | NPC conversations, advance with Space/Enter/Click. Bottom-center on desktop, **top-center on touch** (`pointer: coarse`). Host-driven; guests mirror read-only. |
| Message modal | `#message` | `message.js` | Full-screen story beats / chapter intros. |
| Fast travel menu | `#fast-travel` | `fastTravel.js` | At a fast-travel pylon (≥4 zones visited). |

## Menus & overlays

| Element | DOM id | File | When |
|---|---|---|---|
| Main / pause menu | `#menu` | `menu.js` | Esc / menu button. Screens: pause, settings, key-bindings, skills, inventory, credits, **PvP setup** (`data-screen="pvp"`, player-count buttons). Inventory body rendered by `inventoryScreen.js` as per-slot (Ranged / Melee) radio panels + an items list. |
| Game over / match result | `#gameover` | `gameOver.js` | On death; reused for PvP winner/draw screens via `showMatchResult()`. |

Notable gated menu items:
- **Guest-hidden** (`data-guest-hidden`): Open/Exit PvP, New Game, Clear Cache.
- **Creative-mode-only** (desktop): export/import save, save/export/reset zone, map editor.
- **Co-op-only**: friendly-fire toggle, P2–P4 key-binding tabs.

## Network / co-op / PvP

| Element | DOM id | File | When |
|---|---|---|---|
| Party chip + panel | `#party-chip`, `#party-overlay` | `partyPanel.js` | Offline / hosting / guest / local-coop views. Invite code, copy/share, peer list with kick. **Host vs guest role indication lives here.** Chip hidden offline. |
| Host lagging overlay | `#host-lagging-overlay` | `hostLaggingOverlay.js` | **Guest-only**; host stale >300ms or host paused. Top-center, pulsing. |
| Turn HUD | `#turnhud` | `turnHud.js` | **PvP-only** — whose turn, prep countdown, "turn ending" flash. Updated per frame from `pvpMatch`. Top-center. |
| Controller disconnect | `#controller-disconnect` | `controllerPresence.js` | Active gamepad unplugged mid-play. Center modal. |

## Loading / transitions

| Element | DOM id | File | When |
|---|---|---|---|
| Loading splash | `#loading` | `loadingScreen.js` | Startup, progress bar; fades out after load. |
| Fade overlay | `#fade` | `transitions.js` | Zone transitions; opacity JS-animated (not CSS). |

## Mobile / touch-only

All under `#touch-controls`, owned by `touch.js`. Shown on first touch or
`(pointer: coarse)`; hidden on `(min-width: 980px) and (pointer: fine)`.

- **D-pad (bottom-left)** — 3×3 grid, `data-dir="up|down|left|right"`, drag-to-switch between buttons, synthesizes Arrow keys.
- **Action stack (bottom-right)**, `data-action`:
  - `melee` (`.touch-melee`) — hidden if no melee weapon equipped.
  - `throw` (`.touch-throw`, red tint) — synthesizes shoot.
  - `interact` (`.touch-interact`, green tint) — synthesizes KeyE.
- **Menu button (top-right)** — `.touch-menu`, 44px hamburger → Escape.
- Dialogue box also repositions to the top in this mode.

## Cross-cutting

- **UI design tokens** — `#sb-ui-tokens` / `uiTokens.js`: shared CSS custom
  properties (`--sb-surface-*`, `--sb-card-*`, accent colors, monospace font).
  Centralizes color/surface styling; positioning is still per-feature.

## Z-index reference

| Layer | id | z-index |
|---|---|---|
| Turn HUD | `#turnhud` | 8 |
| Health / Ammo | `#health-hud`, `#ammo-hud` | 11 |
| Touch controls | `#touch-controls` | 12 |
| Toast | `#toast` | 14 |
| Weapon-switch ribbon | `#weapon-switch` | 15 |
| Dialogue | `#dialogue` | 15 |
| Menu | `#menu` | 20 |
| Fast travel | `#fast-travel` | 22 |
| Host lagging | `#host-lagging-overlay` | 22 |
| Message | `#message` | 24 |
| Game over | `#gameover` | 25 |
| Loading / controller-disconnect | `#loading`, `#controller-disconnect` | 30 |

## Known structural issues

Surfaced while building this inventory; worth addressing in a future HUD-layout pass:

1. **Top-center is contested.** Interact hint, toast, host-lagging overlay, and
   turn HUD all anchor top-center with independent hardcoded offsets and no
   awareness of each other — they can physically overlap (e.g. a toast during a
   PvP turn, or a lagging guest reading an interact prompt). No managed stack.
2. **Top-right collisions are handled by magic number.** Ammo HUD, party chip,
   and the touch menu button share the corner; touch mode hardcodes a `76px`
   shove on the ammo HUD to dodge the menu button.
3. **~15 independent `<style>` injections.** `uiTokens.js` centralized colors and
   surfaces, but each feature still injects its own positioning/layout CSS. There
   is no shared notion of HUD regions, so any new element must be manually checked
   against every existing one.
4. **No safe-area handling.** Nothing references `env(safe-area-inset-*)`; on
   mobile, HUD corners and the d-pad can collide with rounded screen corners and
   the home indicator.
