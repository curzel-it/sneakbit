// Tiny helper for the host to broadcast `event` frames to every guest.
// Used by toast.js, pickups.js, etc. to push discrete one-shots
// (pickup / death / dialogue / cutscene / toast) onto the wire alongside
// the 20 Hz delta stream.
//
// In offline / guest mode this no-ops, so call sites don't have to gate
// themselves — `showToast("hello")` works the same in single-player.

import { getNetRole, getNet } from "./onlineBootstrap.js?v=20260528b";

// Allowlist of `kind` values the host may push through. Matches
// docs/server.md §`event` — guests already silently ignore unknown
// kinds (forward-compat), but bouncing them here too keeps a typo at a
// fresh call site (`"toats"`) from hitting the wire and costing
// every guest a parse + dispatch cycle. Toast events also pin
// `toastType` to the showToast modes so a future caller can't smuggle
// a CSS class string through that field.
const ALLOWED_KINDS = new Set([
  "pickup",
  "death",
  "respawn",
  "dialogueOpen",
  "dialogueAdvance",
  "dialogueClose",
  "cutsceneStart",
  "cutsceneEnd",
  "zoneChange",
  "toast",
  "hostPause",
  "loadout",
  "ammoSet",
]);
const ALLOWED_TOAST_TYPES = new Set(["regular", "hint", "longHint"]);

export function broadcastHostEvent(kind, payload = {}) {
  if (getNetRole() !== "host") return;
  if (!ALLOWED_KINDS.has(kind)) {
    if (typeof console !== "undefined") {
      console.warn(`[hostEvents] dropping disallowed kind: ${kind}`);
    }
    return;
  }
  if (kind === "toast") {
    if (typeof payload.text !== "string" || payload.text === "") return;
    if (payload.toastType && !ALLOWED_TOAST_TYPES.has(payload.toastType)) return;
  }
  const net = getNet();
  if (!net || !net.isConnected?.()) return;
  net.send({ op: "event", kind, ...payload });
}
