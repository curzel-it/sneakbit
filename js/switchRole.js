// Runtime role transition: offline ↔ host ↔ guest, in-place, no page
// reload. Pairs teardown of the old role's modules with setup of the new
// one and lets the rest of the app reset its world state via the
// state-handler registry.
//
// Per docs/multiplayer.md § Sessions and invites, a deep-link
// `?join=CODE` while already in a session auto-leaves the current
// session before joining the new one — switchRole's idempotency check
// special-cases that "same role, different code" path.

import {
  getRuntimeRole,
  setRuntimeRole,
} from "./onlineMode.js";
import {
  ensureNet,
  closeNet,
  resetOnlineState,
  dispatchHandshake,
  isWelcomed,
  setPendingGuestCode,
  getInviteCode,
  getNet,
} from "./onlineBootstrap.js";
import { installSnapshotBroadcaster, stopSnapshotBroadcaster } from "./snapshotBroadcaster.js";
import { installHostGuests, uninstallHostGuests } from "./hostGuests.js";
import { installHostPauseBroadcaster, uninstallHostPauseBroadcaster } from "./hostPauseState.js";
import { installHostLoadoutSync, uninstallHostLoadoutSync } from "./hostLoadoutSync.js";
import { installHostShop, uninstallHostShop } from "./hostShop.js";
import { installGuestLoadoutSync, uninstallGuestLoadoutSync } from "./guestLoadoutSync.js";
import { installGiantNet, uninstallGiantNet } from "./giantMode.js";
import { installGuestSelfHpSync, uninstallGuestSelfHpSync } from "./guestSelfHpSync.js";
import { installMirrorWorld, uninstallMirrorWorld } from "./mirrorWorld.js";
import { installPredictedSelf, uninstallPredictedSelf } from "./predictedSelf.js";
import { installGuestInputForwarder, uninstallGuestInputForwarder } from "./guestInputForwarder.js";
import { installGuestEvents, uninstallGuestEvents } from "./guestEvents.js";
import { reapplyAutoZoom } from "./zoom.js";
import { hideGameOver, isGameOverOpen } from "./gameOver.js";
import { closeNetworkDialogue } from "./dialogue.js";
import { setHostPausedRemote } from "./guestHostPause.js";
import { clearLocalEffects } from "./localEffects.js";

// Callbacks main.js installs at boot. switchRole calls them to rebuild /
// wipe the live `state` object that lives in main.js's closure.
//   onEnterOffline: re-build state from local save (load progress, zone,
//                   players, etc.) so the offline tick has fresh data.
//   onEnterHost:    no-op by default — host runs the existing state.
//   onEnterGuest:   wipe state.player/zone/etc. so the offline tick
//                   doesn't paint stale data; mirrorWorld supplies the
//                   guest's view from snapshots instead.
//   stateGetter:    returns the live `state` object, used by per-role
//                   module installs that need it (snapshotBroadcaster,
//                   hostGuests).
//   p2Factory:      makeCoopP2 from main.js, used by hostGuests when a
//                   guest joins slot 2/3/4.
let stateHandlers = {
  onEnterOffline: null,
  onEnterHost: null,
  onEnterGuest: null,
  stateGetter: null,
  p2Factory: null,
};

export function setStateHandlers(h) {
  stateHandlers = { ...stateHandlers, ...h };
}

// Switches the tab's runtime role. Idempotent on no-op transitions
// (already in `target` with the same code). The same-role-different-code
// case is the deep-link-while-in-session flow: drop the current session
// before joining the new one.
export async function switchRole(target, opts = {}) {
  if (target !== "offline" && target !== "host" && target !== "guest") {
    throw new Error(`switchRole: unknown role "${target}"`);
  }
  const cur = getRuntimeRole();
  if (cur === target) {
    if (target === "guest" && opts.code && opts.code !== getInviteCode()) {
      // Fall through — auto-leave current guest session and re-join with
      // the new code. host → host with a different code makes no sense
      // (one host owns the session) so we just no-op there.
    } else {
      return;
    }
  }

  await teardownRole(cur);
  await setupRole(target, opts);
  setRuntimeRole(target);
  // Mobile browsers don't always fire a `resize` event when their soft
  // keyboard / address bar settles after a role transition (e.g. closing
  // the party panel that asked for a join code). Without this re-apply,
  // the canvas can be left sized for the transient viewport, making the
  // game look "zoomed in" until the next real resize. Three re-fires:
  //   * immediate, for the synchronous part of the transition
  //   * next frame, to catch the overlay teardown's CSS effects
  //   * +400ms, to catch the iOS soft-kbd slide-down, which animates
  //     well past one frame and doesn't always fire window.resize
  reapplyAutoZoom();
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => reapplyAutoZoom());
  }
  if (typeof setTimeout !== "undefined") {
    setTimeout(() => reapplyAutoZoom(), 400);
  }
}

// Teardown is best-effort cleanup, never a gate on the transition.
// switchRole awaits teardownRole *before* it flips the runtime role
// (setRuntimeRole, above), so if any single step throws, the role is
// never flipped and the game loop keeps ticking a half-torn-down world —
// the guest freezes with no way out but a reload. (That is exactly how a
// missing clearLocalEffects import once stranded kicked guests in the
// "guest" role.) Isolate every step so one failure logs and the rest —
// and the role flip — still happen.
function safe(label, fn) {
  try { fn(); }
  catch (e) { console.error(`[switchRole] teardown step "${label}" failed`, e); }
}

