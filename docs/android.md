# Android app

The Android app (`android/`) is a thin native shell: a full-screen `WebView`
that runs the exact same HTML/JS game that ships to the web, to iOS, and to Steam
(via Electron). No game logic lives in Kotlin — it's the same `js/` + `assets/` +
`data/` build, bundled into the APK so it plays **fully offline, on first
launch**, with no server round-trip.

## How it works

- `npm run build-android` runs the normal web build (`tools/build.mjs` →
  `_site/`), then `tools/buildAndroid.mjs` stages the runtime subset (the game
  shell, the hashed JS bundle + chunks, `assets/`, `data/`) into
  `android/app/src/main/assets/web/`. Everything under `src/main/assets/` is
  packed into the APK automatically — no Gradle edit needed.
  (Both native wrappers share the staging logic in `tools/stageWebRuntime.mjs`.)
- `MainActivity.kt` serves that tree over `https://appassets.androidplatform.net`
  via `WebViewClient.shouldInterceptRequest` — the Android mirror of the iOS
  `app://` scheme (`BundleSchemeHandler`). A real **https** origin gives the page
  a secure context (WebRTC data channels, crypto) and lets its relative
  `fetch()`es for `./data/*.json` and `./assets/*` resolve, which `file://`
  blocks. The handler sets correct MIME types and honours HTTP `Range` requests
  so `<audio>` playback works.
- `appassets.androidplatform.net` is a reserved, non-routable host, so the
  game's own host resolution (`js/net.js`, `js/apiBase.js`) treats it as "not
  localhost" and points opt-in online co-op at production. Real traffic to
  `sneakbit.curzel.it` (a different host) is never intercepted, so it goes out to
  the network normally. The core game needs no network; only opt-in online co-op
  does (hence the `INTERNET` permission in the manifest).

## Build & run

```bash
npm run build-android            # stage the web bundle into android/app/src/main/assets/web/
# then open android/ in Android Studio and Run, or:
cd android && ./gradlew assembleDebug   # -> app/build/outputs/apk/debug/app-debug.apk
```

`android/app/src/main/assets/web/` is generated and git-ignored — **run
`npm run build-android` before the first Gradle build** (and after any change to
the game) or the bundle will be empty/stale.

## Notes

- The activity is full-screen + immersive, draws under the display cutout
  (`windowLayoutInDisplayCutoutMode=shortEdges`), and declares `configChanges`
  for orientation so a rotation doesn't tear down and reload the WebView.
- The web overlays (top HUD, touch controls) respect `env(safe-area-inset-*)`,
  so they clear the notch / cutout. Movement defaults to the floating joystick,
  same as the mobile web game; touch controls auto-reveal via
  `navigator.maxTouchPoints` (a wrapped WebView reports `pointer: coarse`
  unreliably).
- `localStorage` (the game's saves) persists across launches via
  `domStorageEnabled`.
