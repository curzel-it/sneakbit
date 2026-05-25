# SneakBit HTML

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
