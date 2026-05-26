# Hello Claude!

HTML5 / Canvas / vanilla JS port of [SneakBit](https://github.com/curzel-it/sneakbit), originally a Rust-core game shipped on Steam (raylib desktop), iOS (CoreGraphics) and Android (Compose).

The original game's source lives at `~/dev/sneakbit`. Treat it as read-only reference material — do not modify it.

## Handling a Task
1. For non-trivial tasks, use the built-in plan mode to create a plan before implementing
2. Ask me any questions on things that are uncertain about the plan (when necessary)
3. Implement, run the unit tests, and verify visually in the browser
4. Review and cleanup, remove unnecessary comments
5. Commit and push (see below)
6. Enjoy!

## Testing, committing, shipping
- **Unit tests** use Node's built-in test runner — no framework, no devDependencies. Tests live in `tests/` and end in `.test.js`. Run them with:
  ```bash
  node --test tests/
  ```
  Run them often — at minimum before each commit. They're fast; there's no excuse not to.
- **Commit often.** Small focused commits beat large ones. Each commit should leave the game in a runnable state (`node --test` green, page loads without console errors).
- **Push to main often.** Pushing to `main` deploys to <https://curzel.it/sneakbit-html>, so every push is a public release. After any change large enough to be visible to a user, push it — don't sit on local changes. The deploy is automatic; there's no staging.

## Style and Guidelines
- **No build step.** Open `index.html` (or serve the folder with any static server) and reload.
- **Coordinate system:** world space is in tiles (floats). Screen space is in pixels. Conversion happens in the renderer only.
- **No external libraries** unless we hit a real wall. Canvas 2D is enough for now.
- **Pixel art:** disable image smoothing on the 2D context (`ctx.imageSmoothingEnabled = false`) and round draw coordinates to integers before blitting.
- **Naming:** files in `js/` are camelCase, matching the feature name. Exports are named, never default.
- **One feature one file**
- if it's an UI thing, don't implement it in the canvas (buttons, icons, conuters, dialogues, ...)

## Architecture — one feature, one file
Each feature lives in exactly one file. A "feature" is a single, self-contained responsibility — input handling, the player, the camera, the renderer, the game loop, etc. If a file starts handling more than one feature, split it. If two features keep reaching into each other, push the shared bit into its own file rather than fusing them.

- Files are vanilla ES modules. Plain `<script type="module">` from `index.html`. No bundler, no transpiler, no framework.
- Cross-feature communication happens through explicit imports of named exports — no globals, no event bus until we genuinely need one.
- Feature-local constants live in the feature file. Truly cross-cutting constants (tile size, sprite-sheet ids) live in `js/constants.js`.
- Asset loading is its own feature (`js/assets.js`). Data loading (levels, species) is its own feature (`js/data.js`). Features ask them by name; they never new up `Image` or `fetch` themselves.
