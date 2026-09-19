# Hello Codex!

This is SNEAKBIT, a top-down adventure-action game with close- and long-range combat in a hand-drawn Game Boy-style world.

- HTML5 Canvas and vanilla JavaScript, with ES modules for the browser client
- The original Rust-core game is preserved at the read-only `rust-core-tip` tag; this repository's current code is the HTML build
- Online co-op is peer-to-peer over WebRTC for up to four players; local split-screen supports up to four controllers
- We also ship Electron desktop builds, Steam builds, and native iOS and Android wrappers
- CLAUDE.md is a copy of this document; ignore it

## Dev Tools

- `npm run test:unit` - fast Node built-in unit tests; run this frequently
- `npm run test:e2e` - end-to-end tests using headless Chrome and raw CDP; they self-skip if Chrome is unavailable
- `npm test` - runs the unit and E2E suites sequentially
- `npm run dev` / `npm run serve` - serves the raw ES modules locally at `127.0.0.1:8000`; always source, `_site/` is off limits unless the run passes `--build`
- `npm run shots` - captures browser screenshots
- `npm run build` - creates the production `_site/` bundle; development must keep using raw modules
- `npm run deploy` - builds and deploys the client and relay server to `sneakbit.curzel.it`
- `npm run dist`, `npm run build-apps`, `npm run build-ios`, `npm run build-android`, `npm run steam`, and `npm run steam:smoketest` are packaging or publishing operations; never run them unless explicitly asked
- Run `npm run test:e2e` before pushing changes to `onlineBootstrap.js`, `webrtcTransport.js`, `webrtcChannel.js`, `predictedSelf.js`, `mirrorWorld.js`, or `snapshotBroadcaster.js`

## Server (`server/`)

- The relay server is vanilla `node:http` with ES modules and Node built-ins; follow the same one-feature-one-file rule as the client
- Run it locally with `node server/index.js`; it defaults to `127.0.0.1:8090`. `npm run dev` serves only the browser client
- It powers the WebRTC relay, TURN credentials, optional accounts, and cloud saves; it is not a general game simulation server
- `GET /health` returns `ok`; keep it cheap and public. `/metrics` and sensitive endpoints must retain their auth, origin, and rate-limit protections
- Production is a shared Ubuntu VPS configured through `.env`, with the `sneakbit-server` systemd unit, nginx reverse proxy, and certbot TLS
- Deploy with `npm run deploy` (`node tools/deploy.mjs`); it is idempotent and uses `ssh2` to ship the server and production client

## Coding Style and Guidelines

- One feature, one file
- JSDoc type annotations are appreciated
- Keep comments to a bare minimum: no headers, dangling facts, or empty openers; use clean, simple prose only when necessary
- World space is measured in tile floats; screen space is pixel coordinates. Convert world positions to pixels in the renderer
- No external runtime libraries and no WebGL. Canvas 2D is sufficient; esbuild, Electron, and packaging tools are development-only exceptions
- Preserve crisp pixel art: disable canvas image smoothing and round blit positions to integer pixels
- Files in `js/` are camelCase and match the feature name. Exports are named, never default
- Implement interface elements such as buttons, counters, menus, and dialogue with HTML and CSS, not in the game canvas

## Architecture - one feature, one file

- A feature has one self-contained responsibility: input handling, player control, camera, renderer, game loop, multiplayer transport, and so on
- Split a file that starts handling more than one feature
- If two features repeatedly reach into each other, extract their shared responsibility rather than fusing them
- Use vanilla ES modules and plain `<script type="module">` tags from `index.html`. Development has no build step; production alone is bundled by esbuild
- Cross-feature communication is explicit named imports. Do not add globals or an event bus without a real need
- Feature-local constants live in their feature file; genuinely shared game constants live in `js/constants.js`
- A feature owns its DOM as well as its logic: keep markup in the relevant HTML page and bind it from that feature's module
- Modules imported by pure Node tests must not touch `document` at import time
- Asset loading belongs to `js/assets.js` and data loading to `js/data.js`; game features ask those modules by name instead of creating images or fetching data themselves
- Audio loading is likewise a dedicated concern; do not scatter asset fetches through gameplay features

## Documentation

- Keep comments to a minimum, ideally only JSDoc type hints
- Keep AGENTS.md limited to information that is essential to working in this repository
- Do not version feature rationale or development history; use focused commit messages when that context is needed

## First-party dependencies

Other projects we work on may be installed from Git as ordinary dependencies. Treat the lockfile as the record of the version that ships: after updating one, push its change, update the dependency here, and commit `package-lock.json`.

- Steam Tools, `../steam-tools`, https://github.com/curzel-it/steam-tools - Steam and Steamworks packaging, build-upload, and store-asset tools
