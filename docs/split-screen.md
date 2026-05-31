# Split-screen local multiplayer — spec

Status: **implemented** · Owner: Federico · Last updated: 2026-05-31

Live: `js/splitScreen.js` owns layout + per-slice cameras; `renderer.js`
`renderViewports()` draws the slices; `main.js` wires `state.cameras`
(`cameras[0]` aliases `state.camera`) and per-slice `applyCamera`; `healthHud.js`
anchors bars per slice. Coverage: `tests/splitScreen.test.js` (pure layout
math) + `tests/e2e/splitScreenLayout.test.js` (live grid across window-size ×
player-count). One deviation from the spec below: `camera.js`'s array-averaging
is **kept** (the online guest path still uses it); only local co-op's use of the
shared averaged camera was removed.

Local co-op (`coopMode.js`) today puts 2–4 players in one shared world driven
from one keyboard, but renders a **single camera that averages every live
player's position**. That keeps everyone on one screen only as long as they
stay close; the moment partners walk apart, one of them is shoved off-frame.

This spec replaces the averaged camera with **split-screen**: one viewport
slice per local player, each following its own player, laid out to fit the
current window. It is the natural pairing for couch co-op and is what makes
"players roam apart" actually playable.

## Requirements (authoritative)

1. **All platforms, but input-gated.** Split-screen works everywhere the game
   already runs — desktop browser, the planned Electron desktop shell, and
   mobile — but it is only meaningful with **keyboard and/or controllers**
   (each player needs their own input device). On a touch-only device there is
   no sensible multi-player input scheme, so touch-only split is **deferred**
   (figure out later); a phone with paired controllers still gets split-screen.
   It is not an Electron-only or desktop-only feature.
2. **Replaces the shared camera entirely.** The averaged/midpoint camera and
   its supporting helpers are removed, not toggled. Single-player is simply the
   N=1 case of the same slicing system (one slice = full window), so there is no
   second code path to maintain.
3. **One slice per player**, with a layout chosen from the **current window
   size** (re-evaluated on every resize / orientation change).
4. **Layout rules:**
   - **1 player:** full window.
   - **2 players:** **wide** → side-by-side (1×2); **tall** → stacked (2×1).
   - **3 players:** three equal slices is preferred — **wide** → 3 columns
     (1×3), **tall** → 3 rows (3×1). **Exception:** when the window is
     **near-square** (aspect between 3:4 and 4:3 inclusive), use a **2×2 grid
     with one empty cell** instead of three squeezed slices.
   - **4 players:** always a **2×2** grid, regardless of window shape.

Aspect bands (aspect = `vw / vh`):
- **wide:** aspect > 4:3 (≈1.333)
- **tall:** aspect < 3:4 (≈0.75)
- **near-square:** 3:4 ≤ aspect ≤ 4:3 — only affects the 3-player case (→ 2×2
  with one blank cell). For 2 players, near-square falls back to the dominant
  axis (`vw >= vh` → columns, else rows).

## Non-goals

- **Online play never uses split-screen — gg.** In online co-op / PvP there is
  no reason to show another player's POV: every machine already renders its own
  *follow-self* window (see `mirrorWorld.js` / the host-render path in
  `main.js`). Split-screen is strictly a **local-players-on-one-machine**
  feature and the online render path is left exactly as it is. The only nuance
  is a host that *also* has local co-op players on the same machine — deferred
  (see Open questions).
- No change to input, world simulation, save model, or netcode. Players already
  have independent keymaps (`COOP_KEYMAPS`) and per-player HP/death state; only
  *what each player sees* changes.
- No per-slice audio (audio stays global/one listener).

## Current coupling to a single camera (what has to change)

`state.camera` is a single object created once (`createCamera()` in `main.js`)
and threaded everywhere. The places that assume "one camera for the whole
canvas":

| Location | Today | Needs |
| --- | --- | --- |
| `main.js` `applyCamera()` / `hostCameraTarget()` | averages all live players into `state.camera` | per-slice camera, each following one player |
| `main.js` render call | `render(renderer, zone, state.camera, renderPlayers, frame)` once | one `render(...)` per slice into that slice's rect |
| `camera.js` `cameraDestination()` | averages an array of players | follow exactly one player (clamp logic stays) |
| `zoom.js` `applyAutoZoom()` | sizes one canvas + sets `camera.w/h` from the whole viewport | size per-slice tile counts from each slice's pixel rect |
| `renderer.js` `render()` | `fillRect(0,0,canvas.width,canvas.height)` and the darkness overlay span the whole canvas | clip + translate to the slice; black-fill and light-cone use the slice rect |
| `renderer.js` `drawDarkness()` | light cone centres on `player[0]` | centre on the slice's own player |
| `zoneVisibility.js` `updateVisibleEntities()` | already accepts an array of camera rects ✅ | pass one rect per slice (no change needed) |
| HUD: `healthHud.js`, `ammoHud.js`, `hud.js`, `turnHud.js`, touch controls | fixed-position, single-anchor DOM | anchored per-slice (DOM, never canvas — see CLAUDE.md) |

