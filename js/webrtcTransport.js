// Bridges net.js with one-or-more webrtcChannels so game traffic (input
// for guests; snapshot/delta/event for the host) leaves the WS path once a
// DataChannel to every peer is open. The relay is still authoritative for
// signaling, lifecycle frames, and pre-DC traffic — and remains the
// fallback if WebRTC fails.
//
// On the host, one channel per guest. On the guest, one channel to the
// host. When peer.joined / peer.left fan in over the WS, channels are
// allocated / torn down. The transport installs a send-side interceptor
// on net.js: if all relevant channels are open, the frame is shipped via
// DC(s) and the WS bypass returns `true`; otherwise it returns `false`
// and net.js falls through to the WS path.

import { createWebrtcChannel, DEFAULT_STUN_SERVERS, STATE } from "./webrtcChannel.js";

const GAME_OPS = new Set(["snapshot", "delta", "event", "input"]);

// Ops a remote peer may legitimately originate over the DataChannel,
// keyed by OUR role (the peer is the opposite role). The relay enforces
// this same trust boundary on the WS path by field-whitelisting every
// op and server-stamping `from`; the DC bypasses the relay, so without
// this gate a guest could emit relay-authoritative lifecycle frames
// (`peer.left` to despawn/PvP-kill a victim, `peer.joined` to hijack a
// slot, `peer.ghosted` to clear a peer's input) that the host's handlers
// key off attacker-controlled ids. We re-emit only the ops the peer
// could legitimately send and drop everything else.
const RECV_OPS = {
  // Host receives guest-originated game traffic.
  host: new Set(["input", "move", "event", "guest.loadout", "guest.resync", "webrtc.signal"]),
  // Guest receives the host's authoritative world frames.
  guest: new Set(["snapshot", "delta", "event", "webrtc.signal"]),
};

