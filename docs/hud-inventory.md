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
| Main / pause menu | `#menu` | `menu.js` | Esc / menu button. Screens (`data-screen`): `pause`, `settings`, `controls` (key bindings), `skills`, `inventory`, `credits`, `creative`. The pause screen is a flat button stack; some buttons just hand off to a sibling overlay (**Multiplayer** → party panel, **Account** → account panel) rather than opening a sub-screen. Inventory body rendered by `inventoryScreen.js` as per-slot (Ranged / Melee) radio panels + an items list. |
| Game over / match result | `#gameover` | `gameOver.js` | On death; reused for PvP winner/draw screens via `showMatchResult()`. |

Pause-menu buttons, in order: Resume · **Multiplayer** (party panel) · **Account** (account panel; label reflects sign-in) · Inventory & Equipment · Skills · Settings · **Creative tools…** (creative-only; opens the `creative` sub-screen) · Credits · New game. The `creative` screen holds the six save/zone authoring tools (export/import save, save/export/reset zone, map editor), so they no longer sit in the pause stack.

Settings screen options: SFX / Music / Mute · Show FPS · **Touch controls** style (buttons / joystick; touch devices only) · **Language** (auto / en / it) · Friendly fire (co-op only) · Key bindings… · **Fullscreen** (`fullscreen.js`, hidden where element-fullscreen is unsupported e.g. iOS Safari) · **Clear cache & reload** (guest-hidden). Fullscreen and Clear cache live here rather than the pause stack to keep the top level short.

> **PvP/co-op setup moved out of the menu.** There is no longer a `data-screen="pvp"`
> menu card — match setup (online/offline × co-op/PvP, invite code, Start match)
> now lives entirely in the **party panel** (see below). The menu only links to it
> via the Multiplayer button.

Notable gated menu items:
- **Guest-hidden** (`data-guest-hidden`): New Game, Clear Cache.
- **Creative-mode-only** (`data-creative-only`): export/import save. Plus `data-desktop-only` (creative **and** fine pointer): save/export/reset zone, map editor.
- **Co-op-only**: friendly-fire toggle, P2–P4 key-binding tabs.

## Network / co-op / PvP / accounts

| Element | DOM id | File | When |
|---|---|---|---|
| Party chip + panel | `#party-chip`, `#party-overlay` | `partyPanel.js` | **Owns all match setup.** Views: `single` (Online co-op / Online PvP / Offline co-op / Offline PvP buttons), `hostingOnline` (invite code + copy/share + "Start match" lobby for online PvP), `hostingOffline` (local co-op/PvP), `guest` (peer list). Peer list with kick; **host vs guest role indication lives here.** Chip hidden offline. |
| Account panel | `#account-overlay` | `accountPanel.js` | Opened from the menu's Account button. Full-screen overlay modal, views (`showView`): `signin`, `register`, `forgot`, `reset` (deep-linked via `?reset=` token), `account` (profile: display name, change password, sign out, **delete-account danger zone** behind a password confirm). |
| Host lagging overlay | `#host-lagging-overlay` | `hostLaggingOverlay.js` | **Guest-only**; host stale >300ms or host paused. Top-center, pulsing. |
| Controller disconnect | `#controller-disconnect` | `controllerPresence.js` | Active gamepad unplugged mid-play. Center modal. |

> **No Turn HUD yet.** A PvP turn indicator (`#turnhud` / `turnHud.js`) was sketched
> in an earlier draft of this doc but **was never built** — no such file or element
> exists. Online PvP is a realtime deathmatch, not turn-based, so there may be
> nothing to add here. Logic-only modules with **no DOM**: `cloudSave.js`,
> `accountSession.js`, `fullscreen.js`.

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
| Health / Ammo | `#health-hud`, `#ammo-hud` | 11 |
| Touch controls | `#touch-controls` | 12 |
| Party chip | `#party-chip` | 13 |
| Toast | `#toast` | 14 |
| Weapon-switch ribbon | `#weapon-switch` | 15 |
| Dialogue | `#dialogue` | 15 |
| Menu | `#menu` | 20 |
| Party overlay | `#party-overlay` | 21 |
| Fast travel | `#fast-travel` | 22 |
| Host lagging | `#host-lagging-overlay` | 22 |
| Account overlay | `#account-overlay` | 22 |
| Message | `#message` | 24 |
| Game over | `#gameover` | 25 |
| Loading / controller-disconnect | `#loading`, `#controller-disconnect` | 30 |

## Known structural issues

Surfaced while building this inventory; worth addressing in a future HUD-layout pass:

1. **Top-center is contested.** Interact hint, toast, and the host-lagging
   overlay all anchor top-center with independent hardcoded offsets and no
   awareness of each other — they can physically overlap (e.g. a toast while a
   lagging guest reads an interact prompt). No managed stack.
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
5. **The pause screen is a flat button stack** (mostly tamed). A normal player
   now sees **8** buttons: Resume, Multiplayer, Account, Inventory, Skills,
   Settings, Credits, New game. Two earlier trims got it there: the six creative
   save/zone tools were folded behind the creative-only **Creative tools…** entry
   into a `creative` sub-screen (creative-on-desktop dropped 16 → 11 at the top
   level), and **Fullscreen** + **Clear cache & reload** moved into the Settings
   screen. Still gated ad hoc by three mechanisms (`data-creative-only`,
   `data-desktop-only`, `data-guest-hidden`). Remaining candidates if it needs to
   shrink further: relocating New game, or grouping the overlay hand-offs
   (Multiplayer / Account).
