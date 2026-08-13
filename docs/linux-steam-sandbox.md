# Linux / Steam: why 2.0 silently fails to launch

Investigation notes from a Linux box where SneakBit 2.0 launched fine from a shell
but died instantly from the Steam client. Two independent faults were found. Both
are still open at the time of writing.

Environment: Pop!\_OS (kernel 7.0.11), **Flatpak** Steam (`com.valvesoftware.Steam`),
app 3360860 on the `smoketest` branch.

## TL;DR

1. `applyLinuxSandboxFallback()` cannot work. The decision table in
   `electron/linuxSandbox.js` is correct, but `app.commandLine.appendSwitch()`
   runs too late — Chromium aborts before `electron/main.js` is ever evaluated.
   The flag has to be on **argv**, which means a launcher script.
2. The Linux depot has not actually been updated since build `24716839`. Builds
   after it shipped new Windows and macOS content while re-uploading a **stale
   `dist/linux-unpacked`**, so the Linux fixes were never on the branch at all.

Because of (2), a failing Linux launch is not evidence about the most recent
change — that code has never run on a Steam install.

## Fault 1 — the fallback runs after the process is already dead

### Symptom

From the Steam client: window never appears, no error, no crash dialog. Steam's
`logs/console-linux.txt` shows the process added and removed inside one second.

```
17:13:52 Adding process 2114 for gameID 3360860
17:13:53 Game Recording - game stopped [gameid=3360860]
```

Running the same binary from a shell works, which is what makes it look like a
Steam problem.

### What actually happens

Reproduced by running the installed build inside the Flatpak Steam runtime:

```
$ flatpak run --command=sh com.valvesoftware.Steam \
    -c 'cd ~/.local/share/Steam/steamapps/common/SneakBit && ./sneakbit'

FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166
The SUID sandbox helper binary was found, but is not configured correctly.
Rather than run without sandboxing I'm aborting now. You need to make sure that
.../SneakBit/chrome-sandbox is owned by root and has mode 4755.
```

Chromium needs one of two sandboxes and gets neither:

| Mechanism | Status here |
|---|---|
| Namespace sandbox (unprivileged userns) | Blocked — Flatpak cannot nest user namespaces. `unshare --user` → `EPERM` inside the runtime, works on the host. |
| setuid-root `chrome-sandbox` helper | Installed `0755 curzel:curzel`. SteamPipe does not carry the setuid bit and installs run unprivileged, so a depot can never satisfy this. |

So far this matches the reasoning already written into `electron/linuxSandbox.js`.
The problem is the delivery.

### Proof the fallback never fires

`SNEAKBIT_SANDBOX=0` forces `needsNoSandbox()` to return `true` unconditionally,
which guarantees both `appendSwitch("no-sandbox")` and the `console.warn` in
`electron/main.js`:

```
$ SNEAKBIT_SANDBOX=0 ./sneakbit
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166 ...
EXIT=133
```

Same abort — and crucially **no `[sandbox]` line on stderr**. That warning is
unconditional on this path, so its absence means `electron/main.js` was never
evaluated. Chromium initialises the SUID sandbox host during early startup, well
before the JS entry point. By the time `app.commandLine` exists the process is
already gone.

"Before app ready" is not early enough for this particular switch. Note this is
specific to the sandbox — plenty of other switches *do* work from `main.js`.

### What does work

All three tested against the installed build inside the Flatpak Steam runtime:

| Delivery | Result |
|---|---|
| `appendSwitch("no-sandbox")` in `main.js` | aborts |
| `./sneakbit --no-sandbox` (argv) | runs |
| `ELECTRON_DISABLE_SANDBOX=1 ./sneakbit` | runs |

### Proposed fix

Ship a launcher script as the Linux depot's launch executable. This one was
written into the Steam install dir and confirmed to launch the game inside the
Flatpak runtime:

```sh
#!/bin/sh
# Chromium decides whether it can sandbox during early startup, before main.js
# is evaluated -- app.commandLine.appendSwitch("no-sandbox") is too late and
# silently does nothing. The flag has to be on argv.
set -eu
DIR=$(dirname "$(readlink -f "$0")")
HELPER="$DIR/chrome-sandbox"

usable=0
case "${SNEAKBIT_SANDBOX-}" in
  1) usable=1 ;;
  0) usable=0 ;;
  *) [ -u "$HELPER" ] && [ "$(stat -c %u "$HELPER" 2>/dev/null)" = 0 ] && usable=1 ;;
esac

if [ "$usable" = 1 ]; then
  exec "$DIR/sneakbit" "$@"
fi
exec "$DIR/sneakbit" --no-sandbox "$@"
```

It keeps the existing policy intact: sandbox only where a stat proves it works,
`SNEAKBIT_SANDBOX` overrides both ways, `"$@"` preserves `%command%` arguments.

Then in Steamworks → *Installation* → *General Installation*, point the Linux
executable at the script instead of `sneakbit`. SteamPipe does preserve the exec
bit, so `chmod +x` at package time is enough.

Given the module's own conclusion that a Steam depot can never carry the setuid
bit, an unconditional `--no-sandbox` for the Steam build would be defensible too
— the stat check only earns its keep if the Linux build is also shipped outside
Steam.

