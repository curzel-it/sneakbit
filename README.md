<img src="assets/logo.png" alt="SneakBit" style="width: 324px; height: auto; image-rendering: pixelated;">

SneakBit is a top-down adventure-action game with close- and long-range combat, a hand-drawn Gameboy-style world, and a story to wander through. 


<div class="download-links noprint">
    <a href="https://sneakbit.curzel.it/">
        <img src="docs/browser_game_badge.png" alt="Play SneakBit in the browser" width="120px">
    </a>
    <a href="https://store.steampowered.com/app/3360860/SneakBit/">
        <img src="docs/steam_badge.webp" alt="SneakBit on Steam"  width="120px">
    </a>
    <a href="https://apps.apple.com/app/sneakbit/id6737452377">
        <img src="docs/appstore_badge.webp" alt="SneakBit on  the App Store" width="120px">
    </a>
    <a href="https://play.google.com/store/apps/details?id=it.curzel.bitscape">
        <img src="docs/playstore_badge.webp" alt="SneakBit on the Play Store"  width="120px">
    </a>    
</div>
<br>

<img src="docs/screenshots/1.png"/>

## What's new in 2.0

* **Complete JavaScript rewrite** - the Rust core is gone; the whole game is now
  vanilla ES modules and Canvas 2D, running in the browser with no build step for
  development. (The old sources are still in this repo's history, at the
  `rust-core-tip` tag.)
* **Multiplayer** - host a match and share the invite code, or join a friend's.
  Online co-op runs peer-to-peer over WebRTC for up to four players; offline
  co-op puts up to four players on one machine, one controller each.

<img src="docs/screenshots/multiplayer.jpeg"/>

## Features

* Adventure-action gameplay with melee (sword) and ranged (kunai) combat
* Pre-rendered dual-layer tiling system - biomes, constructions, animated objects
* Tile-locked, Gameboy-style movement (see [Movement model](#movement-model))
* **Online co-op** - up to four players share one world over WebRTC ([docs/multiplayer.md](docs/multiplayer.md))
* **Local Split Screen** - up to four players on one machine, one controller each
* Keyboard and gamepad/controller support

## Running it

No build step for development - serve the folder with any static HTTP server
(browsers block `fetch` on `file://`) and it loads the raw ES modules straight
from `js/`:

```bash
npm run serve            # node tools/serve.mjs (port 8000) - always the source tree
npm run serve -- --build # the _site/ bundle instead, when that is the point
# or
npx http-server -p 8000
```

Then open <http://localhost:8000>.

Production *is* bundled: `npm run build` (esbuild) writes content-hashed,
code-split bundles into `_site/`. That's what ships - the public build at
<https://sneakbit.curzel.it> is deployed from the VPS via `npm run deploy`, and the
desktop and mobile builds package the same `_site/`. Plain dev runs and the e2e
harness never touch the bundle.

## Tests

```bash
npm run test:unit        # fast inner loop (~2 s) - node --test
npm run test:e2e         # full e2e suite (~26 s; needs Chrome)
npm test                 # both, sequential
```

Unit tests use Node's built-in test runner. E2E tests drive headless Chrome via raw
CDP and self-skip if Chrome isn't on the path. Run `npm ci` first:
`tests/steamPackaging.test.js` checks the Linux launcher installed from
`@curzel-it/steam-tools`.

## Credits

* Art, design, and original code by [Federico Curzel](https://github.com/curzel-it)
* Music by [Filippo Vicarelli](https://www.filippovicarelli.com/8bit-game-background-music)
* Sound effects by [SubspaceAudio](https://opengameart.org/content/512-sound-effects-8-bit-style)
* Font by [HarvettFox96](https://dl.dafont.com/dl/?f=pixel_operator)

## Contributing

PRs welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) for the code in this repo. Third-party assets keep their original licenses (see Credits above).

## More screenshots
<img src="docs/screenshots/2.png"/> 
<img src="docs/screenshots/3.png"/>
<img src="docs/screenshots/4.png"/> 
<img src="docs/screenshots/5.png"/>
<img src="docs/screenshots/1.png"/>