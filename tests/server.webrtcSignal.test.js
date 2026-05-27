// Relay forwards opaque webrtc.signal frames host ↔ named guest. The relay
// doesn't parse SDP or candidates; it just routes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server/index.js";
import { openWsClient } from "./helpers/wsTestClient.js";

async function withServer(fn) {
  const s = await startServer({ port: 0, host: "127.0.0.1", graceMs: 80 });
  try { await fn(s); } finally { await s.close(); }
}

async function hello(c, uuid) {
  c.send({ op: "hello", protocol: 1, uuid, client: "test" });
  return c.recv();
}

test("guest webrtc.signal is forwarded to host with from=guest playerId", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    const hWelcome = await hello(h, "u-rtc-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-rtc-g");
    g.send({ op: "guest.join", code: opened.code });
    const joined = await g.recv();
    await h.recv(); // peer.joined

    g.send({ op: "webrtc.signal", payload: { kind: "offer", sdp: "v=0..." } });
    const fwd = await h.recv();
    assert.equal(fwd.op, "webrtc.signal");
    assert.equal(fwd.from, joined.selfPlayerId);
    assert.equal(fwd.to, hWelcome.playerId);
    assert.equal(fwd.payload.kind, "offer");
    assert.equal(fwd.payload.sdp, "v=0...");

    h.close(); g.close();
  });
});

test("host webrtc.signal is forwarded to the addressed guest only", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    const hWelcome = await hello(h, "u-rtc2-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g1 = await openWsClient(host, port);
    await hello(g1, "u-aaa-rtc2-g1");
    g1.send({ op: "guest.join", code: opened.code });
    const j1 = await g1.recv();
    await h.recv();

    const g2 = await openWsClient(host, port);
    await hello(g2, "u-bbb-rtc2-g2");
    g2.send({ op: "guest.join", code: opened.code });
    const j2 = await g2.recv();
    await h.recv();
    await g1.recv(); // peer.joined to g1 about g2

    h.send({ op: "webrtc.signal", to: j2.selfPlayerId, payload: { kind: "answer", sdp: "v=0..." } });
    const got = await g2.recv();
    assert.equal(got.op, "webrtc.signal");
    assert.equal(got.from, hWelcome.playerId);
    assert.equal(got.to, j2.selfPlayerId);
    assert.equal(got.payload.kind, "answer");

    // g1 must not get it.
    await assert.rejects(g1.recv(200), /timeout/);

    h.close(); g1.close(); g2.close();
  });
});

test("host webrtc.signal with bogus 'to' is dropped silently", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-rtc3-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-rtc3-g");
    g.send({ op: "guest.join", code: opened.code });
    await g.recv();
    await h.recv();

    h.send({ op: "webrtc.signal", to: "p_doesnotexist", payload: { kind: "offer" } });
    await assert.rejects(g.recv(200), /timeout/);

    h.close(); g.close();
  });
});