Good news: `updateVisibleEntities` was already generalised to N viewports for
online co-op, so the simulation half is mostly ready.

## Design

### New feature file: `js/splitScreen.js`

Owns the **layout** and the **per-player cameras**. Single responsibility:
"given the window size and the live local-player list, produce N slice rects
(in device/backing pixels) and N cameras." It does not render and does not
read game logic beyond the player list.

Exports (sketch):

```js
// Decide grid shape from window size + player count (Requirement 4).
export function computeLayout(playerCount, vw, vh) // → { cols, rows, cells: [{col,row}] }

// Per-slice pixel rect within the canvas backing store, plus the slice's
// integer tile count (reusing zoom.js's pixel-perfect scale rule per slice).
export function sliceRects(canvas, layout) // → [{ x, y, w, h, tilesW, tilesH, scale }]

// One camera per local player, each following that player (createCamera()-shaped).
export function ensureCameras(state) // keeps state.cameras[] in sync with player count
```

### Layout algorithm (Requirement 4)

```
count  = number of LOCAL players (localPlayerCount(): 1..4)
aspect = vw / vh
wide       = aspect > 4/3
tall       = aspect < 3/4
nearSquare = !wide && !tall          // 3:4 .. 4:3

count == 1 → 1×1 (full window)
count == 2 → (vw >= vh) ? 2 columns : 2 rows
count == 3 → wide ? 3 columns
           : tall ? 3 rows
           :        2×2 with 1 empty cell      // near-square
count == 4 → 2×2 (always)
```

Slice order maps to player slot order (P1 first, then reading order:
left→right, top→bottom). 3-up normally uses three equal full-height columns
(wide) / full-width rows (tall) — no empty cell. Only the near-square 3-up case
leaves one 2×2 cell black (P3 in the bottom-left, bottom-right blank). 2×2 for
4 players fills all cells.

### Rendering approach — single canvas, clipped viewports (recommended)

Keep the **one `<canvas id="game">`** and the existing pixel-perfect backing
store from `zoom.js`. For each slice:

```js
ctx.save();
ctx.beginPath();
ctx.rect(slice.x, slice.y, slice.w, slice.h);
ctx.clip();
ctx.translate(slice.x, slice.y);          // slice-local origin
render(renderer, zone, cameras[i], [player_i, ...visiblePlayers], frame, slice); // slice rect passed in
ctx.restore();
// thin divider line between slices drawn after all slices
```

`render()` gains a `viewport` parameter (the slice rect) so its full-canvas
`fillRect` and `drawDarkness` use `viewport.w/h` instead of `canvas.width/height`.
The light-cone in `drawDarkness` takes the slice's own player as its centre.

Why single-canvas over N `<canvas>` elements:
- Reuses the one context, one `imageSmoothingEnabled=false`, one backing-store
  resize. No N-way context juggling.
- `zoom.js`'s integer-scale math generalises cleanly: compute one backing
  store for the whole window, then derive each slice's integer tile count from
  its pixel sub-rect with the same scale rule.

Trade-off: every slice redraws the full scene → drawing cost scales with player
count (2× for 2-up, 4× for 4-up). Zones are small and pre-baked
(`zoneCache.js`), so this is acceptable; revisit only if profiling says so.

Rejected alternative — **N CSS-grid `<canvas>` elements**: simpler HUD
anchoring (each slice is its own DOM box) and each canvas reuses
`applyAutoZoom` verbatim, but it multiplies contexts and complicates the
single-renderer model. Keep it in the back pocket if per-slice HUD anchoring on
one canvas proves fiddly.

### Per-slice tile counts (`zoom.js` change)

`applyAutoZoom` currently sets `camera.w/h` from the whole viewport. Generalise:
size the backing store to the window as today, then for each slice rect compute
its own `tilesW/tilesH` from the slice's pixel size using the same integer-scale
rule (`MIN_TILES_W`, `MAX_TILES_W`, `TARGET_PHYS_TILE_PX`). A half-width slice
shows ~half the tiles across — intended. Each slice's camera gets that slice's
`w/h`. Re-run on resize / orientation / `visualViewport` change exactly as now.

### Camera change (`camera.js`)

