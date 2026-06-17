// Guest-side dispatcher for the host's `event` frames. Maps each
// `kind` to the appropriate local UI action. Unknown kinds are ignored
// (forward-compat — older clients silently skip new event types).
//
// Pickup / death / respawn / dialogue / cutscene flesh out over time as
// the matching host-side hooks land.

import { showToast } from "./toast.js";
import { fadeOverlayOut, fadeOverlayIn, FADE_OVERLAY_MS } from "./transitions.js";
import { addAmmo, getAmmo, removeAmmo } from "./inventory.js";
import { addCoins } from "./wallet.js";
import { openShop } from "./shop.js";
import { showGameOver, hideGameOver, isGameOverOpen, showMatchResult } from "./gameOver.js";
import { setGameMode, GAME_MODE } from "./gameMode.js";
import { getSelfPlayerId, getNameForPlayerId, getNet } from "./onlineBootstrap.js";
import { tr } from "./strings.js";
import {
  showNetworkDialogue,
  advanceNetworkDialogue,
  closeNetworkDialogue,
} from "./dialogue.js";
import { startCutsceneByKey, endCutsceneByKey } from "./cutscenes.js";
import { getMirrorZone } from "./mirrorWorld.js";
import { setHostPausedRemote } from "./guestHostPause.js";

let installed = false;
let unsub = null;
const customHandlers = new Map();

// Idempotency guard for *additive* events (pickup → addAmmo). The host stamps
// every event with a monotonic `eid`; if the same pickup arrives twice (path
// switch, reconnect replay) we apply it once. Bounded ring so it can't grow
// without limit over a long session. Absolute/idempotent events (ammoSet,
// dialogue, UI toggles) don't need this.
const MAX_SEEN_EIDS = 256;
const seenPickupEids = new Set();

function alreadyApplied(eid) {
  if (typeof eid !== "number") return false; // legacy host without eids — can't dedupe
  if (seenPickupEids.has(eid)) return true;
  seenPickupEids.add(eid);
  if (seenPickupEids.size > MAX_SEEN_EIDS) {
    // Sets preserve insertion order — evict the oldest.
    seenPickupEids.delete(seenPickupEids.values().next().value);
  }
  return false;
}

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
  seenPickupEids.clear();
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
    case "coins":
      handleCoins(msg);
      return;
    case "shopOpen":
      handleShopOpen(msg);
      return;
    case "death":
      handleDeath(msg);
      return;
    case "respawn":
      handleRespawn(msg);
      return;
    case "dialogueOpen":
      if (Array.isArray(msg.lines)) showNetworkDialogue(msg.lines, msg.speaker || "");
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
    case "pvpStart":
      handlePvpStart();
      return;
    case "pvpResult":
      handlePvpResult(msg);
      return;
    case "pvpEnd":
      if (isGameOverOpen()) hideGameOver();
      return;
    default:
      return;
  }
}

// Host opened (or restarted) a realtime PvP match. Enter PvP rendering so the
// guest's HP bar scales to 1000 and the ammo HUD shows the PvP pool, and clear
// any leftover overlay (e.g. a previous round's result/death screen) so a
// rematch resets cleanly. The zoneChange event fades the guest into the arena.
function handlePvpStart() {
  setGameMode(GAME_MODE.pvp, { realtime: true });
  if (isGameOverOpen()) hideGameOver();
}

// Realtime PvP resolved — show the winner/unknown screen. Clear any waiting-for-
// host death overlay first so a dead guest still sees the result. The guest
// can't drive its own rematch, so the modal is waiting-style (no button) and is
// dismissed by the host's next pvpStart (rematch) or pvpEnd (left PvP).
function handlePvpResult(msg) {
  if (isGameOverOpen()) hideGameOver();
  showMatchResult({ kind: msg?.kind, playerIndex: msg?.playerIndex | 0 }, null, { waitingForHost: true });
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
  // Dedupe by event id *after* the addressed-to-me check (a not-for-me pickup
  // is a no-op anyway and shouldn't consume a slot). A duplicate delivery of an
  // additive pickup must not stack ammo.
  if (alreadyApplied(msg?.eid)) return;
  const items = Array.isArray(msg?.items) ? msg.items : [];
  for (const it of items) {
    if (!it) continue;
    const sid = it.speciesId | 0;
    const amount = it.amount | 0;
    if (!sid || amount <= 0) continue;
    addAmmo(sid, amount, 0);
  }
}

// Mirror the host's coin credit into this guest's own wallet — but only when
// the host says THIS guest is the picker (per-player wallets, like inventory).
// Additive, so it's idempotency-stamped like `pickup`.
function handleCoins(msg) {
  if (msg?.playerId != null && msg.playerId !== getSelfPlayerId()) return;
  if (alreadyApplied(msg?.eid)) return;
  const amount = msg?.amount | 0;
  if (amount > 0) addCoins(amount, 0);
}

// Host says THIS guest walked up to a clerk — open the buy screen on the
// guest's own client. The shop reads the guest's own wallet/inventory (index
// 0) and runs the purchase locally; coins and equipment are guest-authoritative
// and persist on this device. Ammo, though, lives in the host's authoritative
// per-guest pool (shooting.js spends it, ammoSet rebroadcasts it), so the buy
// screen reports each grant back over `shop.bought` and the host mirrors it
// (see hostShop.js). Other guests ignore a shopOpen addressed to a peer.
function handleShopOpen(msg) {
  if (msg?.playerId != null && msg.playerId !== getSelfPlayerId()) return;
  const stock = Array.isArray(msg?.stock) ? msg.stock : [];
  if (!stock.length) return;
  openShop(stock, 0, {
    onPurchase: (items) => {
      const net = getNet();
      if (net?.isConnected?.()) net.send({ op: "shop.bought", items });
    },
  });
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
