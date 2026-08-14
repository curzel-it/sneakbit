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
- **Steam partner credentials** with upload rights on the app. Run
  `steamcmd +login <user>` by hand once and answer the Steam Guard prompt — steamcmd
  caches a sentinel, and every upload after that needs only `STEAM_USERNAME` in
  `.env`. No password passes through this repo. (`STEAM_PASSWORD` is honoured if you
  set it, but the sentinel is the path that doesn't put one in a file.)
- Everything else is already in the repo: `npm ci` gets electron, electron-builder and
  `@curzel-it/steam-tools`, and the icons live in `build/icon.{icns,ico,png}`.

The upload and the Linux launcher both live in
[`@curzel-it/steam-tools`](https://github.com/curzel-it/steam-tools), a devDependency,
because they are the same in every project — see its README for the argument behind each
guard. What stays here is `steam.config.json`: the AppID, the three depot ids, and the
mac architecture. Ids are not secrets and are committed; the credential is not.

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

`npm run steam` writes `temp/build.vdf` and hands it to `steamcmd`. The build
description is `SneakBit <version> (<git sha>)` — the commit is the part worth having
six builds later, when the version has not moved.

By default it leaves the build **unset** — nothing changes for players until you go
to Steamworks → *SneakBit* → *Builds* and set the new build live on a branch. That's
deliberate: promote to a beta branch from the UI, where you can see what you're
overwriting.

To promote automatically instead, `npm run steam:smoketest`, or
`npx steam-upload --live beta` for any other branch. The branch must already exist in
Steamworks or steamcmd fails the build, and Steam rejects `SetLive` on the default
branch, so shipping to everyone stays a deliberate click.

`npx steam-upload --print` shows the exact `build.vdf` and the steamcmd invocation
without connecting to anything. Call it directly rather than through
`npm run steam -- --print`: npm's PowerShell shim drops arguments after `--`, and
losing `--print` means doing the upload for real.

**It refuses to upload platform folders from different builds.** The three packages are
compared file by file inside their `app.asar` first. Running electron-builder for a
subset over an existing `dist/` leaves the other platforms' folders behind, and that
failure is invisible otherwise: steamcmd reports success on every depot and Steam
dedupes the unchanged content away, so the fix never reaches the players on the stale
one. That is the fault that cost two rounds of debugging in
`docs/linux-steam-sandbox.md`. Uploading a subset on purpose is still fine — the
platforms left out are named on the way past, and their depots keep what they have.

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
   | Linux | `sneakbit` | **the launcher script, not the binary** — it ships under this name so this field never had to change; the Electron binary beside it is `sneakbit-bin` |

3. **Set the build live** on the beta branch, then verify by installing through the
   Steam client rather than trusting the upload log.

### First install from the branch — check the macOS bundle

Do this once per macOS depot change, on the copy Steam installed (not `dist/`):

```bash
codesign --verify --deep --strict "~/Library/Application Support/Steam/steamapps/common/SneakBit/SneakBit.app"
```

The `.app` contains 14 symlinks — the `Versions/Current` and top-level aliases inside
`Electron Framework.framework` and friends. If SteamPipe ever delivers those as copies
instead of links, the bundle's seal no longer matches and Apple Silicon refuses to
launch it, since arm64 requires a valid signature. The command above catches that in
one line; a launch failure with no console output is the same symptom seen the hard way.

## Desktop-only defaults

The shell is thin, but two defaults key off it (both read `platform === "electron"`
from `js/nativeBridge.js`, which is why they can't live in the web build):

- **Audio is on.** A browser tab and both mobile shells start muted behind a
  first-launch "Audio muted by default" toast; the desktop app starts audible and
  says nothing (`defaultMuted()` in `js/settings.js`, `js/firstLaunch.js`). The
  opening track plays without waiting for a keypress too — Electron runs with
  `no-user-gesture-required`, so `js/music.js` skips the gesture gate here.
  First launch only: a saved `muted` always wins, so an install that already
  chose stays as it is.
- **The pause menu offers "Exit game."** A tab can't close itself; the desktop app
  has to (`js/exitGame.js`).

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
  helper. Where unprivileged user namespaces are also unavailable — Flatpak Steam
  (the default on Bazzite, Nobara and most Fedora/KDE software centres) can't nest
  them, and Ubuntu 24.04+ restricts them via AppArmor — Chromium finds no usable
  sandbox and aborts during startup: no window, no error, nothing in Steam's UI.
  The Linux depot therefore launches a shell script, not the binary: it ships from
  `@curzel-it/steam-tools` as `sneakbit`, beside the `sneakbit-bin` it exec's, and
  puts the flag on argv — the only place Chromium reads it in time. Doing this from
  `main.js` cannot work — that file is evaluated long after the decision — so an
  absent `[sandbox]`-style log line proves nothing either way. Full investigation:
  `docs/linux-steam-sandbox.md`.

  It now picks the flag from what the machine can actually do rather than always
  dropping the sandbox: the setuid helper if it is genuinely setuid and root-owned,
  else `--disable-setuid-sandbox` if an `unshare` proves user namespaces work, else
  `--no-sandbox`. The middle rung is where a normal Linux Steam install lands, and it
  keeps the renderer confined; the bottom rung is Flatpak and Ubuntu 24.04, where the
  alternative is a build that shows nothing.

  **Triage a Linux "it doesn't launch" report by exit code first**, from
  `logs/gameprocess_log.txt` (not `console-linux.txt`, which omits the wrapper
  chain). Several hours went into instrumenting Steam's launcher before anyone
  read it:

  | Exit code | Meaning |
  |---|---|
  | `0` | the game ran and quit normally |
  | `133` | Chromium aborted — the sandbox is implicated, our problem; get stderr from a shell launch and try `STEAM_TOOLS_SANDBOX=0 %command%` |
  | `255` | the game never ran — Steam's own launch layer, nothing in this repo |

  For `255`, **restart the Steam client before believing anything else**. A client
  session that predates the installed build can hold stale launch state and fail
  before reaching the game — especially after a build changes its launch
  executable, which ours did twice (Rust binary → Electron, then → launcher
  script + renamed binary). It is free and it was the entire fix once already.
- **No Steamworks API integration** — no achievements, no cloud saves, no rich
  presence. Saves are local: `localStorage` plus a mirror in the app's userData
  directory (`electron/nativeState.js`).
