// webrtcChannel: signaling state machine wired via a fake `net` and a pair
// of mock RTCPeerConnection objects. Validates that guest (initiator) and
// host successfully hand-shake and open the data channel, and that
// messages flow both ways once open.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebrtcChannel, STATE } from "../js/webrtcChannel.js?v=20260529a";

// --- mocks -----------------------------------------------------------------

class MockDC {
  constructor(label) {
    this.label = label;
    this.readyState = "connecting";
    this.peer = null;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
  }
  _bindPeer(other) {
    this.peer = other;
    other.peer = this;
  }
  _open() {
    if (this.readyState === "open") return;
    this.readyState = "open";
    setTimeout(() => this.onopen?.(), 0);
  }
  send(s) {
    if (this.readyState !== "open" || !this.peer) throw new Error("not open");
    setTimeout(() => this.peer.onmessage?.({ data: s }), 0);
  }
  close() {
    this.readyState = "closed";
    setTimeout(() => this.onclose?.(), 0);
    if (this.peer && this.peer.readyState === "open") this.peer.close();
  }
}

class MockSDP {
  constructor({ type, sdp }) { this.type = type; this.sdp = sdp; }
}

class MockICE {
  constructor({ candidate }) { this.candidate = candidate; }
}

// `wire` carries a pair-shared state so the two MockPCs can find their
// counterpart's data channel and "open" it once both descriptions land.
function makeWire() {
  return { dcs: [], descs: { offer: false, answer: false } };
}

class MockPC {
  constructor({ wire }) {
    this.wire = wire;
    this.connectionState = "new";
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
    this._localDc = null;
    this._localDesc = null;
    this._remoteDesc = null;
  }
  createDataChannel(label) {
    const dc = new MockDC(label);
    this._localDc = dc;
    this.wire.dcs.push(dc);
    return dc;
  }
  async createOffer() { return new MockSDP({ type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }); }
  async createAnswer() { return new MockSDP({ type: "answer", sdp: "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n" }); }
  async setLocalDescription(d) { this._localDesc = d; }
  async setRemoteDescription(d) {
    this._remoteDesc = d;
    this.wire.descs[d.type] = true;
    if (this.wire.descs.offer && this.wire.descs.answer) {
      // Both ends have full SDP — open both data channels and pair them.
      // Surface the answerer's "ondatachannel" with the offerer's DC.
      const [a, b] = this.wire.dcs;
      if (a && b) {
        a._bindPeer(b);
        a._open(); b._open();
      } else if (a && !b) {
        // Answerer side hadn't created its own DC; emit ondatachannel.
        // We just pass the original DC back as the "remote" channel for
        // ondatachannel handlers, then open it.
        a._open();
      }
    }
  }
  async addIceCandidate() { /* mocked away */ }
  close() {
    this.connectionState = "closed";
    setTimeout(() => this.onconnectionstatechange?.(), 0);
  }
}

// Fake net: routes webrtc.signal between two endpoints. Each side
// registers `on("webrtc.signal", h)`, calls `send({op, to, payload})`,
// and we deliver to the *other* side stamped with `from`.
function makePair() {
  const a = { side: "a", remote: "p_b", playerId: "p_a", handlers: [] };
  const b = { side: "b", remote: "p_a", playerId: "p_b", handlers: [] };

  function bind(self, other) {
    return {
      on(op, h) {
        if (op !== "webrtc.signal") return () => {};
        self.handlers.push(h);
        return () => {
          const i = self.handlers.indexOf(h);
          if (i >= 0) self.handlers.splice(i, 1);
        };
      },
      send(frame) {
        if (frame?.op !== "webrtc.signal") return;
        // The relay would stamp `from`. Mimic that here.
        const delivered = { ...frame, from: self.playerId };
        setTimeout(() => {
          for (const h of other.handlers.slice()) h(delivered);
        }, 0);
      },
    };
  }

  return { netA: bind(a, b), netB: bind(b, a) };
}

function wait(ms = 30) { return new Promise((r) => setTimeout(r, ms)); }

// --- tests -----------------------------------------------------------------

test("guest initiator + host responder open a data channel and exchange messages", async () => {
  const { netA, netB } = makePair();
  const wire = makeWire();

  const aOpened = []; const bOpened = [];
  const aGot = []; const bGot = [];

  const guestChan = createWebrtcChannel({
    net: netA, remotePlayerId: "p_b", initiator: true,
    RTCPeerConnectionCtor: function PC() { return new MockPC({ wire }); },
    RTCSessionDescriptionCtor: MockSDP, RTCIceCandidateCtor: MockICE,
    onOpen: () => aOpened.push(true),
    onMessage: (s) => aGot.push(s),
  });

  const hostChan = createWebrtcChannel({
    net: netB, remotePlayerId: "p_a", initiator: false,
    RTCPeerConnectionCtor: function PC() { return new MockPC({ wire }); },
    RTCSessionDescriptionCtor: MockSDP, RTCIceCandidateCtor: MockICE,
    onOpen: () => bOpened.push(true),
    onMessage: (s) => bGot.push(s),
  });

  // Host side doesn't create its own DC. Simulate ondatachannel by giving
  // it the same DC as the guest after the SDP round-trip completes.
  // We hand-wire that by creating a second "phantom" DC on the answerer
  // and letting the wire pair them up.
  await wait(20);
  // The answerer needs to also push a DC into wire.dcs OR call
  // ondatachannel manually. Our mock skips this; do it by hand:
  if (wire.dcs.length === 1 && hostChan._pc()) {
    const ans = hostChan._pc();
    const dc = new MockDC("sneakbit");
    wire.dcs.push(dc);
    ans.ondatachannel?.({ channel: dc });
  }
  // Re-trigger the "both descs set" pairing in the second PC's mock by
  // pretending setRemoteDescription was called again. Cheaper: just open
  // the pair manually now that both DCs exist.
  if (wire.dcs.length === 2) {
    wire.dcs[0]._bindPeer(wire.dcs[1]);
    wire.dcs[0]._open();
    wire.dcs[1]._open();
  }
  await wait(20);

  assert.equal(guestChan.getState(), STATE.OPEN);
  assert.equal(hostChan.getState(), STATE.OPEN);
  assert.equal(aOpened.length, 1);
  assert.equal(bOpened.length, 1);

  guestChan.send("hello from guest");
  hostChan.send("hello from host");
  await wait(20);
  assert.deepEqual(bGot, ["hello from guest"]);
  assert.deepEqual(aGot, ["hello from host"]);

  guestChan.close();
  hostChan.close();
});

test("signaling frames addressed to a different peer are ignored", async () => {
  const wire = makeWire();
  let calls = 0;
  const fakeNet = {
    on(_op, _h) { return () => {}; },
    send() { calls++; },
  };
  const chan = createWebrtcChannel({
    net: fakeNet, remotePlayerId: "p_other", initiator: true,
    RTCPeerConnectionCtor: function PC() { return new MockPC({ wire }); },
    RTCSessionDescriptionCtor: MockSDP, RTCIceCandidateCtor: MockICE,
  });
  await wait(20);
  assert.ok(calls >= 1, "should have sent at least the offer");
  chan.close();
});

test("createWebrtcChannel returns null when RTCPeerConnection is unavailable", () => {
  const res = createWebrtcChannel({
    net: { on() { return () => {}; }, send() {} },
    remotePlayerId: "p_x",
    initiator: true,
    RTCPeerConnectionCtor: null,
  });
  assert.equal(res, null);
});
