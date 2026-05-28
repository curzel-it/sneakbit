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

import { createWebrtcChannel, DEFAULT_STUN_SERVERS, STATE } from "./webrtcChannel.js?v=20260528g";

const GAME_OPS = new Set(["snapshot", "delta", "event", "input"]);

export function installWebrtcTransport({
  net,
  role,
  iceServers = DEFAULT_STUN_SERVERS,
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

  function ensureChannel(remotePlayerId, initiator) {
    if (!remotePlayerId) return null;
    if (channels.has(remotePlayerId)) return channels.get(remotePlayerId);
    const ch = createWebrtcChannel({
      net,
      remotePlayerId,
      initiator,
      iceServers,
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
          if (!msg.from) msg.from = remotePlayerId;
          net.emitOp?.(msg.op, msg);
        }
      },
      onClose: () => {
        channels.delete(remotePlayerId);
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
      // Symmetric to the host's peer.rejoined handling — on a reconnect
      // the relay re-fires guest.joined (with the same hostPlayerId).
      // The old peer connection may be a zombie, so drop it before
      // creating a fresh initiator channel that issues a new offer.
      if (channels.has(m.hostPlayerId)) removeChannel(m.hostPlayerId);
      ensureChannel(m.hostPlayerId, true);
    }));
    unsubs.push(net.on("host.resumed", () => {
      // After a host bounce the old DC is dead. Rebuild.
      for (const id of Array.from(channels.keys())) removeChannel(id);
      // ensureChannel needs the host's playerId. We don't store it here;
      // wait for the upstream `guest.joined` re-fire, or have the host
      // accept our offer to a known id on the next reconnect.
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
