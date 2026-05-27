// Top-level glue between getMode() / createNet() and the role-specific
// handshake. Called once from main.js at boot; subsequent reconnects
// re-issue the host.open or guest.join automatically because the welcome
// handler is bound across all reconnects (net.js fires "_open" and the
// server re-emits "welcome" after every successful hello).

import { getMode, getJoinCode } from "./onlineMode.js";
import { createNet } from "./net.js";
import { installWebrtcTransport } from "./webrtcTransport.js";
import { getIceServers, primeIceServers } from "./iceConfig.js";

let net = null;
let role = null;
let inviteCode = null;
let selfPlayerId = null;
let mySlot = null;
let hostPlayerId = null;
let knownPeers = [];
let lastJoinError = null;
let rtcTransport = null;
// playerId → display name. Populated from welcome (self), guest.joined
// (host + initial peers), and peer.joined/peer.rejoined for newcomers.
// entities.js reads this to label avatars; mirrorWorld players carry
// playerId so the same lookup works for the local-render side.
const nameByPlayerId = new Map();

export function getNetRole() { return role; }
export function getInviteCode() { return inviteCode; }
export function getSelfPlayerId() { return selfPlayerId; }
export function getMySlot() { return mySlot; }
export function getHostPlayerId() { return hostPlayerId; }
export function getKnownPeers() { return knownPeers.slice(); }
export function getLastJoinError() { return lastJoinError; }
export function getNet() { return net; }
export function getNameForPlayerId(pid) {
  if (!pid) return null;
  return nameByPlayerId.get(pid) || null;
}

export function bootstrapOnline({ netFactory = createNet } = {}) {
  const mode = getMode();
  if (mode === "offline") return null;
  role = mode;
  net = netFactory();

  net.on("welcome", (m) => {
    selfPlayerId = m.playerId || selfPlayerId;
    if (m.playerId && m.name) nameByPlayerId.set(m.playerId, m.name);
    if (role === "host") net.send({ op: "host.open" });
    else if (role === "guest") {
      const code = getJoinCode();
      if (code) net.send({ op: "guest.join", code });
    }
  });

  net.on("host.opened", (m) => {
    inviteCode = m.code;
    selfPlayerId = selfPlayerId || null;
    console.log("[online] host session", m.resumed ? "resumed" : "opened", "code =", m.code);
  });

  net.on("guest.joined", (m) => {
    selfPlayerId = m.selfPlayerId;
    mySlot = m.slot;
    hostPlayerId = m.hostPlayerId;
    knownPeers = m.peers || [];
    lastJoinError = null;
    if (m.hostPlayerId && m.hostName) nameByPlayerId.set(m.hostPlayerId, m.hostName);
    for (const p of knownPeers) {
      if (p.playerId && p.name) nameByPlayerId.set(p.playerId, p.name);
    }
    console.log("[online] joined session", m.sessionId, "slot", m.slot);
  });

  net.on("guest.joinFailed", (m) => {
    lastJoinError = m.reason;
    console.error("[online] join failed:", m.reason);
  });

  net.on("peer.joined", (m) => {
    knownPeers.push({ playerId: m.playerId, name: m.name, slot: m.slot });
    if (m.playerId && m.name) nameByPlayerId.set(m.playerId, m.name);
    console.log("[online] peer joined:", m.playerId, "slot", m.slot);
  });

  net.on("peer.rejoined", (m) => {
    if (m.playerId && m.name) nameByPlayerId.set(m.playerId, m.name);
    console.log("[online] peer rejoined:", m.playerId);
  });

  net.on("peer.left", (m) => {
    knownPeers = knownPeers.filter((p) => p.playerId !== m.playerId);
    nameByPlayerId.delete(m.playerId);
    console.log("[online] peer left:", m.playerId, m.reason);
  });

  net.on("peer.ghosted", (m) => {
    console.log("[online] peer ghosted:", m.playerId);
  });

  net.on("host.ghosted", () => {
    console.warn("[online] host lagging…");
  });

  net.on("host.resumed", () => {
    console.log("[online] host back");
  });

  net.on("session.closed", (m) => {
    console.warn("[online] session closed:", m.reason);
  });

  net.on("_open", () => console.log("[online] ws open"));
  net.on("_close", ({ code, reason }) => console.warn("[online] ws closed", code, reason));

  net.connect();

  // Fire-and-forget: fetch TURN credentials if available so the WebRTC
  // peers can fall back to TURN when STUN can't punch through. STUN
  // defaults are always present, so the absence of a TURN server is
  // not fatal.
  primeIceServers(net.getUrl?.()).catch(() => { /* ignore — STUN-only */ });

  // Stand up the WebRTC transport. It silently no-ops in browsers
  // without RTCPeerConnection or in roles that aren't host/guest.
  rtcTransport = installWebrtcTransport({
    net,
    role,
    iceServers: getIceServers(),
    log: (...args) => console.log("[webrtc]", ...args),
  });

  return net;
}

export function getRtcTransport() { return rtcTransport; }

export function _resetOnlineBootstrapForTesting() {
  if (rtcTransport) {
    try { rtcTransport.close(); } catch { /* ignore */ }
  }
  rtcTransport = null;
  net = null;
  role = null;
  inviteCode = null;
  selfPlayerId = null;
  mySlot = null;
  hostPlayerId = null;
  knownPeers = [];
  lastJoinError = null;
  nameByPlayerId.clear();
}