`electron/linuxSandbox.js` and `tests/linuxSandbox.test.js` can stay as the
documented policy, but the effective decision has to move to the script.
Worth noting that the whole test file passes today: it only exercises the pure
decision table, which was never the broken part. That is exactly the kind of
green suite that hides an integration bug — a test that the flag actually reaches
Chromium would need to launch the packaged binary and assert it stays alive.

## Fault 2 — the Linux depot was not rebuilt

`smoketest` moved from build `24716839` to `24717244`, but this machine never
downloaded anything and Steam was right not to. Manifest gids are
content-addressed, so an identical gid means byte-identical content:

```
branch smoketest → depot 3360863 (Linux)   gid 8459605760816827322
installed        → depot 3360863           gid 8459605760816827322
```

Tracking all three depots across the two builds:

| Depot | Platform | after `24716839` | after `24717244` |
|---|---|---|---|
| 3360861 | Windows | `6407278751698101433` | `7031661684063532276` — changed |
| 3360862 | macOS | `4645438012402667616` | `2465613659724198679` — changed |
| 3360863 | **Linux** | `8459605760816827322` | `8459605760816827322` — **unchanged** |

Steam received the appinfo change (`appinfo_log.txt`, 18:12:36) and correctly
queued nothing, because depot 3360863 had no delta. `StateFlags` stayed
`4` (Fully Installed). The last real commit was the earlier build:

```
17:40:39 AppID 3360860 finished update, 1 mounted depots (BuildID 24716839) : 3360863 (8459605760816827322)
```

The `buildid` gap in `appmanifest_3360860.acf` is cosmetic. Nothing was pending
and a *Verify Integrity* would have changed nothing.

### How this happens

`npm run dist` is `rm -rf dist && npm run build && electron-builder --mac --win --linux`,
so a full run cannot produce a stale `linux-unpacked` — the directory would be
missing and `find_dist_dirs()` would raise. Windows and macOS changing while Linux
did not therefore points at electron-builder being run directly for a subset of
platforms over an existing `dist/`, leaving the previous run's `linux-unpacked`
in place for `tools/steam_upload.py` to pick up and re-upload verbatim.

`find_dist_dirs()` guards against exactly this for macOS — it sorts `mac*` folders
by mtime and warns when several exist, with a comment about not silently shipping
a stale build. There is no equivalent guard for `win-unpacked` or `linux-unpacked`,
and a stale folder there is invisible: the upload log reports success and Steam
dedupes the content away.

Worth adding: compare each platform folder's mtime against `_site/`'s (or against
the newest source file) and refuse to upload — or at least warn loudly — when a
platform's output predates the build it is supposed to contain. It costs a few
lines and would have caught this before two rounds of debugging the wrong binary.

## Who this affects

Not just this machine. The namespace sandbox is unavailable under **Flatpak
Steam**, which is the default install on Bazzite, Nobara and most Fedora/KDE
software-centre setups. Distros that disable unprivileged user namespaces
outright (Ubuntu 24.04's AppArmor restriction, various hardened kernels) hit the
same wall on native Steam.

One correction to the comment in `electron/linuxSandbox.js` and the *Known gaps*
entry in `docs/steam.md`: both attribute the blocked namespaces to *Steam's own
runtime*. On this machine the game launches natively — there is no pressure-vessel
wrapper in `console-linux.txt` — and the restriction comes from Flatpak. The
distinction matters for judging how many players are affected. If the Linux depot
were ever moved under the Steam Linux Runtime, that container would block
namespaces too, so the launcher fix is right either way.

`docs/steam.md` also currently tells the reader that `[sandbox]` appearing in a
tester's terminal output means the fallback fired and something else is wrong.
That line should go: in the failing case the fallback *cannot* print, because the
process dies before `main.js` runs. Absence of `[sandbox]` is the signature of
this bug, not evidence against it.

## Reproducing

Any machine with Flatpak Steam. The failure needs the Flatpak sandbox — running
the same binary from a normal shell succeeds, because the host allows user
namespaces and Chromium never reaches the setuid path.

```sh
# fails
flatpak run --command=sh com.valvesoftware.Steam \
  -c 'cd ~/.local/share/Steam/steamapps/common/SneakBit && ./sneakbit'

# succeeds
flatpak run --command=sh com.valvesoftware.Steam \
  -c 'cd ~/.local/share/Steam/steamapps/common/SneakBit && ./sneakbit --no-sandbox'

# confirms the namespace sandbox is unavailable in there
flatpak run --command=sh com.valvesoftware.Steam -c 'unshare --user true'
```

Useful files while debugging, under
`~/.var/app/com.valvesoftware.Steam/data/Steam/`:

| Path | Tells you |
|---|---|
| `logs/console-linux.txt` | game process added/removed, i.e. how fast it died |
| `logs/content_log.txt` | which depots actually committed, with build id and gid |
| `logs/appinfo_log.txt` | when the client learned about a new build |
| `steamapps/appmanifest_3360860.acf` | installed vs branch gids — the fault-2 smoking gun |
