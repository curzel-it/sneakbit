# iOS app

The iOS app (`ios/`) is a thin native shell: a full-screen `WKWebView` that runs
the exact same HTML/JS game that ships to the web and to Steam (via Electron).
No game logic lives in Swift — it's the same `js/` + `assets/` + `data/` build,
bundled into the app so it plays **fully offline, on first launch**, with no
server round-trip.

## How it works

- `npm run build-ios` runs the normal web build (`tools/build.mjs` → `_site/`),
  then `tools/buildIos.mjs` stages the runtime subset (the game shell, the
  hashed JS bundle + chunks, `assets/`, `data/`) into `ios/web/`.
- `ios/web/` is a **folder reference** in the Xcode project, so the whole tree
  is copied verbatim into the `.app` bundle (structure preserved — important,
  since `data/`/`assets/` rely on their paths).
- `BundleSchemeHandler.swift` serves that bundle over a custom `app://` scheme,
  mirroring the Electron desktop wrapper (`electron/appProtocol.js`). The custom
  scheme (instead of `file://`) is what makes the game's relative `fetch()`es for
  `./data/*.json` and its `./assets/*` loads work. It honours HTTP `Range`
  requests so `<audio>` playback works.
- The document is loaded from `app://sneakbit.curzel.it/index.html`, so the
  game's own host resolution (`js/net.js`, `js/apiBase.js`) points opt-in online
  co-op at production — exactly like the desktop build. The core game needs no
  network; only opt-in online co-op does.

## Build & run

```bash
npm run build-ios            # stage the web bundle into ios/web/
open ios/SneakBit.xcodeproj  # then Run on a simulator or device
```

`ios/web/` is generated and git-ignored — **run `npm run build-ios` before the
first Xcode build** (and after any change to the game) or the bundle will be
empty/stale.

## Notes

- `ios/SneakBit/SneakBit.entitlements` enables outgoing network (for the co-op
  relay/account API) and the App Sandbox (required on the macOS/Catalyst build).
- The web overlays (top HUD, touch controls) respect `env(safe-area-inset-*)`
  so they clear the notch / Dynamic Island and home indicator when the page runs
  full-bleed. Those CSS insets are 0 in a normal browser tab, so the web build is
  unaffected.
- Touch controls auto-reveal on any touch-capable device (the detection uses
  `navigator.maxTouchPoints`, not just `pointer: coarse`, which a wrapped
  WebView reports unreliably). Movement defaults to the floating joystick, same
  as the mobile web game.