async function teardownRole(role) {
  if (role === "host") {
    // Tell the relay the session is over BEFORE we drop the WS, so it
    // can fan session.closed to guests with a clean reason instead of
    // the 30 s ghost grace.
    safe("host.close", () => getNet()?.send({ op: "host.close" }));
    safe("stopSnapshotBroadcaster", stopSnapshotBroadcaster);
    safe("uninstallHostGuests", uninstallHostGuests);
    safe("uninstallHostPauseBroadcaster", uninstallHostPauseBroadcaster);
    safe("uninstallHostLoadoutSync", uninstallHostLoadoutSync);
    safe("uninstallHostShop", uninstallHostShop);
    safe("uninstallGiantNet", uninstallGiantNet);
  } else if (role === "guest") {
    safe("guest.leave", () => getNet()?.send({ op: "guest.leave" }));
    safe("uninstallMirrorWorld", uninstallMirrorWorld);
    safe("uninstallPredictedSelf", uninstallPredictedSelf);
    safe("uninstallGuestInputForwarder", uninstallGuestInputForwarder);
    safe("uninstallGuestEvents", uninstallGuestEvents);
    safe("uninstallGuestLoadoutSync", uninstallGuestLoadoutSync);
    safe("uninstallGiantNet", uninstallGiantNet);
    safe("uninstallGuestSelfHpSync", uninstallGuestSelfHpSync);
    // Drop any in-flight local cosmetic flashes so a stale one can't paint
    // into the next world after the guest leaves.
    safe("clearLocalEffects", clearLocalEffects);
    // Dismiss any host-driven overlays that would otherwise stay up after
    // the session ends. The "Waiting for the host…" gameOver (no Continue
    // button) is the load-bearing case — without this it freezes the next
    // offline tick (paused gates every system), so the player sees the
    // overlay, can't move, can't shoot, can't dismiss it, and reload is
    // the only out. closeNetworkDialogue + setHostPausedRemote(false)
    // are defensive companions for the same shape of bug.
    safe("hideGameOver", () => { if (isGameOverOpen()) hideGameOver(); });
    safe("closeNetworkDialogue", closeNetworkDialogue);
    safe("setHostPausedRemote", () => setHostPausedRemote(false));
  }
  if (role === "host" || role === "guest") {
    safe("resetOnlineState", resetOnlineState);
  }
}

async function setupRole(target, opts) {
  if (target === "offline") {
    closeNet();
    if (stateHandlers.onEnterOffline) await stateHandlers.onEnterOffline();
    clearOnlineUrlParams();
    return;
  }

  if (target === "host") {
    setRuntimeRole("host");  // set early so welcome handler picks the right handshake
    if (stateHandlers.onEnterHost) await stateHandlers.onEnterHost();
    const n = ensureNet();
    if (isWelcomed()) {
      dispatchHandshake();
    } else {
      // Welcome not yet received (fresh WS open). The welcome handler
      // in onlineBootstrap calls dispatchHandshake itself; we just need
      // to re-fire onEnterHost so it can tag state.player.playerId
      // with the now-resolved selfPlayerId. One-shot — auto-unsubs.
      const unsubWelcome = n.on("welcome", () => {
        unsubWelcome();
        if (stateHandlers.onEnterHost) stateHandlers.onEnterHost();
      });
    }
    // Order matters: hostGuests must subscribe to `peer.joined` BEFORE
    // the broadcaster does. Both modules listen on `peer.joined`, and
    // net.js dispatches handlers in registration order. The broadcaster's
    // handler builds a snapshot from `state.player + state.player2 +
    // state.players`, so if it fires first the just-joined guest hasn't
    // been spawned yet and the snapshot ships without them — the new
    // guest's mirror then has no entry for itself, predictedSelf can't
    // be built, and their own avatar stays invisible until the next
    // delta (~50 ms later).
    installHostGuests(stateHandlers.stateGetter, { makeCoopP2: stateHandlers.p2Factory });
    installSnapshotBroadcaster(stateHandlers.stateGetter);
    installHostPauseBroadcaster();
    installHostLoadoutSync();
    installHostShop(stateHandlers.stateGetter);
    installGiantNet({ net: n });
    return;
  }

  if (target === "guest") {
    if (!opts.code) throw new Error("switchRole: guest target needs a code");
    setRuntimeRole("guest");
    setPendingGuestCode(opts.code);
    if (stateHandlers.onEnterGuest) await stateHandlers.onEnterGuest();
    const n = ensureNet();
    installMirrorWorld(n);
    installGuestInputForwarder(n);
    installPredictedSelf(n);
    installGuestEvents(n);
    installGuestLoadoutSync({ net: n });
    installGiantNet({ net: n });
    installGuestSelfHpSync({ net: n });
    if (isWelcomed()) dispatchHandshake();
    return;
  }
}

// Strip ?host / ?join / ?server from the URL when transitioning back to
// offline. Without this a deep-link guest (?join=CODE) who left the
// session would land in offline runtime-role-wise, but a manual reload
// would bounce them back into guest mode via getMode() reading the
// stale URL — the same trap that produced the "can't shoot after
// terminating co-op" bug (the boot-time bootGuest gate hung off this).
function clearOnlineUrlParams() {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const k of ["host", "join", "server"]) {
      if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
    }
    if (changed) window.history.replaceState(null, "", url.toString());
  } catch { /* ignore — non-fatal cosmetic step */ }
}

// Test seam — exposed so unit tests can verify the state-handler
// registry is wired without going through a full role transition.
export function _getStateHandlersForTesting() { return stateHandlers; }
export function _resetStateHandlersForTesting() {
  stateHandlers = {
    onEnterOffline: null,
    onEnterHost: null,
    onEnterGuest: null,
    stateGetter: null,
    p2Factory: null,
  };
}
