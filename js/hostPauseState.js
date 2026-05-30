// Host-side mirror of the local pause state, broadcast to guests as
// event:hostPause so they can show "Host paused the game" instead of
// the generic "Host lagging…" overlay (which is otherwise triggered
// by the delta drought a paused world naturally produces — the
// broadcaster only sends entity diffs, and a paused world has none).
//
// main.js calls setHostPaused(bool) from the host tick. We broadcast
// on every rising/falling edge, and re-broadcast the current value on
// peer.joined / peer.rejoined so a guest who connects mid-pause sees
// the right overlay rather than having to wait for the next unpause.

import { broadcastHostEvent } from "./hostEvents.js?v=20260530d";
import { getNet, getNetRole } from "./onlineBootstrap.js?v=20260530d";

let paused = false;
let unsubs = [];

export function setHostPaused(next) {
  next = !!next;
  if (next === paused) return;
  paused = next;
  broadcastHostEvent("hostPause", { paused });
}

export function isHostPausedLocally() { return paused; }

export function installHostPauseBroadcaster(opts = {}) {
  uninstallHostPauseBroadcaster();
  if (getNetRole() !== "host" && !opts.force) return false;
  const net = opts.net || getNet();
  if (!net) return false;
  const fire = () => broadcastHostEvent("hostPause", { paused });
  unsubs.push(net.on("peer.joined", fire));
  unsubs.push(net.on("peer.rejoined", fire));
  return true;
}

export function uninstallHostPauseBroadcaster() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  // Reset on teardown so a future re-install starts from a clean
  // edge — otherwise switching host → offline → host while paused
  // would skip the first hostPause broadcast on re-install.
  paused = false;
}

export function _resetHostPauseStateForTesting() {
  uninstallHostPauseBroadcaster();
}