`cameraDestination` stops averaging. It follows exactly one player, keeping the
interior-vs-exterior clamp rule unchanged. The "array of players" averaging path
and its callers (`hostCameraTarget`, the local-co-op averaging branch in
`main.js`) are deleted per Requirement 2. PvP's `panCameraTo` easing stays, now
applied per-slice if PvP ever runs split (out of scope for v1).

### HUD (DOM, per slice)

Per CLAUDE.md, HUD stays in the DOM, never the canvas. Each slice owns a HUD
cluster positioned over its rect:

- `healthHud.js`: instead of stacking all bars top-left, pin **each player's
  bar to the top-left of that player's slice**.
- `ammoHud.js`: per-slice, anchored to its slice.
- `touch.js` / `touchJoystick.js`: not wired for split-screen in v1. Split
  requires keyboard/controllers (see Requirement 1); touch-only multi-player is
  deferred, so per-slice touch controls are out of scope for now.
- `hud.js` (debug/fps), `turnHud.js`, dialogues/menus: global overlays, unchanged
  — they sit above the whole window, not per-slice.

A small `splitScreenHud` helper (or a `slot → DOMRect` accessor on
`splitScreen.js`) gives each HUD module the slice rect to anchor to, recomputed
on layout change.

## Edge cases

- **A player dies:** their slice stays (shows their corpse / spectator view of
  where they fell) until respawn — do **not** re-flow the grid on death, that
  would yank everyone's viewport mid-fight. Grid only re-flows when the *local
  player count* changes (join/leave via `partyPanel`) or the window resizes.
- **Player count changes hot:** `partyPanel` already adds/removes players
  without rebuilding the world; `ensureCameras` + a layout recompute must run on
  that transition (same hook that today calls `setLocalPlayers`).
- **Zone transition / teleport:** each camera independently re-clamps to the new
  zone bounds; nothing special.
- **Light cone (`CantSeeShit`) / Night:** per-slice, centred on that slice's
  player — already covered by passing the slice player into `drawDarkness`.
- **Dividers:** draw 1–2px dividers between slices after compositing so the seam
  reads cleanly on both light and dark zones.
- **Very small windows / tiny phone in 3–4 up:** slices may fall below
  `MIN_TILES_W`. Clamp gracefully (tiles can't go below the floor; accept a
  tighter view) and consider capping touch to 2 players.

## Testing

- **Unit (`tests/`, pure node):**
  - `computeLayout(count, vw, vh)` truth table for all of Requirement 4
    (1/2/3/4 players × wide/tall) — pure function, no DOM, ideal unit test.
  - `sliceRects` tiling: slices cover the canvas with no overlap/gap; tile
    counts respect `MIN/MAX_TILES_W`.
  - `camera.js` single-follow: camera centres on its player and clamps to zone
    bounds (and does NOT average).
- **E2E (`tests/e2e/*.test.mjs`, headless Chrome):** boot local co-op with 2 and
  4 players, assert N slices render and each camera tracks its own player when
  players walk apart (the exact failure the shared camera had). Reuse the
  existing CDP harness.
- Manual: visual check on a wide desktop window, a tall/rotated window, and a
  phone, for 2/3/4 players.

## Rollout

Single feature branch. Suggested commit order (each leaves the game runnable):

1. `splitScreen.js` + `computeLayout` + unit tests (no wiring yet).
2. `camera.js`: single-follow; delete averaging. (Single-player unaffected.)
3. `zoom.js`: per-slice tile counts.
4. `renderer.js`: `viewport` param; clip/translate per slice; slice-local
   darkness.
5. `main.js`: replace `applyCamera`/`hostCameraTarget` with per-slice cameras +
   per-slice render loop; delete shared-camera helpers.
6. HUD per-slice anchoring.
7. Dividers + polish; E2E.

Since pushing to `main` is a public release, land it behind the existing local
co-op entry so it ships incrementally and each commit is shippable.

## Resolved decisions

- **Online:** no split-screen, ever — each client renders its own POV. (gg)
- **3-up layout:** three equal slices when wide/tall; **2×2 with one empty cell**
  when the window is near-square (3:4 … 4:3).
- **Input:** split-screen requires keyboard and/or controllers; touch-only
  multi-player is deferred.

## Open questions

1. **Host + local co-op together (online).** If an online host also has local
   split-screen players on its own machine, do the local slices render alongside
   the host's network view? Deferred — v1 targets purely-local sessions.
2. **Near-square hysteresis.** The 3:4 … 4:3 band already keeps the 3-up layout
   stable near square. Do we also want a small dead-band on the `vw >= vh`
   flips (2-up, and the wide/tall edges) so dragging a window across the
   boundary doesn't thrash the layout? Probably nice-to-have, not v1.
```
