// Guest-side dispatcher for the host's `event` frames. Maps each
// `kind` to the appropriate local UI action. Unknown kinds are ignored
// (forward-compat — older clients silently skip new event types).
//
// Pickup / death / respawn / dialogue / cutscene flesh out over time as
// the matching host-side hooks land.

import { showToast } from "./toast.js";

let installed = false;
let unsub = null;
const customHandlers = new Map();

export function installGuestEvents(net) {
  if (installed) return;
  installed = true;
  unsub = net.on("event", dispatch);
}

export function _uninstallGuestEventsForTesting() {
  if (unsub) try { unsub(); } catch { /* ignore */ }
  unsub = null;
  installed = false;
  customHandlers.clear();
}

// Optional override seam so tests can stub a kind without touching the
// real toast.js DOM.
export function setGuestEventHandler(kind, fn) {
  if (typeof fn === "function") customHandlers.set(kind, fn);
  else customHandlers.delete(kind);
}

export function dispatch(msg) {
  if (!msg || typeof msg.kind !== "string") return;
  const custom = customHandlers.get(msg.kind);
  if (custom) { try { custom(msg); } catch (e) { console.error(e); } return; }
  switch (msg.kind) {
    case "toast":
      if (typeof msg.text === "string") {
        showToast(msg.text, msg.toastType || "hint", { _fromNetwork: true });
      }
      return;
    default:
      // Pickup / death / respawn / dialogue / cutscene land here in
      // follow-up commits.
      return;
  }
}
