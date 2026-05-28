# SneakBit HTML

> This thing is entirely vibe coded and prompts itself based on snapshot tests.

> Do with this information what you will...

HTML5 / Canvas / vanilla JS port of [SneakBit](https://github.com/curzel-it/sneakbit) — a top-down adventure-action game originally written in Rust and shipped on Steam, iOS and Android.

The original game uses a Rust core (`game_core`) with platform-specific renderers (raylib on desktop, CoreGraphics on iOS, Compose on Android). This project re-implements the renderer and runtime in plain JavaScript on top of an HTML canvas, reusing the original art and level data.

## Architecture

One feature, one file. See [CLAUDE.md](./CLAUDE.md) for the full guide and directory layout.

## Online co-op

Up to four players (one host + three guests) can share the host's world. The host runs the existing single-player game unchanged; guests render the host's snapshots and predict their own avatar for fluidity. A small Node relay pairs hosts and guests by 5-char invite code — see [docs/server.md](./docs/server.md) for the full protocol spec.

## Running it

No build step. Serve the folder with any static HTTP server (browsers block `fetch` on `file://`):

```bash
npm run serve            # python3 -m http.server 8000
# or
npx http-server -p 8000
```

Then open <http://localhost:8000>.

## Tests

```bash
npm test                 # node --test tests/*.test.js
```

No devDependencies — uses Node's built-in test runner.

## Server

Online co-op is brokered by a tiny Node relay in [`server/`](./server) (vanilla `node:http`, no deps). Run locally with `node server/index.js`. Full protocol spec in [docs/server.md](./docs/server.md).

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

Sprite sheets in `assets/` are exported from `../dev/sneakbit/aseprite/*.aseprite`. To re-export from the original repo:

```bash
/Applications/Aseprite.app/Contents/MacOS/aseprite \
  -b ../dev/sneakbit/aseprite/heroes.aseprite \
  --all-layers --sheet ./assets/heroes.png
```

Level data in `data/` is copied verbatim from `../dev/sneakbit/data/`.

## Credits

* Art, design, and original code by [Federico Curzel](https://github.com/curzel-it)
* Music by [Filippo Vicarelli](https://www.filippovicarelli.com/8bit-game-background-music)
* Sound effects by [SubspaceAudio](https://opengameart.org/content/512-sound-effects-8-bit-style)
* Font by [HarvettFox96](https://dl.dafont.com/dl/?f=pixel_operator)

## Contributing

PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) for the code in this repo. Third-party assets keep their original licenses (see Credits above).
