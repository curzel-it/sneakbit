# Saves on the native shells

How the game's progress survives — across launches, across the 1.7.3 → 2.0
rewrite, and across a WebView that loses its storage.

## The problem this solves

Every save lives in `localStorage` under `sneakbit.kv.v1.*` (see `js/storage.js`,
`js/saveBlob.js`). Inside the native shells that store is a WebView's, which
means two things:

1. It is keyed by the **page origin**. Change the origin and every save on every
   device is orphaned. The origins are load-bearing constants:
   `app://sneakbit.curzel.it` (iOS, Electron) and
   `https://appassets.androidplatform.net` (Android). **Never change them.**
2. It is opaque, and nothing else on the device can read or repair it.

The build it replaced — the Rust game, 1.7.3 — wrote a plain `save.json`
instead. Players carry saves from it that predate accounts and cloud sync, so
for many of them the file on their device is the only copy that has ever
existed. Hence both halves of this feature: import that file once, and keep
writing one of our own.

## The bridge

All three shells serve the game from their own origin through a request
interceptor, so the read side is uniform — one reserved URL, one fetch at boot
(`js/nativeBridge.js`):

```
GET /__native/state.json
{
  "platform": "ios" | "android" | "electron",
  "mirror":  { …saveBlob envelope… } | null,
  "legacy":  { "save": { …raw save.json… } | null,
               "audio": { "sfx": bool, "music": bool } | null } | null
}
```

A 200 *is* the "am I in a native shell?" signal — the shells answer with null
members rather than 404 when they have nothing on disk. On the web nothing
serves that path, `isNativeShell()` stays false, and every native code path
below is inert.

The write side can't be uniform: WKWebView drops request bodies from
`WKURLSchemeHandler` tasks, and Android's `WebResourceRequest` carries no body
at all. Each shell uses what it has, behind `writeMirror()`:

| Shell | Read | Write |
|---|---|---|
| Electron | `electron/appProtocol.js` → `electron/nativeState.js` | `POST /__native/mirror` (`protocol.handle` gets the body — no preload, renderer stays sandboxed) |
| iOS | `BundleSchemeHandler.swift` → `NativeState.swift` | `saveMirror` `WKScriptMessageHandler` (`WebGameView.swift`) |
| Android | `MainActivity.kt` → `NativeState.kt` | `window.SneakBitNative.writeMirror` JS interface |

The Android JS interface is reachable from whatever page is loaded, which is why
`BundleWebViewClient.shouldOverrideUrlLoading` pins navigation to the asset host
and sends everything else to a real browser.

## Files on disk

| | Legacy save (read once, never deleted) | Mirror (this build) |
|---|---|---|
| Steam / desktop | `<install dir>/data/save.json` — beside the executable, *not* AppData / Application Support | `<userData>/sneakbit-save.json` |
| iOS | `<container>/Documents/save.json` | `<container>/Documents/sneakbit-save.json` |
| Android | `<filesDir>/save.json` | `<filesDir>/sneakbit-save.json` |

The desktop path is what `game/src/features/paths.rs` resolved in the Rust
build. Steam updates AppID 3360860 in place and that file was never in a depot
manifest (the game created it at runtime), so it is still there after the
update. On macOS the new build is an `.app` bundle *inside* the install root, so
`electron/nativeState.js` climbs back out of `Contents/MacOS/` to find it.

On mobile the legacy save is only reachable because 2.0 ships under the **same
store identity** as 1.7.3 — `it.curzel.bitscape` on both platforms. A different
bundle id / applicationId is a different app with a different sandbox, and the
import becomes impossible.

Mirrors are written temp-file-then-rename. The Rust build truncated and wrote in
place, which is how a crash mid-save produced an unparseable file that then read
back as a new game.

## Boot order

In `main()` (`js/main.js`), all before `runMigrations()` so nothing has hydrated
from storage yet. Each step returns `true` when it has started a reload, and the
caller stops — the reload is what lets every module rehydrate cleanly, and it
happens under the loading screen so nothing flashes.

```
bootRestoreFromCloud()      signed-in clear-cache restore  (js/cloudSave.js)
initNativeBridge()          one fetch; no-op off the shells
restoreFromNativeMirror()   localStorage empty  → refill from the mirror
importLegacyFromNative()    still empty, first run → import save.json
installSaveMirror()         start following localStorage from here on
```

The mirror goes first because it is this build's own progress and therefore
never older than a save the previous build left behind. Both steps stand down
the moment `hasLocalProgress()` is true — localStorage is always authoritative,
and the files only ever follow it.

## The one-shot marker

`sneakbit.legacyImport.v1` in `localStorage`, deliberately *outside* the
`sneakbit.kv.v1.` namespace: `applyLegacySave` prunes every kv key absent from
the import, and `cloudSave` syncs that namespace between devices, so a marker in
there would be wiped by the very import it guards and then travel to devices it
says nothing about.

It is stamped on **both** outcomes — imported, and nothing-to-import. The second
case matters: without it, a player who starts a New Game (which clears
`latest_zone`) would look like a fresh install on the next boot and be handed
the old Rust save back. For the same reason the menu's New Game handler calls
`clearMirror()` and re-stamps the marker after its `localStorage.clear()`.
"Clear cache" deliberately does neither — restoring the save there is the point.

## What comes across

Progress translates key-for-key with a handful of renames
(`js/legacySave.js`): `latest_world` → `latest_zone`, `world.visited.<id>` →
`did_visit.<id>`, `player.<p>.currently_equipped_{ranged,melee}_weapon` →
`player.<p>.equipped.{ranged,melee}`. Dropped: `build_number` (the Rust ladder's
version, not ours), `previous_world`, `always` (a virtual key the old iOS build
nonetheless seeded files with), and the device-local settings keys.

Settings are carried separately, as settings rather than progress
(`legacySettingsPatch`): language off the old `0/1/2` enum, and the sound
toggles — which lived in `save.json` on desktop but in `UserDefaults` /
`SharedPreferences` (`AudioSettings`, keys `kSoundEffectsEnabled` /
`kMusicEnabled`) on mobile, which is why the envelope carries `legacy.audio`.
A returning player with sound on is explicitly unmuted: this build starts muted
and `firstLaunch.js` persists that, which is right for a new player and wrong
for this one.

Hero position isn't in the old save at all — the Rust build only stored
`latest_world` and respawned at the zone's spawn point. `js/main.js` does the
same when the spawn tile keys are absent, so an imported save behaves exactly
as it did before.

## Testing

- `tests/legacySave.test.js` — translation, the import decision, the settings map
- `tests/nativeBridge.test.js` — envelope validation
- `tests/saveMirror.test.js` — mirror write/restore, and the New Game regression
- `tests/e2e/legacyImport.test.mjs` — the real boot against
  `tests/e2e/fixtures/fakeShellServer.mjs`, which stands in for a shell
