// webrtcTransport: send-side interceptor routes game traffic over open
// DataChannels and falls back to WS when channels aren't ready.
//
// We don't speak real WebRTC here — we feed in a mock RTCPeerConnection
// pair (same one used by webrtcChannel.test.js) and watch the interceptor
// flip from "fall through" to "consumed" once the DCs open.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installWebrtcTransport } from "../js/webrtcTransport.js?v=20260528g";

class MockDC {
  constructor(label) {
    this.label = label;
    this.readyState = "connecting";
    this.peer = null;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.sent = [];
  }
  _bindPeer(other) { this.peer = other; other.peer = this; }
  _open() {
    if (this.readyState === "open") return;
    this.readyState = "open";
    setTimeout(() => this.onopen?.(), 0);
  }
  send(s) {
    this.sent.push(s);
    if (this.peer) setTimeout(() => this.peer.onmessage?.({ data: s }), 0);
  }
  close() {
    this.readyState = "closed";
    setTimeout(() => this.onclose?.(), 0);
  }
}

class MockSDP { constructor({ type, sdp }) { this.type = type; this.sdp = sdp; } }
class MockICE { constructor({ candidate }) { this.candidate = candidate; } }

// Wire-shared state so the two MockPCs in a pair can locate each other's
// channel and "open" them once both descriptions have landed.
function makeWire() { return { dcs: [], descs: { offer: false, answer: false } }; }

class MockPC {
  constructor({ wire }) {
    this.wire = wire;
    this.connectionState = "new";
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
    this._localDesc = null;
    this._remoteDesc = null;
  }
  createDataChannel(label) {
    const dc = new MockDC(label);
    this.wire.dcs.push(dc);
    return dc;
  }
  async createOffer() { return new MockSDP({ type: "offer", sdp: "v=0\r\n" }); }
  async createAnswer() { return new MockSDP({ type: "answer", sdp: "v=0\r\n" }); }
  async setLocalDescription(d) { this._localDesc = d; }
  async setRemoteDescription(d) {
    this._remoteDesc = d;
    // Receiving an offer means we're the answerer — synthesize the
    // remote-mirrored DataChannel and surface it via ondatachannel.
    if (d.type === "offer") {
      const dc = new MockDC("sneakbit");
      this.wire.dcs.push(dc);
      setTimeout(() => this.ondatachannel?.({ channel: dc }), 0);
    }
    this.wire.descs[d.type] = true;
    if (this.wire.descs.offer && this.wire.descs.answer) {
      const [a, b] = this.wire.dcs;
      if (a && b) { a._bindPeer(b); a._open(); b._open(); }
    }
  }
  async addIceCandidate() { /* no-op */ }
  close() {
    this.connectionState = "closed";
    setTimeout(() => this.onconnectionstatechange?.(), 0);
  }
}

// Minimal net stub: tracks handlers per op and lets us deliver frames.
function makeNet({ playerId = "p_self" } = {}) {
  const handlers = new Map();
  const sent = [];
  let interceptor = null;
  return {
    playerId,
    sent,
    on(op, h) {
      let arr = handlers.get(op);
      if (!arr) { arr = []; handlers.set(op, arr); }
      arr.push(h);
      return () => {
        const i = arr.indexOf(h);
        if (i >= 0) arr.splice(i, 1);
      };
    },
    deliver(op, msg) {
      for (const h of (handlers.get(op) || []).slice()) h(msg);
    },
    send(frame) {
      if (interceptor && interceptor(frame) === true) return true;
      sent.push(frame);
      return true;
    },
    setSendInterceptor(fn) { interceptor = fn; },
    emitOp(op, msg) {
      for (const h of (handlers.get(op) || []).slice()) h(msg);
    },
    isConnected: () => true,
  };
}

// Pair two nets so webrtc.signal flows between them like the relay would.
function pairNets(netHost, netGuest) {
  const realHostSend = netHost.send.bind(netHost);
  const realGuestSend = netGuest.send.bind(netGuest);
  netHost.send = (frame) => {
    if (frame?.op === "webrtc.signal") {
      setTimeout(() => netGuest.deliver("webrtc.signal", { ...frame, from: netHost.playerId }), 0);
      return true;
    }
    return realHostSend(frame);
  };
  netGuest.send = (frame) => {
    if (frame?.op === "webrtc.signal") {
      setTimeout(() => netHost.deliver("webrtc.signal", { ...frame, from: netGuest.playerId }), 0);
      return true;
    }
    return realGuestSend(frame);
  };
}

function wait(ms = 30) { return new Promise((r) => setTimeout(r, ms)); }

test("guest transport: interceptor falls through to WS until DC opens", async () => {
  const wire = makeWire();
  const guestNet = makeNet({ playerId: "p_guest" });
  const hostNet = makeNet({ playerId: "p_host" });
  pairNets(hostNet, guestNet);

  // Wrap in a real function so `new PC(...)` works (arrow fns can't be new'd).
  function PC() { return new MockPC({ wire }); }

  const transport = installWebrtcTransport({
    net: guestNet, role: "guest",
    RTCPeerConnectionCtor: PC, RTCSessionDescriptionCtor: MockSDP, RTCIceCandidateCtor: MockICE,
  });
  installWebrtcTransport({
    net: hostNet, role: "host",
    RTCPeerConnectionCtor: PC, RTCSessionDescriptionCtor: MockSDP, RTCIceCandidateCtor: MockICE,
  });

  // Guest learns the host id via guest.joined → channel gets created.
  guestNet.deliver("guest.joined", { hostPlayerId: "p_host" });
  // Host learns about the guest via peer.joined → channel for that guest.
  hostNet.deliver("peer.joined", { playerId: "p_guest" });

  // Before the data channel opens, an `input` frame should fall through to WS.
  const sentEarly = guestNet.send({ op: "input", seq: 1, intent: "moveUp" });
  assert.equal(sentEarly, true);
  assert.equal(guestNet.sent.length, 1, "early input goes via WS path");

  // SDP round-trip + the mock's auto-pairing.
  await wait(40);

  // Now interceptor should consume the input frame.
  guestNet.sent.length = 0;
  const sentLate = guestNet.send({ op: "input", seq: 2, intent: "moveDown" });
  assert.equal(sentLate, true);
  assert.equal(guestNet.sent.length, 0, "input went via DataChannel, not WS");
  assert.equal(wire.dcs[0].sent.length, 1, "DC saw the input");

  // Non-game ops still go via WS.
  guestNet.send({ op: "ping" });
  assert.equal(guestNet.sent.length, 1);
  assert.equal(guestNet.sent[0].op, "ping");
});

test("host transport with no peers does not consume game frames", async () => {
  const wire = makeWire();
  const hostNet = makeNet({ playerId: "p_host" });
  function PC2() { return new MockPC({ wire }); }
  installWebrtcTransport({
    net: hostNet, role: "host",
    RTCPeerConnectionCtor: PC2,
    RTCSessionDescriptionCtor: MockSDP, RTCIceCandidateCtor: MockICE,
  });
  // No peer.joined yet.
  const sent = hostNet.send({ op: "delta", t: 1, zoneId: 1001, players: [], entities: [] });
  assert.equal(sent, true);
  assert.equal(hostNet.sent.length, 1, "delta fell through to WS — no DC available");
  assert.equal(hostNet.sent[0].op, "delta");
});

test("installWebrtcTransport returns null when RTCPeerConnection is missing", () => {
  const net = makeNet();
  const t = installWebrtcTransport({ net, role: "guest" }); // no PC ctor and no global
  assert.equal(t, null);
});
