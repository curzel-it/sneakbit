# SneakBit HTML — Project Guide

HTML5 / Canvas / vanilla JS port of [SneakBit](https://github.com/curzel-it/sneakbit), originally a Rust-core game shipped on Steam (raylib desktop), iOS (CoreGraphics) and Android (Compose).

The original game's source lives at `~/dev/sneakbit`. Treat it as read-only reference material — do not modify it.

## Phase 1 goal

Render the first level (`data/1001.json`, "Evergrove") on an HTML canvas and let the player walk around with the correct directional sprites and animation frames. Faithful to the original look, but we are free to make sensible HTML/JS-shaped choices instead of slavishly mirroring the Rust architecture.

## Architecture principle — **one feature, one file**

Each feature lives in exactly one file. A "feature" is a single, self-contained responsibility — input handling, the player, the camera, the renderer, the game loop, etc. If a file starts handling more than one feature, split it. If two features keep reaching into each other, push the shared bit into its own file rather than fusing them.

Rules of thumb:
- One file = one responsibility, named after the feature (`input.js`, `player.js`, `camera.js`, `renderer.js`, `gameLoop.js`, ...).
- Files are vanilla ES modules. No bundler, no transpiler, no framework. Plain `<script type="module">` from `index.html`.
- Cross-feature communication happens through explicit imports of named exports — no globals, no event bus until we genuinely need one.
- Constants that are inherent to a feature live in that feature's file. Truly cross-cutting constants (tile size, sprite-sheet ids) live in `js/constants.js`.
- Asset loading is its own feature (`js/assets.js`). Features ask it for sprites by name; they do not new up `Image` themselves.
- Data loading (levels, species) is its own feature (`js/data.js`). Same rule.
- Keep files short. If a feature file grows past ~150 lines, that's a smell — look for a sub-feature wanting to escape.

## Movement model

Gameboy-/Pokémon-style tile-locked stepping, implemented in `js/player.js`.

- The player always has a canonical integer tile (`tileX`, `tileY`). The rendered float position (`x`, `y`) only differs from it while a step is interpolating.
- **Tap to rotate.** A fresh press of a direction the player is NOT already facing rotates the sprite and starts a short commit timer (`ROTATE_COMMIT_DELAY`, 0.06 s). If the key is released before the timer fires, no step is taken — pure rotate.
- **Hold to step.** If the key is still held when the timer fires, the player commits one full-tile step over `STEP_DURATION` (0.22 s). A press of the direction the player is already facing skips the timer and commits immediately.
- **Queued inputs.** Presses that arrive during a step go into a single-slot queue (last-wins). On snap, the queued direction is consumed and chained without a commit delay. If the queue is empty but a direction is still held, that direction chains too. Otherwise the player becomes idle.

The model lives entirely inside `player.js` and `input.js`. `input.js` exposes a per-tick `{ events, held }`: a FIFO of press events plus a snapshot of the held set — both of which the player needs to distinguish a tap from a hold and to handle the mid-step queue.

## Source of truth — original game

- **Tile size:** 16px. Sprite frames are expressed in tile units in the data files (e.g. a frame `w: 1, h: 2` = 16×32 px).
- **Camera viewport:** 60 × 40 tiles (`INITIAL_CAMERA_VIEWPORT` in `game_core/src/constants.rs`).
- **Animation FPS:** 10 (`ANIMATIONS_FPS`).
- **Sprite sheet ids** (see `game_core/src/constants.rs`): biome tiles `1002`, construction tiles `1003`, buildings `1004`, humanoids 1x2 `1009`, static objects `1010`, animated objects `1012`, humanoids 1x1 `1014`, humanoids 2x2 `1016`, weapons `1022`, monsters `1023`, heroes `1024`.
- **Hero sprite layout** (sheet `1024`, see `species.json` for species id `1001` "Hero", and `entities/hero.rs`): each hero is a vertical 1×2 tile (16×32 px) sprite. 4 animation frames laid out horizontally. 8 rows stacked vertically encoding direction × moving:
  - row 0: up walking, row 1: up still
  - row 2: right walking, row 3: right still
  - row 4: down walking, row 5: down still
  - row 6: left walking, row 7: left still
  Player 1's sprite-sheet origin is column 1, row 1 (in tile units). Players 2/3/4 are at columns 5 / 9 / 13.
- **Direction-row formula** (`features/animated_sprite.rs::update_sprite_for_direction_speed`): `row = base_row + h * direction_speed_row`, applied to `sprite.frame.y`.
- **Level 1001** ("Evergrove"): 100 × 80 tiles. Default spawn (68, 23) for player 1 from a fresh save (`worlds/world_setup.rs::destination_x_y`).

## Layout

```
sneakbit-html/
  index.html              entry point, sizes canvas, loads main.js
  CLAUDE.md               this file
  README.md
  assets/                 PNGs exported from the original aseprite files
    heroes.png            sprite sheet 1024
    tiles_biome_raw*.png  4 animation frames of base biome tiles
    tiles_constructions_raw.png
  data/                   raw level + species JSON copied from the original
    1001.json             Evergrove (first level)
    species.json
  js/
    main.js               wires features together, no game logic
    constants.js          TILE_SIZE, ANIMATIONS_FPS, sheet ids, viewport
    assets.js             load + cache <img> sprite sheets
    data.js               load + cache level/species JSON
    input.js              keyboard state → unit direction
    player.js             player state, movement, sprite-frame selection
    camera.js             camera follows player, clamped to world bounds
    renderer.js           draws world + entities into the canvas
    gameLoop.js           requestAnimationFrame loop, fixed-dt update
```

## Conventions

- **No build step.** Open `index.html` (or serve the folder with any static server) and reload.
- **Coordinate system:** world space is in tiles (floats). Screen space is in pixels. Conversion happens in the renderer only.
- **No external libraries** unless we hit a real wall. Canvas 2D is enough for now.
- **Pixel art:** disable image smoothing on the 2D context (`ctx.imageSmoothingEnabled = false`) and round draw coordinates to integers before blitting.
- **Naming:** files in `js/` are camelCase, matching the feature name. Exports are named, never default.
