// Tiny helper for the host to broadcast `event` frames to every guest.
// Used by toast.js, pickups.js, etc. to push discrete one-shots
// (pickup / death / dialogue / cutscene / toast) onto the wire alongside
// the 20 Hz delta stream.
//
// In offline / guest mode this no-ops, so call sites don't have to gate
// themselves — `showToast("hello")` works the same in single-player.

import { getNetRole, getNet } from "./onlineBootstrap.js";

export function broadcastHostEvent(kind, payload = {}) {
  if (getNetRole() !== "host") return;
  const net = getNet();
  if (!net || !net.isConnected?.()) return;
  net.send({ op: "event", kind, ...payload });
}
