// One RTCPeerConnection + one DataChannel between us and a specific peer.
//
// Topology: the guest is always the initiator. It creates the data channel
// and ships the offer; the host listens for offers and answers in kind.
// Once `open`, app code calls `send(str)` and receives via `onMessage`. The
// signaling protocol — offer/answer/ICE candidates — rides on the existing
// WS via `webrtc.signal` frames the relay forwards between host and a
// named peer. See docs/online-coop.md §"WebRTC upgrade path".
//
// We try a small handful of free public STUN servers by default. TURN
// credentials are injected via `iceServers`; the credentials endpoint
// lives next to the relay (see turn-credentials.js).

const SIGNAL_OP = "webrtc.signal";

export const DEFAULT_STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export const STATE = Object.freeze({
  CONNECTING: "connecting",
  OPEN: "open",
  CLOSED: "closed",
  FAILED: "failed",
});

export function createWebrtcChannel({
  net,
  remotePlayerId,
  initiator,
  iceServers = DEFAULT_STUN_SERVERS,
  // Optional async () => iceServers[] returning fresh creds for an ICE
  // restart. TURN creds expire mid-session, so a restart that reuses the
  // boot-time creds would fall back to nothing. Omitted in tests / STUN-only.
  refreshIceServers = null,
  // How many ICE restarts to attempt before declaring the channel dead.
  maxIceRestarts = 1,
  // Grace before restarting on a `disconnected` state — it's often a
  // transient blip that recovers on its own, so don't spend a restart
  // immediately. `failed` is terminal for the candidate pair → restart now.
  disconnectGraceMs = 3000,
  // Injectable for tests. In a browser these resolve to the globals.
  RTCPeerConnectionCtor,
  RTCSessionDescriptionCtor,
  RTCIceCandidateCtor,
  onOpen,
  onMessage,
  onClose,
  onStateChange,
} = {}) {
  const PC = RTCPeerConnectionCtor
    || (typeof RTCPeerConnection !== "undefined" ? RTCPeerConnection : null);
  const SDP = RTCSessionDescriptionCtor
    || (typeof RTCSessionDescription !== "undefined" ? RTCSessionDescription : null);
  const ICE = RTCIceCandidateCtor
    || (typeof RTCIceCandidate !== "undefined" ? RTCIceCandidate : null);

  if (!PC) {
    // No WebRTC in this environment. Caller will fall back to WS-only.
    return null;
  }
  if (!net || !remotePlayerId) {
    throw new Error("createWebrtcChannel: net + remotePlayerId required");
  }

  let pc = null;
  let dc = null;
  let state = STATE.CONNECTING;
  // ICE candidates can stream in before setRemoteDescription completes.
  // Stash them and replay once we have a remote description.
  let remoteDescriptionSet = false;
  const pendingIce = [];
  let closed = false;
  let unsubSignal = null;
  let iceRestartAttempts = 0;
  let disconnectTimer = null;

  function setState(next) {
    if (state === next) return;
    state = next;
    try { onStateChange?.(next); } catch (e) { console.error("webrtc onStateChange", e); }
  }

  function sendSignal(kind, body) {
    if (!net.send) return;
    net.send({
      op: SIGNAL_OP,
      to: remotePlayerId,
      payload: { kind, ...body },
    });
  }

  function attachDataChannel(channel) {
    dc = channel;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => { setState(STATE.OPEN); try { onOpen?.(); } catch (e) { console.error(e); } };
    dc.onmessage = (e) => {
      try { onMessage?.(e.data); }
      catch (err) { console.error("webrtc onMessage handler", err); }
    };
    dc.onclose = () => {
      if (state !== STATE.FAILED) setState(STATE.CLOSED);
      try { onClose?.(); } catch (e) { console.error(e); }
    };
    dc.onerror = (e) => console.error("webrtc dc error", e);
  }

  async function start() {
    pc = new PC({ iceServers });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal("ice", { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        // Recovered (possibly via a restart). Clear any pending grace timer
        // and refresh the restart budget for a future, independent blip.
        clearDisconnectTimer();
        iceRestartAttempts = 0;
        return;
      }
      if (s === "closed") { finishDead(); return; }
      if (s === "failed") { clearDisconnectTimer(); tryIceRestart(); return; }
      if (s === "disconnected") {
        // Often transient — give it a beat to self-heal before restarting.
        if (disconnectTimer || closed) return;
        disconnectTimer = setTimeout(() => {
          disconnectTimer = null;
          if (closed) return;
          const cur = pc?.connectionState;
          if (cur === "disconnected" || cur === "failed") tryIceRestart();
        }, disconnectGraceMs);
      }
    };

    pc.ondatachannel = (e) => attachDataChannel(e.channel);

    if (initiator) {
      // Guest opens the channel; host receives it via ondatachannel.
      attachDataChannel(pc.createDataChannel("sneakbit", { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal("offer", { sdp: offer.sdp });
    }

    // Listen for signaling. The relay stamps `from` so we can ignore
    // frames addressed to a different peer of ours.
    unsubSignal = net.on(SIGNAL_OP, async (msg) => {
      if (closed) return;
      if (msg.from !== remotePlayerId) return;
      const p = msg.payload || {};
      try {
        if (p.kind === "offer") {
          await pc.setRemoteDescription(new SDP({ type: "offer", sdp: p.sdp }));
          remoteDescriptionSet = true;
          flushPendingIce();
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          sendSignal("answer", { sdp: ans.sdp });
        } else if (p.kind === "answer") {
          await pc.setRemoteDescription(new SDP({ type: "answer", sdp: p.sdp }));
          remoteDescriptionSet = true;
          flushPendingIce();
        } else if (p.kind === "ice") {
          if (!remoteDescriptionSet) {
            pendingIce.push(p.candidate);
          } else if (p.candidate) {
            try { await pc.addIceCandidate(new ICE(p.candidate)); }
            catch (err) { console.warn("webrtc addIceCandidate", err); }
          }
        }
      } catch (err) {
        console.error("webrtc signal handler", err);
        setState(STATE.FAILED);
      }
    });
  }

  async function flushPendingIce() {
    while (pendingIce.length) {
      const c = pendingIce.shift();
      if (!c) continue;
      try { await pc.addIceCandidate(new ICE(c)); }
      catch (err) { console.warn("webrtc addIceCandidate (flush)", err); }
    }
  }

  function clearDisconnectTimer() {
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
  }

  // Transition the channel to its terminal state. A connection that never
  // opened failed outright; one that was OPEN merely closed.
  function finishDead() {
    clearDisconnectTimer();
    if (state === STATE.OPEN) setState(STATE.CLOSED);
    else if (state !== STATE.CLOSED) setState(STATE.FAILED);
  }

  // Attempt one ICE restart before giving up. The guest (initiator) drives
  // it by re-offering with iceRestart; the host (answerer) flags its side
  // and accepts the guest's fresh offer via the existing signal handler.
  // Both refresh TURN creds first — a restart is the exact moment expired
  // creds bite, so reusing the boot-time ones would defeat the fallback.
  async function tryIceRestart() {
    if (closed || !pc) return;
    if (iceRestartAttempts >= maxIceRestarts) { finishDead(); return; }
    iceRestartAttempts++;
    if (refreshIceServers && pc.setConfiguration) {
      try {
        const fresh = await refreshIceServers();
        if (Array.isArray(fresh) && fresh.length) pc.setConfiguration({ iceServers: fresh });
      } catch { /* keep current creds */ }
    }
    if (closed) return;
    try {
      if (initiator) {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        sendSignal("offer", { sdp: offer.sdp });
      } else {
        pc.restartIce?.();
      }
    } catch (err) {
      console.error("webrtc ice restart", err);
      finishDead();
    }
  }

  function send(s) {
    if (!dc || dc.readyState !== "open") return false;
    try { dc.send(s); return true; }
    catch (e) { console.warn("webrtc send", e); return false; }
  }

  function close() {
    if (closed) return;
    closed = true;
    clearDisconnectTimer();
    try { unsubSignal?.(); } catch { /* ignore */ }
    try { dc?.close(); } catch { /* ignore */ }
    try { pc?.close(); } catch { /* ignore */ }
    if (state !== STATE.CLOSED && state !== STATE.FAILED) setState(STATE.CLOSED);
  }

  start().catch((err) => {
    console.error("webrtc start", err);
    setState(STATE.FAILED);
  });

  return {
    send,
    close,
    getState: () => state,
    getRemotePlayerId: () => remotePlayerId,
    // Test-only helpers.
    _pc: () => pc,
    _dc: () => dc,
  };
}