export function installWebrtcTransport({
  net,
  role,
  iceServers = DEFAULT_STUN_SERVERS,
  // Optional async () => iceServers[] for refreshing (expired) TURN creds
  // before an ICE restart. Forwarded to every channel.
  refreshIceServers = null,
  // Test seams.
  RTCPeerConnectionCtor,
  RTCSessionDescriptionCtor,
  RTCIceCandidateCtor,
  log = () => {},
} = {}) {
  if (!net) return null;
  // No WebRTC in this environment — skip cleanly so the rest of the app
  // falls back to WS-only.
  if (!RTCPeerConnectionCtor && typeof RTCPeerConnection === "undefined") return null;

  const channels = new Map(); // remotePlayerId -> webrtcChannel
  const unsubs = [];
  let closed = false;
  // Guest-only: the host's playerId, learned from guest.joined. Stored so a
  // bare host.resumed (which carries no id — see relay.js) can rebuild the
  // channel without waiting for an upstream re-fire that never comes.
  let hostPlayerId = null;
  const allowedRecvOps = RECV_OPS[role] || null;

  function ensureChannel(remotePlayerId, initiator) {
    if (!remotePlayerId) return null;
    if (channels.has(remotePlayerId)) return channels.get(remotePlayerId);
    let ch = null;
    ch = createWebrtcChannel({
      net,
      remotePlayerId,
      initiator,
      iceServers,
      refreshIceServers,
      RTCPeerConnectionCtor,
      RTCSessionDescriptionCtor,
      RTCIceCandidateCtor,
      onOpen: () => log("webrtc open ←→", remotePlayerId),
      onMessage: (data) => {
        // DataChannel ferries the same JSON frames the WS would. We just
        // re-emit through the existing net handlers so the rest of the
        // app (mirrorWorld, snapshotApply, etc.) is unaware of transport.
        // The relay stamps `from` on every WS-forwarded frame; the DC
        // bypasses the relay, so we stamp it here using the channel's
        // remotePlayerId. Without this, host's onInput (which requires
        // `from` to map intent→slot) silently drops every guest input
        // arriving via DC.
        let msg = null;
        if (typeof data === "string") {
          try { msg = JSON.parse(data); } catch { return; }
        } else if (data instanceof ArrayBuffer) {
          try { msg = JSON.parse(new TextDecoder().decode(data)); } catch { return; }
        }
        if (msg && typeof msg.op === "string") {
          // Drop ops this peer can't legitimately originate (lifecycle /
          // authoritative frames a guest must not forge). The DC has no
          // relay to field-whitelist them, so we do it here.
          if (allowedRecvOps && !allowedRecvOps.has(msg.op)) return;
          // Always stamp the channel's identity — never trust a peer-set
          // `from`. A guest pre-setting `from` to another player's id
          // would otherwise have its inputs applied as that player.
          msg.from = remotePlayerId;
          net.emitOp?.(msg.op, msg);
        }
      },
      onClose: () => {
        // Only forget this channel if it's still the active one. A rebuild
        // (host.resumed / peer.rejoined) may have already replaced it, and
        // the dead channel's async onClose must not evict the new one.
        if (channels.get(remotePlayerId) === ch) channels.delete(remotePlayerId);
        log("webrtc closed ←→", remotePlayerId);
      },
      onStateChange: (s) => log("webrtc state", remotePlayerId, "->", s),
    });
    if (ch) channels.set(remotePlayerId, ch);
    return ch;
  }

  function removeChannel(remotePlayerId) {
    const ch = channels.get(remotePlayerId);
    if (ch) try { ch.close(); } catch { /* ignore */ }
    channels.delete(remotePlayerId);
  }

  if (role === "host") {
    unsubs.push(net.on("peer.joined", (m) => ensureChannel(m.playerId, false)));
    // peer.rejoined fires when a previously-known guest's WS reconnects
    // after a backoff (iOS background, captive portal, etc.). The old
    // RTCPeerConnection on our side may still report `open` locally even
    // though the guest's underlying ICE pair is dead — the remote
    // suspended without ever closing the channel cleanly. Tear the old
    // channel down so the guest's next offer creates a fresh one. We
    // don't initiate ourselves (host is the answerer in this topology);
    // the guest's transport sees its own guest.joined fan-in and re-
    // issues the offer.
    unsubs.push(net.on("peer.rejoined", (m) => {
      removeChannel(m.playerId);
      ensureChannel(m.playerId, false);
    }));
    unsubs.push(net.on("peer.left", (m) => removeChannel(m.playerId)));
    // A guest reconnecting after the WS dropped may send a fresh offer
    // before peer.joined fires (or instead of it). Be defensive and
    // accept the offer to set up the channel.
    unsubs.push(net.on("webrtc.signal", (m) => {
      if (m.from && !channels.has(m.from)) ensureChannel(m.from, false);
    }));
  } else if (role === "guest") {
    unsubs.push(net.on("guest.joined", (m) => {
      if (!m.hostPlayerId) return;
      hostPlayerId = m.hostPlayerId;
      // Symmetric to the host's peer.rejoined handling — on a reconnect
      // the relay re-fires guest.joined (with the same hostPlayerId).
      // The old peer connection may be a zombie, so drop it before
      // creating a fresh initiator channel that issues a new offer.
      if (channels.has(m.hostPlayerId)) removeChannel(m.hostPlayerId);
      ensureChannel(m.hostPlayerId, true);
    }));
    unsubs.push(net.on("host.resumed", () => {
      // After a host bounce the old DC is dead. The relay's host.resumed
      // carries no id, but the host's playerId is stable (derived from its
      // uuid), so rebuild against the one we stored from guest.joined. A
      // fresh initiator channel re-issues the offer the resumed host accepts
      // via its webrtc.signal handler. If we somehow never saw guest.joined,
      // there's nothing to rebuild — fall back to the WS path.
      for (const id of Array.from(channels.keys())) removeChannel(id);
      if (hostPlayerId) ensureChannel(hostPlayerId, true);
    }));
  } else {
    return null;
  }

  function canSendNow() {
    if (channels.size === 0) return false;
    for (const ch of channels.values()) {
      if (ch.getState() !== STATE.OPEN) return false;
    }
    return true;
  }

  // The interceptor returns true if it consumed the frame. Game ops only;
  // anything else falls through to WS. For unicast frames (`to` set) we
  // address that specific channel; otherwise we fan out to every open DC.
  function interceptor(frame) {
    if (closed) return false;
    const op = frame?.op;
    if (!GAME_OPS.has(op)) return false;
    if (!canSendNow()) return false;
    const payload = JSON.stringify(frame);
    if (role === "guest") {
      // Guest has exactly one channel: to the host.
      const ch = channels.values().next().value;
      return ch?.send(payload) === true;
    }
    // Host: broadcast game frame to every guest's DC.
    let sent = 0;
    for (const ch of channels.values()) {
      if (ch.send(payload)) sent++;
    }
    return sent > 0;
  }

  net.setSendInterceptor?.(interceptor);

  function close() {
    if (closed) return;
    closed = true;
    net.setSendInterceptor?.(null);
    for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
    unsubs.length = 0;
    for (const id of Array.from(channels.keys())) removeChannel(id);
  }

  return {
    close,
    canSendNow,
    getChannels: () => channels,
    _interceptor: interceptor, // exposed for tests
  };
}
