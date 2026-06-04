# HUD / UI inventory

A complete map of every on-screen UI element in the game. Per the project rule
(*"if it's a UI thing, don't implement it in the canvas"*), **all of this is DOM**
— each element owned by exactly one feature file, layered over `<canvas id="game">`.
The only deliberate exceptions are two *world-space* placement overlays (the Tower
Defense build ghost and the map-editor ghost), drawn on the canvas because they
track tiles in the world, not the screen.

The **Z** column is the element's z-index (stacking order, low → high); blank = default / not stacked.

| Category | Name | Where (`#id` · file) | Z | Description |
|---|---|---|---|---|
| In-game HUD | Player HP bars | `#health-hud` · `healthHud.js` | 11 | Up to 4 cards (`P# HP X/Y`), per-player colour (P1 red, P2 cyan, P3 green, P4 amber). Top-left. Hides on death except P1 (kept for the game-over modal). |
| In-game HUD | Ammo / kunai counter | `#ammo-hud` · `ammoHud.js` | 11 | Icon + `x#`. Active player's ammo in PvP, shared pool in co-op. Top-right; shifts left `76px` in touch mode to clear the menu button. |
| In-game HUD | Coins counter | `#coin-hud` · `coinHud.js` | 11 | Coin icon + the hero's wallet balance (`wallet.js`, mirrors the ammo chip but reads coins). Top-centre. Hidden in Tower Defense (own gold HUD) and PvP (no coins). |
| In-game HUD | Controls hint + zone/FPS | `#hud` (`#hud-controls`, `#hud-meta`) · `hud.js` |  | "WASD / arrows · Esc for menu" and "Zone #### · ## fps" (FPS line toggled in Settings). Top-left. |
| In-game HUD | Interact hint | `#interact-hint` · `interact.js` |  | "Press E to talk", only when an interactable NPC is directly in front. Top-centre. |
| Transient | Toast | `#toast` · `toast.js` | 14 | Pickups / hints, auto-dismiss (regular 1s, hint 2s, longHint 3s). Optional sprite icon, optional network broadcast. Top-centre. |
| Transient | Weapon-switch ribbon | `#weapon-switch` · `weaponSelect.js` | 15 | Weapon-cycle feedback (Tab / `` ` `` / gamepad RB·LB). Above the player's head (screen-centred fallback in split-screen), fades ~1.5s; shows the slot's weapons, active highlighted + its name/ammo. |
| Transient | Dialogue box | `#dialogue` · `dialogue.js` | 15 | NPC conversations, advance Space/Enter/Click. Bottom-centre desktop, **top-centre on touch**. Host-driven; guests mirror read-only. |
| Transient | Message modal | `#message` · `message.js` | 24 | Full-screen story beats / chapter intros. |
| Transient | Fast-travel menu | `#fast-travel` · `fastTravel.js` | 22 | At a fast-travel pylon (≥4 zones visited). |
| Menu | Main / pause menu | `#menu` · `menu.js` | 20 | Esc / menu button. `data-screen`: pause · settings · controls · skills · inventory · credits · creative. Pause stack (8): Resume · **Multiplayer** (→party panel) · **Account** (→account panel) · Inventory · Skills · Settings · **Creative tools…** (creative-only) · Credits · New game. Settings: SFX/Music/Mute · Show FPS · Touch-controls style · Language · Friendly fire (co-op) · Key bindings… · Fullscreen (`fullscreen.js`) · Clear cache. |
| Menu | Inventory body | within `#menu` · `inventoryScreen.js` |  | Per-slot (Ranged / Melee) radio panels + items list, rendered into the menu's inventory screen. |
| Menu | Game over / match result | `#gameover` · `gameOver.js` | 25 | On death; reused for PvP winner/draw via `showMatchResult()`. |
| Network | Party chip + panel | `#party-chip`, `#party-overlay` · `partyPanel.js` | 13 / 21 | **Owns all match setup.** Views: `single` (join code + host: Online/Offline × co-op/PvP + **solo: Tower Defense** `#party-tower-defense`), `hostingOnline` (invite code + Start match), `hostingOffline`, `guest` (peer list + kick). Host/guest role shown here. Chip hidden offline. Chip 13, overlay 21. |
| Network | Account panel | `#account-overlay` · `accountPanel.js` | 22 | From the menu's Account button. Views: `signin`, `register`, `forgot`, `reset` (`?reset=` token), `account` (display name, change password, sign out, **delete-account danger zone**). |
| Network | Cloud-save conflict | `#cloud-conflict-overlay` · `cloudConflictPrompt.js` | 30 | First sign-in when a device's local progress differs from its cloud save — the one case `cloudSave` can't auto-resolve. Keep-local vs adopt-cloud; resolves `null` headless → safe default. |
| Network | Host lagging overlay | `#host-lagging-overlay` · `hostLaggingOverlay.js` | 22 | **Guest-only**; host stale >300ms or paused. Top-centre, pulsing. |
| Network | Controller disconnect | `#controller-disconnect` · `controllerPresence.js` | 30 | Active gamepad unplugged mid-play. Centre modal. |
| Tower Defense | Status bar | `#td-hud` · `tdHud.js` | 14 | Top-centre, clear of the pause button. `Wave # · Phase` (Build = green / Wave = orange pill) + lives (`♥ n/max`, reddens ≤25%) + gold + score. Drops to a second row <820px. |
| Tower Defense | Build dock | `#td-dock` · `tdHud.js` | 14 | Bottom-centre (`top:120px` on touch). Timer row: countdown + **Start wave ▶** (early-bonus `+#g`) while building / enemies-left bar during a wave. Main row: **🛢 Shop** or the placing bar + Recruit / Switch / Revive. |
| Tower Defense | Build shop dialog | `#td-shop-dialog` · `tdHud.js` | 20 | Modal from the dock. Barrel catalog cards (sprite + cost). **Start placing ▶** / **Close**. Build timer keeps running behind it. |
| Tower Defense | Run game-over | `#td-gameover` · `tdHud.js` | 22 | On squad defeat. Wave reached + score + best + **New best!** badge. Play again. Separate from `#gameover`. |
| Tower Defense | Build ghost / cursor | *(canvas)* · `tdPlacementPreview.js` |  | **Not DOM** — world-space barrel ghost at a free-roaming tile cursor (green = legal+affordable, red = illegal/unaffordable, red box = remove). The build-phase camera target. |
| Creative | Map editor | `#map-editor` (+ `#map-editor-ghost` canvas) · `mapEditor.js` | 30 / 5 | Creative + desktop. Right-side picker: biome / construction / entity grids (`#me-grid-*`), `#me-selection`, `#me-close`. Click canvas to place, right-click to erase. Panel 30, ghost canvas 5. |
| Creative | Entity inspector | `#entity-inspector` · `entityInspector.js` | 31 | Opened by the map editor on left-click of a placed entity; edits its `after_dialogue` behaviour. Lazy DOM (node-test-safe). |
| Loading | Loading splash | `#loading` · `loadingScreen.js` | 30 | Startup progress bar; fades out after load. |
| Loading | Fade overlay | `#fade` · `transitions.js` |  | Zone transitions; opacity JS-animated (not CSS). |
| Mobile | Touch controls root | `#touch-controls` · `touch.js` | 12 | Shown on first touch or `(pointer: coarse)`; hidden `(min-width:980px) and (pointer:fine)`. Holds the d-pad, action stack and menu button. |
| Mobile | D-pad | `.touch-*` (in `#touch-controls`) · `touch.js` |  | Bottom-left 3×3 grid, `data-dir`, drag-to-switch, synthesizes Arrow keys. |
| Mobile | Floating joystick | `.touch-joystick-*` · `touchJoystick.js` |  | Alternative to the d-pad (Settings toggle). Thumb in the left ~75% → cardinal Arrow keys. Mounted under `#touch-controls`. |
| Mobile | Action stack | `.touch-melee/throw/interact` · `touch.js` |  | Bottom-right: melee (hidden if unequipped), throw → shoot, interact → KeyE. |
| Mobile | Menu button | `.touch-menu` · `touch.js` |  | Top-right 44px hamburger → Escape. |
| Cross-cutting | UI design tokens | `#sb-ui-tokens` · `uiTokens.js` |  | Shared CSS custom props (`--sb-surface-*`, `--sb-card-*`, accents, mono font). Colour/surface only; positioning stays per-feature. |

**Notes**

- **Tower Defense** is a solo/offline mode reached from the party panel's **Tower
  Defense** button or `?mode=td`; every TD branch is gated behind
  `isTowerDefenseMode()` and the HUD only shows during a run
  (`showTdHud()`/`hideTdHud()`). Build-phase input is decoupled from the hero:
  directional input drives the placement cursor, Shoot = build "done", Melee =
  remove. `arcadeCurrency.js` is the game's only economy (a single gold pool +
  `onGoldChange`); logic-only TD modules: `towerDefense.js`, `tdBuild.js`,
  `tdBoard.js`, `tdWaves.js`, `tdEnemies.js`, `tdObstacles.js`.
