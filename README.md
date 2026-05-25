# SneakBit HTML

> This thing is entirely vibe coded and prompts itself based on snapshot tests
> Do with this information what you will

HTML5 / Canvas / vanilla JS port of [SneakBit](https://github.com/curzel-it/sneakbit) — a top-down adventure-action game originally written in Rust and shipped on Steam, iOS and Android.

The original game uses a Rust core (`game_core`) with platform-specific renderers (raylib on desktop, CoreGraphics on iOS, Compose on Android). This project re-implements the renderer and runtime in plain JavaScript on top of an HTML canvas, reusing the original art and level data.

## Status

Phase 1: render the first level (Evergrove, world `1001`) and walk the player around with the correct directional sprites. No combat, no NPCs, no dialogue yet.

## Architecture

One feature, one file. See [CLAUDE.md](./CLAUDE.md) for the full guide, the source-of-truth notes from the original Rust code, and the directory layout.

## Running it

No build step. Serve the folder with any static HTTP server (browsers block `fetch` on `file://`):

```bash
# Python
python3 -m http.server 8000

# or Node
npx http-server -p 8000
```

Then open <http://localhost:8000>.

## Controls (phase 1)

| Action | Keys |
|---|---|
| Move up    | `W` / `↑` |
| Move down  | `S` / `↓` |
| Move left  | `A` / `←` |
| Move right | `D` / `→` |

## Movement model

Gameboy-/Pokémon-style tile-locked stepping, implemented in `js/player.js`. This is an intentional deviation from the original game (which uses free-axis movement) and will shape how other features get ported.

- The player always has a canonical integer tile (`tileX`, `tileY`). The rendered float position (`x`, `y`) only differs from it while a step is interpolating.
- **Tap to rotate.** A fresh press of a direction the player is NOT already facing rotates the sprite and starts a short commit timer (`ROTATE_COMMIT_DELAY`, 0.06 s). Release before the timer fires = pure rotate, no step.
- **Hold to step.** If the key is still held when the timer fires, commit one full-tile step over `STEP_DURATION` (0.22 s). Pressing the direction already faced skips the timer and commits immediately.
- **Queued inputs.** Presses arriving during a step go into a single-slot queue (last-wins). On snap: consume the queued direction and chain without a commit delay; or if the queue is empty but a direction is still held, chain that; otherwise become idle.

`input.js` exposes a per-tick `{ events, held }`: a FIFO of press events plus a snapshot of the held set. The player needs both to distinguish tap from hold and to handle the mid-step queue.

## Assets

Sprite sheets in `assets/` are exported from `~/dev/sneakbit/aseprite/*.aseprite`. To re-export from the original repo:

```bash
/Applications/Aseprite.app/Contents/MacOS/aseprite \
  -b ~/dev/sneakbit/aseprite/heroes.aseprite \
  --all-layers --sheet ./assets/heroes.png
```

Level data in `data/` is copied verbatim from `~/dev/sneakbit/data/`.

## Credits

All art, music, design, and original code by [Federico Curzel](https://github.com/curzel-it). See the [original repo](https://github.com/curzel-it/sneakbit) for the full credits.
