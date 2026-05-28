// Guest-side last-known pause state of the host, fed by the
// event:hostPause messages broadcast from hostPauseState.js.
// hostLaggingOverlay.js reads isHostPausedRemote() every guest tick
// to swap the overlay copy from "Host lagging…" to "Host paused the
// game" when the host has explicitly paused, instead of letting the
// delta drought ambiguously read as a network problem.
//
// Reset on role transitions away from guest so a re-join doesn't
// inherit a stale "paused" flag from a previous session.

let paused = false;

export function setHostPausedRemote(next) {
  paused = !!next;
}

export function isHostPausedRemote() { return paused; }

export function _resetGuestHostPauseForTesting() { paused = false; }
