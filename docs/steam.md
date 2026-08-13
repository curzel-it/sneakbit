# Steam / desktop release

The desktop build (`electron/`) is a thin shell around the same HTML/JS game that
ships to the web, iOS and Android: a single `BrowserWindow` loading the bundled
`_site/` over a custom `app://sneakbit.curzel.it` scheme. No game logic lives in
`electron/`. See `electron/appProtocol.js` for why the host is a production
hostname (short version: it makes relative `fetch()`es work and points *opt-in*
online co-op at prod; it triggers no network by itself — the game plays fully
offline).

Steam identifiers, carried over from the original Rust build so updates land on
the same store page:

| | |
|---|---|
| AppID | `3360860` |
| Windows depot | `3360861` — x64 |
| macOS depot | `3360862` — **arm64 only** |
| Linux depot | `3360863` — x64 |

## Prerequisites

- **Steamworks SDK** with ContentBuilder, expected at
  `~/dev/steamworks-sdk/tools/ContentBuilder/builder_osx`. Override with
  `STEAMWORKS_BUILDER=/path/to/builder_osx`.
- **Steam partner credentials** with upload rights on the app. `tools/steam_upload.py`
  stores them in the macOS Keychain on first use (`python3 -m pip install keyring`
  if the prompt says it's missing). Steam Guard is asked for on the terminal, so
  the upload has to be run by a human on a real tty.
- Everything else is already in the repo: `npm ci` gets electron + electron-builder,
  and the icons live in `build/icon.{icns,ico,png}`.

## Release procedure

```bash
npm test              # unit + e2e, both green
npm run dist          # clean build → dist/{mac-arm64,win-unpacked,linux-unpacked}
                      # then smoke-test the packaged app (below)
npm run steam         # uploads all three depots; does NOT set anything live
```

`npm run dist` wipes `dist/` first, runs the web build (`tools/build.mjs` → `_site/`),
then runs electron-builder with `dir` targets — Steam wants a plain folder tree, not
an installer. Per-platform arch is pinned in `package.json`'s `build` block, not on
the CLI (the CLI's `--x64` would apply to every platform at once).

### Smoke-test before uploading

Test the **packaged** app, not `npm run electron` — the packaged one runs from the
asar and is what testers actually get:

```bash
open dist/mac-arm64/SneakBit.app
lipo -archs "dist/mac-arm64/SneakBit.app/Contents/MacOS/SneakBit"   # → arm64
```

Check: the menu boots, the version in the bottom-right matches this release, a new
game starts and is playable, and quitting/relaunching restores the save.

### Uploading

`npm run steam` (i.e. `tools/steam_upload.py`) writes `temp/build.vdf` and hands it
to `steamcmd`. The build description is `Build <version from package.json>`.

By default it leaves the build **unset** — nothing changes for players until you go
to Steamworks → *SneakBit* → *Builds* and set the new build live on a branch. That's
deliberate: promote to a beta branch from the UI, where you can see what you're
overwriting.

To promote automatically instead, `STEAM_BRANCH=beta npm run steam`. The branch must
already exist in Steamworks or steamcmd fails the build.

## Steamworks-side setup (once per branch/platform)

None of this is in the repo — it's partner-site configuration:

1. **Beta branch** — *SneakBit* → *Builds* → *Betas*: create the branch (e.g. `beta`),
   password-protect it if the test should be closed. Testers opt in from the game's
   *Properties → Betas* in the Steam client.
2. **Launch options** — *Installation* → *General Installation*, one per OS:

   | OS | Executable | Notes |
   |---|---|---|
   | Windows | `SneakBit.exe` | |
   | macOS | `SneakBit.app` | |
   | Linux | `sneakbit` | lowercase — electron-builder derives it from package `name` |

3. **Set the build live** on the beta branch, then verify by installing through the
   Steam client rather than trusting the upload log.

## Version numbers

One string, two places, kept in sync by `tests/appVersion.test.js`:
`package.json` `version` (Steam build description, Electron app version, the mobile
shells) and `APP_VERSION` in `js/constants.js` (rendered in the main menu). Bump both
before a release — the test fails if they disagree, so you can't forget one.

## Known gaps

- **macOS signing is deliberately ad-hoc**, pinned by `"identity": "-"` in the `mac`
  build config. Left unset, electron-builder signs with whatever certificate it finds
  in the local keychain — on this machine that was an *Apple Development* cert, which
  is a development identity, expires yearly, and makes the artifact depend on who
  built it. Ad-hoc is fine for Steam: depot content isn't quarantined, so Gatekeeper
  never assesses it. It is *not* enough to distribute the `.app` outside Steam — that
  needs a Developer ID Application certificate (swap it into `identity`) plus
  notarization, neither of which is set up.
- **macOS is arm64-only.** Intel Macs can't run it, and Steam has no per-arch flag
  on a macOS depot to hide it from them. Building universal (`"arch": ["arm64", "x64"]`
  in the `mac` target) is the fix if an Intel report comes in; it roughly doubles the
  depot size.
- **Linux sandbox.** Steam depots drop the setuid bit from Chromium's `chrome-sandbox`
  helper, which on distros that also block unprivileged user namespaces (Ubuntu 24.04)
  would stop the app launching entirely. `electron/linuxSandbox.js` detects exactly
  that case and falls back to `--no-sandbox`, keeping the sandbox everywhere it still
  works. If a Linux tester reports the game not opening at all, ask for the terminal
  output — `[sandbox]` in the log means the fallback fired and something else is wrong.
- **No Steamworks API integration** — no achievements, no cloud saves, no rich
  presence. Saves are local: `localStorage` plus a mirror in the app's userData
  directory (`electron/nativeState.js`).
