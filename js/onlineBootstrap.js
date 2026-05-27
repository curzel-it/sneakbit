// Top-level glue between getMode() / createNet() and the role-specific
// handshake. Called once from main.js at boot; subsequent reconnects
// re-issue the host.open or guest.join automatically because the welcome
// handler is bound across all reconnects (net.js fires "_open" and the
// server re-emits "welcome" after every successful hello).

import { getMode, getJoinCode } from "./onlineMode.js";
import { createNet } from "./net.js";

let net = null;
let role = null;
let inviteCode = null;
let selfPlayerId = null;
let mySlot = null;
let hostPlayerId = null;
let knownPeers = [];
let lastJoinError = null;

export function getNetRole() { return role; }
export function getInviteCode() { return inviteCode; }
export function getSelfPlayerId() { return selfPlayerId; }
export function getMySlot() { return mySlot; }
export function getHostPlayerId() { return hostPlayerId; }
export function getKnownPeers() { return knownPeers.slice(); }
export function getLastJoinError() { return lastJoinError; }
export function getNet() { return net; }

export function bootstrapOnline({ netFactory = createNet } = {}) {
  const mode = getMode();
  if (mode === "offline") return null;
  role = mode;
  net = netFactory();

  net.on("welcome", (m) => {
    selfPlayerId = m.playerId || selfPlayerId;
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
    console.log("[online] joined session", m.sessionId, "slot", m.slot);
  });

  net.on("guest.joinFailed", (m) => {
    lastJoinError = m.reason;
    console.error("[online] join failed:", m.reason);
  });

  net.on("peer.joined", (m) => {
    knownPeers.push({ playerId: m.playerId, name: m.name, slot: m.slot });
    console.log("[online] peer joined:", m.playerId, "slot", m.slot);
  });

  net.on("peer.rejoined", (m) => {
    console.log("[online] peer rejoined:", m.playerId);
  });

  net.on("peer.left", (m) => {
    knownPeers = knownPeers.filter((p) => p.playerId !== m.playerId);
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
  return net;
}

export function _resetOnlineBootstrapForTesting() {
  net = null;
  role = null;
  inviteCode = null;
  selfPlayerId = null;
  mySlot = null;
  hostPlayerId = null;
  knownPeers = [];
  lastJoinError = null;
}
