// Runtime role transition: offline ↔ host ↔ guest, in-place, no page
// reload. Pairs teardown of the old role's modules with setup of the new
// one and lets the rest of the app reset its world state via the
// state-handler registry.
//
// Per docs/server.md § Sessions and invites, a deep-link
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
import { installMirrorWorld, uninstallMirrorWorld } from "./mirrorWorld.js";
import { installPredictedSelf, uninstallPredictedSelf } from "./predictedSelf.js";
import { installGuestInputForwarder, uninstallGuestInputForwarder } from "./guestInputForwarder.js";
import { installGuestEvents, uninstallGuestEvents } from "./guestEvents.js";
import { reapplyAutoZoom } from "./zoom.js";

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
  // game look "zoomed in" until the next real resize. Symptom called out
  // in todo.md: "resolution changes after starting a co-op (spotted on
  // mobile)". Re-fire on the next frame too so we catch the viewport
  // *after* the overlay has finished tearing down and the chrome has
  // had a chance to redraw.
  reapplyAutoZoom();
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => reapplyAutoZoom());
  }
}

async function teardownRole(role) {
  if (role === "host") {
    // Tell the relay the session is over BEFORE we drop the WS, so it
    // can fan session.closed to guests with a clean reason instead of
    // the 30 s ghost grace.
    try { getNet()?.send({ op: "host.close" }); } catch { /* ignore */ }
    stopSnapshotBroadcaster();
    uninstallHostGuests();
  } else if (role === "guest") {
    try { getNet()?.send({ op: "guest.leave" }); } catch { /* ignore */ }
    uninstallMirrorWorld();
    uninstallPredictedSelf();
    uninstallGuestInputForwarder();
    uninstallGuestEvents();
  }
  if (role === "host" || role === "guest") {
    resetOnlineState();
  }
}

async function setupRole(target, opts) {
  if (target === "offline") {
    closeNet();
    if (stateHandlers.onEnterOffline) await stateHandlers.onEnterOffline();
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
    installSnapshotBroadcaster(stateHandlers.stateGetter);
    installHostGuests(stateHandlers.stateGetter, { makeCoopP2: stateHandlers.p2Factory });
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
    if (isWelcomed()) dispatchHandshake();
    return;
  }
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
