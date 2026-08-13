#!/bin/sh
# The Linux depot's launch target. Ships as `sneakbit`; the Electron binary it
# wraps is `sneakbit-bin` (package.json sets linux.executableName).
#
# This script exists because --no-sandbox has to be on argv. Chromium decides
# whether it can sandbox during early startup, before the JS entry point is
# evaluated, so app.commandLine.appendSwitch("no-sandbox") in main.js is too
# late and silently does nothing (electron/electron#20063). The old
# electron/linuxSandbox.js got the policy right and could never deliver it: on
# an affected machine the process aborted before printing its own warning,
# which is what made this look like a Steam problem for so long.
#
# Policy: keep the sandbox only where a stat proves it works — a chrome-sandbox
# helper that is both setuid and root-owned. A SteamPipe depot can never
# satisfy that, since depots don't carry the setuid bit and installs run
# unprivileged, so a Steam install always takes the fallback. The check still
# earns its keep if this build is ever shipped outside Steam.
#
# The renderer only loads bundled app:// content behind the CSP and navigation
# guards in appProtocol.js / main.js, so dropping the sandbox isn't opening a
# door to untrusted code — it's the difference between a playable build and one
# that dies with no window and no error.
#
# SNEAKBIT_SANDBOX overrides either way: 1 keeps the sandbox, 0 forces the
# fallback. Reachable from Steam's Launch Options as `SNEAKBIT_SANDBOX=0 %command%`.
set -eu

DIR=$(dirname "$(readlink -f "$0")")
GAME="$DIR/sneakbit-bin"
HELPER="$DIR/chrome-sandbox"

sandbox_is_usable() {
  case "${SNEAKBIT_SANDBOX-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  [ -u "$HELPER" ] && [ "$(stat -c %u "$HELPER" 2>/dev/null || echo -1)" = "0" ]
}

if sandbox_is_usable; then
  exec "$GAME" "$@"
fi

exec "$GAME" --no-sandbox "$@"