- **Logic-only (no DOM):** `cloudSave.js`, `accountSession.js`, `fullscreen.js`,
  plus the TD modules above.
- **No Turn HUD.** A PvP turn indicator (`turnHud.js`) was sketched in an old draft
  but never built — online PvP is realtime, not turn-based.

## Buttons & features (what's clickable, where)

Every interactive control, grouped by the screen/panel it lives on, in display
order. Labels are the exact visible strings. Gating in *(parens)*.

**Pause menu** (`#menu`, `data-screen="pause"`) — `Resume (Esc)` · `Multiplayer`
(→ party panel) · `Account` / `Account · <name>` when signed in (→ account panel) ·
`Inventory & Equipment` · `Skills` · `Settings` · `Creative tools…` *(creative-only)*
· `Credits` · `New game (wipe save)` *(guest-hidden; confirms first)*.

**Settings** (`data-screen="settings"`) — `SFX` / `Music` sliders · `Mute all` ·
`Show FPS` · `Touch controls` dropdown (Buttons / Joystick, *touch-only*) ·
`Language / Lingua` dropdown (Auto / English / Italiano) · `Friendly fire (co-op)`
*(co-op-only)* · `Key bindings…` (→ controls) · `Fullscreen` / `Exit fullscreen`
*(hidden if unsupported)* · `Clear cache & reload` *(guest-hidden)* · `Back`.

