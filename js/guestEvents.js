// Guest-side dispatcher for the host's `event` frames. Maps each
// `kind` to the appropriate local UI action. Unknown kinds are ignored
// (forward-compat — older clients silently skip new event types).
//
// Pickup / death / respawn / dialogue / cutscene flesh out over time as
// the matching host-side hooks land.

import { showToast } from "./toast.js?v=20260527";
import { fadeOverlayOut, fadeOverlayIn, FADE_OVERLAY_MS } from "./transitions.js?v=20260527";
import { addAmmo } from "./inventory.js?v=20260527";

let installed = false;
let unsub = null;
const customHandlers = new Map();

export function installGuestEvents(net) {
  if (installed) return;
  installed = true;
  unsub = net.on("event", dispatch);
}

// Production teardown — paired with installGuestEvents.
export function uninstallGuestEvents() {
  if (unsub) try { unsub(); } catch { /* ignore */ }
  unsub = null;
  installed = false;
  customHandlers.clear();
}

export const _uninstallGuestEventsForTesting = uninstallGuestEvents;

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
    case "zoneChange":
      handleZoneChange();
      return;
    case "pickup":
      handlePickup(msg);
      return;
    default:
      // Death / respawn / dialogue / cutscene land here in follow-up
      // commits.
      return;
  }
}

// Mirror the host's inventory.addAmmo into the guest's local counts.
// Pickups are resolved authoritatively on the host; we run addAmmo here
// just so the guest's ammo HUD reflects the result. Inventory is shared
// in online co-op (isCoopActive → effectiveIndex folds to 0), so the
// playerIndex argument is irrelevant.
function handlePickup(msg) {
  const items = Array.isArray(msg?.items) ? msg.items : [];
  for (const it of items) {
    if (!it) continue;
    const sid = it.speciesId | 0;
    const amount = it.amount | 0;
    if (!sid || amount <= 0) continue;
    addAmmo(sid, amount, 0);
  }
}

// Drive the same fade overlay that the offline transitions code uses.
// Host sends event:zoneChange BEFORE the new-zone full snapshot; we
// fade to black immediately, then fade back in once the snapshot has
// had a chance to land (matching the offline transition rhythm).
function handleZoneChange() {
  fadeOverlayOut();
  setTimeout(() => fadeOverlayIn(), FADE_OVERLAY_MS);
}
