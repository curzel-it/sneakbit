// Online-mode net plumbing: owns the singleton net instance, wires the
// session-lifecycle handlers, and exposes bookkeeping (selfPlayerId, peer
// list, invite code) that the UI subscribes to.
//
// Role is runtime state, not a URL contract — see onlineMode.js's
// getRuntimeRole(). The welcome handler reads it to decide which
// handshake to issue (host.open / guest.join), so a reconnect after
// grace re-issues the right frame automatically.

import { getMode, getJoinCode, getRuntimeRole, setRuntimeRole } from "./onlineMode.js";
import { createNet } from "./net.js";
import { installWebrtcTransport } from "./webrtcTransport.js";
import { getIceServers, primeIceServers } from "./iceConfig.js";

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
  });

  n.on("host.opened", (m) => {
    inviteCode = m.code;
    selfPlayerId = selfPlayerId || null;
    console.log("[online] host session", m.resumed ? "resumed" : "opened", "code =", m.code);
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
  });

  n.on("guest.joinFailed", (m) => {
    lastJoinError = m.reason;
    console.error("[online] join failed:", m.reason);
  });

  n.on("peer.joined", (m) => {
    knownPeers.push({ playerId: m.playerId, name: m.name, slot: m.slot });
    if (m.playerId && m.name) nameByPlayerId.set(m.playerId, m.name);
    console.log("[online] peer joined:", m.playerId, "slot", m.slot);
  });

  n.on("peer.rejoined", (m) => {
    if (m.playerId && m.name) nameByPlayerId.set(m.playerId, m.name);
    console.log("[online] peer rejoined:", m.playerId);
  });

  n.on("peer.left", (m) => {
    knownPeers = knownPeers.filter((p) => p.playerId !== m.playerId);
    nameByPlayerId.delete(m.playerId);
    console.log("[online] peer left:", m.playerId, m.reason);
  });

  n.on("peer.ghosted", (m) => {
    console.log("[online] peer ghosted:", m.playerId);
  });

  n.on("host.ghosted", () => {
    console.warn("[online] host lagging…");
  });

  n.on("host.resumed", () => {
    console.log("[online] host back");
  });

  n.on("session.closed", (m) => {
    console.warn("[online] session closed:", m.reason);
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

// Backwards-compatible boot path. Seeds runtime role from the URL and
// opens the net if a role is selected. switchRole() is the canonical
// runtime-role driver — this is just the deep-link entry seed.
export function bootstrapOnline({ netFactory = createNet } = {}) {
  const mode = getMode();
  setRuntimeRole(mode);
  if (mode === "offline") return null;
  if (mode === "guest") pendingGuestCode = getJoinCode();
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