**Key Bindings** (`data-screen="controls"`) — device tabs `Keyboard` / `Controller`
· player tabs `Player 1`–`Player 4` *(co-op only for P2–P4)* · per-action binding
slots (click → capture key/button; Esc cancels) · `Reset to defaults` · `Back`.

**Skills** (`data-screen="skills"`) — read-only list (Piercing Kunai / Boomerang
Kunai / Bullet Catcher, each UNLOCKED/LOCKED) · `Back`.

**Inventory** (`data-screen="inventory"`, body by `inventoryScreen.js`) — Ranged-slot
radios + Melee-slot radios (incl. `Unarmed`; `◉`/`◯`, ammo + "(default)" tags) ·
read-only item list · `Back`.

**Credits** (`data-screen="credits"`) — external links (source, music, SFX, font,
Privacy Policy, Terms & Conditions) · `Back`.

**Creative tools** (`data-screen="creative"`, all *creative-only*) — `Export save
(copy JSON)` · `Import save (paste JSON)` · `Save zone (flush to server)`
*(+desktop, +editor)* · `Export zone JSON…` *(+desktop)* · `Reset zone (revert to
shipped)` *(+desktop, +editor)* · `Map editor…` *(+desktop, +editor)* · `Back`.

**Party panel** (`#party-overlay`) — by view:
- *single*: join-code input + `Join` · `Online co-op` · `Online PvP` · `Offline
  co-op` · `Offline PvP` · `Tower Defense` (online + TD disabled in creative mode) ·
  `Close`.
- *hostingOnline*: `Copy code` · `Share link` · peer rows (`Kick`) · `Start match`
  (PvP, until then; needs ≥1 peer) / `End session` (after start / co-op) · `Close`.
- *hostingOffline*: player-count toggles `2` / `3` / `4` · `End session (back to
  single player)` · `Close`.
- *guest*: `Leave session` · `Close`.

**Account panel** (`#account-overlay`) — by view:
- *signin*: email + password · `Sign in` · `Create an account` · `Forgot password?`
- *register*: email + display name + password · `Create account` · `Already have an
  account? Sign in`
- *forgot*: email · `Send reset link` · `Back to sign in`
- *reset* (`?reset=` token): new password · `Set new password` · `Back to sign in`
- *account*: `Save display name` · `Change password` · `Sign out` · `Delete account`
  → reveals password confirm with `Permanently delete` / `Cancel`. `Close`.

**Game over / match result** (`#gameover`) — `Continue` (respawn, or rematch in PvP;
briefly disabled on show, hidden while a guest waits for host) · `Back to single
player` *(PvP host only)*. Enter/Space = primary, Esc = back-to-single.

**Fast travel** (`#fast-travel`) — one button per unlocked zone (e.g. `Evergrove ·
zone 1001`) · `Cancel`.

**Tower Defense dock** (`#td-dock`) — `Start wave ▶` (+early-bonus gold) · `🛢 Shop`
(browse) → swaps to placing bar `🛢 Swap` / `✓ Done` · `Recruit hero` (disabled if
too poor) · `Switch hero` (multi-hero) · `Revive <name> (cost)` per fallen hero.
**Shop dialog** (`#td-shop-dialog`): barrel cards (sprite + cost) · `Start placing ▶`
· `Close`. **Run game-over** (`#td-gameover`): `Play again`.

**Map editor** (`#map-editor`, *creative + desktop*) — `×` close · biome /
construction / entity picker grids (click to select) · canvas: left-click place (or
inspect entity), right-click erase, drag to paint, Esc to deselect/close. Selecting a
placed entity opens the **entity inspector** (`after_dialogue` behaviour buttons).

## Known structural issues

Worth addressing in a future HUD-layout pass:

1. **Top-centre is contested.** Coins counter, interact hint, toast, TD status bar
   and the host-lagging overlay all anchor top-centre with independent hardcoded
   offsets and no awareness of each other — they can physically overlap. No managed
   stack.
2. **Top-right collisions handled by magic number.** Ammo HUD, party chip and the
   touch menu button share the corner; touch mode hardcodes a `76px` shove on the
   ammo HUD to dodge the menu button.
3. **~15 independent `<style>` injections.** `uiTokens.js` centralized colours and
   surfaces, but each feature still injects its own positioning/layout CSS. No shared
   notion of HUD regions, so any new element must be manually checked against every
   existing one.
4. **No safe-area handling.** Nothing references `env(safe-area-inset-*)`; on mobile,
   HUD corners and the d-pad can collide with rounded screen corners and the home
   indicator.
5. **The pause screen is a flat button stack** (mostly tamed at 8 buttons). Still
   gated ad hoc by three mechanisms (`data-creative-only`, `data-desktop-only`,
   `data-guest-hidden`). Remaining shrink candidates: relocating New game, or grouping
   the overlay hand-offs (Multiplayer / Account).
