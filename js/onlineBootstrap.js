// Online-mode net plumbing: owns the singleton net instance, wires the
// session-lifecycle handlers, and exposes bookkeeping (selfPlayerId, peer
// list, invite code) that the UI subscribes to.
//
// Role is runtime state, not a URL contract — see onlineMode.js's
// getRuntimeRole(). The welcome handler reads it to decide which
// handshake to issue (host.open / guest.join), so a reconnect after
// grace re-issues the right frame automatically.

import { getMode, getJoinCode, getRuntimeRole } from "./onlineMode.js?v=20260527b";
import { createNet } from "./net.js?v=20260527b";
import { installWebrtcTransport } from "./webrtcTransport.js?v=20260527b";
import { getIceServers, primeIceServers } from "./iceConfig.js?v=20260527b";

let net = null;
let inviteCode = null;
let selfPlayerId = null;
let mySlot = null;
let hostPlayerId = null;
let knownPeers = [];
let lastJoinError = null;
let rtcTransport = null;
// True once `welcome` has been received on the current WS. switchRole
// uses this to decide whether to send the role handshake immediately or
// let the welcome handler do it.
let welcomed = false;
// The invite code switchRole wants to use for the next guest.join.
// Distinct from getJoinCode() which is URL-only and read-only.
let pendingGuestCode = null;
// playerId → display name. Populated from welcome (self), guest.joined
// (host + initial peers), and peer.joined/peer.rejoined for newcomers.
// entities.js reads this to label avatars; mirrorWorld players carry
// playerId so the same lookup works for the local-render side.
const nameByPlayerId = new Map();
// Listeners survive net recreations — registered once at boot, fire on
// every WS close (across the original net, the re-opened net after a
// role switch, etc.). Net `on("_close", ...)` is per-net, so we proxy
// here. Used for things like "show toast + switchRole on 4005".
const closeListeners = new Set();

export function onAnyClose(fn) {
  closeListeners.add(fn);
  return () => closeListeners.delete(fn);
}

// Net-agnostic session-state listeners. Fired whenever something the UI
// might want to re-render changes (welcome, host.opened, guest.joined,
// peer add/remove, ghost/resume, session close). partyPanel subscribes
// once at install and reads the current state via the getters.
const sessionStateListeners = new Set();
function notifySessionState() {
  for (const fn of [...sessionStateListeners]) {
    try { fn(); }
    catch (e) { console.error("onSessionState handler", e); }
  }
}

export function onSessionState(fn) {
  sessionStateListeners.add(fn);
  return () => sessionStateListeners.delete(fn);
}

// Compatibility: the legacy getNetRole() shim keeps consumers that read
// "what role is this tab" pointing at the runtime role.
export function getNetRole() { return getRuntimeRole(); }
export function getInviteCode() { return inviteCode; }
export function getSelfPlayerId() { return selfPlayerId; }
export function getMySlot() { return mySlot; }
export function getHostPlayerId() { return hostPlayerId; }
export function getKnownPeers() { return knownPeers.slice(); }
export function getLastJoinError() { return lastJoinError; }
export function getNet() { return net; }
export function isWelcomed() { return welcomed; }
export function getNameForPlayerId(pid) {
  if (!pid) return null;
  return nameByPlayerId.get(pid) || null;
}

export function setPendingGuestCode(code) { pendingGuestCode = code || null; }
export function getPendingGuestCode() { return pendingGuestCode; }

// Lazy net factory used by switchRole. Idempotent: returns the existing
// net if one is alive, otherwise creates a fresh one, wires handlers and
// kicks off the WebRTC transport.
export function ensureNet({ netFactory = createNet } = {}) {
  if (net) return net;
  net = netFactory();
  welcomed = false;
  wireNetHandlers(net);
  net.connect();

  // Fire-and-forget: fetch TURN credentials so WebRTC can fall back to
  // TURN when STUN can't punch through. STUN defaults are always
  // present, so the absence of a TURN server is not fatal.
  primeIceServers(net.getUrl?.()).catch(() => { /* ignore — STUN-only */ });

  rtcTransport = installWebrtcTransport({
    net,
    role: getRuntimeRole(),
    iceServers: getIceServers(),
    log: (...args) => console.log("[webrtc]", ...args),
  });

  return net;
}

// Close the WS and drop the singleton so a future ensureNet() creates a
// fresh one. Used by switchRole on host/guest → offline transitions so
// the relay drops the session entry and stops billing us as connected.
export function closeNet() {
  if (rtcTransport) {
    try { rtcTransport.close(); } catch { /* ignore */ }
  }
  rtcTransport = null;
  if (net) {
    try { net.close(); } catch { /* ignore */ }
  }
  net = null;
  welcomed = false;
}

// Clear per-session bookkeeping. Called by switchRole on every role
// transition so the next session doesn't inherit stale peer / slot
// state. Does NOT touch the net itself.
export function resetOnlineState() {
  inviteCode = null;
  selfPlayerId = null;
  mySlot = null;
  hostPlayerId = null;
  knownPeers = [];
  lastJoinError = null;
  pendingGuestCode = null;
  nameByPlayerId.clear();
  notifySessionState();
}

