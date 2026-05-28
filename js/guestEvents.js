// Guest-side dispatcher for the host's `event` frames. Maps each
// `kind` to the appropriate local UI action. Unknown kinds are ignored
// (forward-compat — older clients silently skip new event types).
//
// Pickup / death / respawn / dialogue / cutscene flesh out over time as
// the matching host-side hooks land.

import { showToast } from "./toast.js?v=20260528";
import { fadeOverlayOut, fadeOverlayIn, FADE_OVERLAY_MS } from "./transitions.js?v=20260528";
import { addAmmo, getAmmo, removeAmmo } from "./inventory.js?v=20260528";
import { showGameOver, hideGameOver, isGameOverOpen } from "./gameOver.js?v=20260528";
import { getSelfPlayerId, getNameForPlayerId } from "./onlineBootstrap.js?v=20260528";
import { tr } from "./strings.js?v=20260528";
import {
  showNetworkDialogue,
  advanceNetworkDialogue,
  closeNetworkDialogue,
} from "./dialogue.js?v=20260528";
import { startCutsceneByKey, endCutsceneByKey } from "./cutscenes.js?v=20260528";
import { getMirrorZone } from "./mirrorWorld.js?v=20260528";
import { setHostPausedRemote } from "./guestHostPause.js?v=20260528";

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
  // Drop the cached host-pause flag so a future re-join doesn't show
  // a stale "Host paused" overlay before the new host has sent its
  // first hostPause event.
  setHostPausedRemote(false);
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
    case "ammoSet":
      handleAmmoSet(msg);
      return;
    case "death":
      handleDeath(msg);
      return;
    case "respawn":
      handleRespawn(msg);
      return;
    case "dialogueOpen":
      if (Array.isArray(msg.lines)) showNetworkDialogue(msg.lines);
      return;
    case "dialogueAdvance":
      if (typeof msg.idx === "number") advanceNetworkDialogue(msg.idx);
      return;
    case "dialogueClose":
      closeNetworkDialogue();
      return;
    case "cutsceneStart":
      if (typeof msg.key === "string") startCutsceneByKey(getMirrorZone(), msg.key);
      return;
    case "cutsceneEnd":
      if (typeof msg.key === "string") endCutsceneByKey(getMirrorZone(), msg.key);
      return;
    case "hostPause":
      setHostPausedRemote(!!msg.paused);
      return;
    default:
      return;
  }
}

// Mirror the host's addAmmo into the guest's local counts — but only
// when the host says THIS guest is the picker. Per-player inventory in
// online co-op means the matching guest's HUD ticks up; other guests
// receive the same event for SFX / future feedback hooks but skip the
// inventory side-effect. The legacy single-arg shape (no playerId) is
// treated as "for me" so single-player tests and older fixtures still
// addAmmo as before.
function handlePickup(msg) {
  if (msg?.playerId != null && msg.playerId !== getSelfPlayerId()) return;
  const items = Array.isArray(msg?.items) ? msg.items : [];
  for (const it of items) {
    if (!it) continue;
    const sid = it.speciesId | 0;
    const amount = it.amount | 0;
    if (!sid || amount <= 0) continue;
    addAmmo(sid, amount, 0);
  }
}

// Authoritative absolute-count update from the host. Used for shoot
// consumption (no pickup event) and as a follow-up after pickups to
// keep the HUD in lockstep with the host's pool. Only acts when the
// frame is addressed to this client.
function handleAmmoSet(msg) {
  if (!msg || msg.playerId !== getSelfPlayerId()) return;
  const items = Array.isArray(msg.items) ? msg.items : [];
  for (const it of items) {
    if (!it) continue;
    const sid = it.speciesId | 0;
    const target = Math.max(0, it.count | 0);
    if (!sid) continue;
    const have = getAmmo(sid, 0);
    if (target === have) continue;
    if (target > have) addAmmo(sid, target - have, 0);
    else removeAmmo(sid, have - target, 0);
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

// Self death → show the gameOver overlay in "waiting for host" mode
// (no Continue button — only the host's event:respawn dismisses it).
// Peer deaths get a transient toast so the guest knows their friend
// went down. Self vs peer is decided by playerId.
function handleDeath(msg) {
  const selfId = getSelfPlayerId();
  const pid = msg?.playerId;
  if (!pid) return;
  if (pid === selfId) {
    showGameOver(null, { waitingForHost: true });
    return;
  }
  const name = getNameForPlayerId(pid) || pid;
  const tmpl = tr("notification.player.died");
  const text = (tmpl && typeof tmpl === "string")
    ? tmpl.replace("%PLAYER_NAME%", name)
    : `${name} died`;
  showToast(text, "longHint", { _fromNetwork: true });
}

// Self respawn → dismiss the gameOver overlay. The host has already
// teleported the avatar; the next snapshot/delta will land the guest at
// the new spawnPoint, so we only need to flip the UI.
function handleRespawn(msg) {
  const selfId = getSelfPlayerId();
  const pid = msg?.playerId;
  if (!pid) return;
  if (pid === selfId && isGameOverOpen()) hideGameOver();
}