// Send the role-appropriate handshake. Safe to call before welcome — the
// welcome handler will call it itself once welcome arrives. host.open
// asks the relay to open a new (or resume an existing) session;
// guest.join consumes the pendingGuestCode (set by switchRole).
export function dispatchHandshake() {
  if (!net) return;
  const role = getRuntimeRole();
  if (role === "host") {
    net.send({ op: "host.open" });
  } else if (role === "guest") {
    const code = pendingGuestCode || getJoinCode();
    if (code) net.send({ op: "guest.join", code });
  }
}

function wireNetHandlers(n) {
  n.on("welcome", (m) => {
    selfPlayerId = m.playerId || selfPlayerId;
    if (m.playerId && m.name) nameByPlayerId.set(m.playerId, m.name);
    welcomed = true;
    dispatchHandshake();
    notifySessionState();
  });

  n.on("host.opened", (m) => {
    inviteCode = m.code;
    selfPlayerId = selfPlayerId || null;
    console.log("[online] host session", m.resumed ? "resumed" : "opened", "code =", m.code);
    notifySessionState();
  });

  n.on("guest.joined", (m) => {
    selfPlayerId = m.selfPlayerId;
    mySlot = m.slot;
    hostPlayerId = m.hostPlayerId;
    knownPeers = m.peers || [];
    lastJoinError = null;
    pendingGuestCode = null;
    if (m.hostPlayerId && m.hostName) nameByPlayerId.set(m.hostPlayerId, m.hostName);
    for (const p of knownPeers) {
      if (p.playerId && p.name) nameByPlayerId.set(p.playerId, p.name);
    }
    console.log("[online] joined session", m.sessionId, "slot", m.slot);
    notifySessionState();
  });

  n.on("guest.joinFailed", (m) => {
    lastJoinError = m.reason;
    console.error("[online] join failed:", m.reason);
    notifySessionState();
  });

  n.on("peer.joined", (m) => {
    knownPeers.push({ playerId: m.playerId, name: m.name, slot: m.slot });
    if (m.playerId && m.name) nameByPlayerId.set(m.playerId, m.name);
    console.log("[online] peer joined:", m.playerId, "slot", m.slot);
    notifySessionState();
  });

  n.on("peer.rejoined", (m) => {
    if (m.playerId && m.name) nameByPlayerId.set(m.playerId, m.name);
    console.log("[online] peer rejoined:", m.playerId);
    notifySessionState();
  });

  n.on("peer.left", (m) => {
    knownPeers = knownPeers.filter((p) => p.playerId !== m.playerId);
    nameByPlayerId.delete(m.playerId);
    console.log("[online] peer left:", m.playerId, m.reason);
    notifySessionState();
  });

  n.on("peer.ghosted", (m) => {
    console.log("[online] peer ghosted:", m.playerId);
    notifySessionState();
  });

  n.on("host.ghosted", () => {
    console.warn("[online] host lagging…");
    notifySessionState();
  });

  n.on("host.resumed", () => {
    console.log("[online] host back");
    notifySessionState();
  });

  n.on("session.closed", (m) => {
    console.warn("[online] session closed:", m.reason);
    notifySessionState();
  });

  n.on("_open", () => console.log("[online] ws open"));
  n.on("_close", (m) => {
    welcomed = false;
    const code = m?.code;
    const reason = m?.reason;
    console.warn("[online] ws closed", code, reason);
    for (const fn of [...closeListeners]) {
      try { fn({ code, reason }); }
      catch (e) { console.error("onAnyClose handler", e); }
    }
  });
}

// Boot-time seed. Captures the URL's join code (if any), then — if the
// URL selected a role — opens the net so the welcome handshake is in
// flight by the time main.js's switchRole() runs. Does NOT set the
// runtime role: switchRole owns that, otherwise its cur===target check
// would skip the actual install. Tests that wire fake nets call this
// after _setOnlineModeForTesting (which seeds both cachedMode and
// runtimeRole), so the welcome handler dispatches the right handshake
// during their setup.
export function bootstrapOnline({ netFactory = createNet } = {}) {
  const mode = getMode();
  if (mode === "guest") pendingGuestCode = getJoinCode();
  if (mode === "offline") return null;
  return ensureNet({ netFactory });
}

export function getRtcTransport() { return rtcTransport; }

export function _resetOnlineBootstrapForTesting() {
  if (rtcTransport) {
    try { rtcTransport.close(); } catch { /* ignore */ }
  }
  rtcTransport = null;
  net = null;
  welcomed = false;
  pendingGuestCode = null;
  inviteCode = null;
  selfPlayerId = null;
  mySlot = null;
  hostPlayerId = null;
  knownPeers = [];
  lastJoinError = null;
  nameByPlayerId.clear();
}
