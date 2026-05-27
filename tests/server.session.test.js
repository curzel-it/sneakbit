// End-to-end tests for the relay: handshake, host/guest pairing, frame
// fan-out, disconnect grace, uuid conflict.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server/index.js";
import { openWsClient } from "./helpers/wsTestClient.js";

const GRACE = 80;

async function withServer(fn) {
  const s = await startServer({ port: 0, host: "127.0.0.1", graceMs: GRACE });
  try { await fn(s); } finally { await s.close(); }
}

async function hello(c, uuid) {
  c.send({ op: "hello", protocol: 1, uuid, client: "test" });
  const w = await c.recv();
  assert.equal(w.op, "welcome");
  return w;
}

test("hello -> welcome", async () => {
  await withServer(async ({ host, port }) => {
    const c = await openWsClient(host, port);
    const w = await hello(c, "11111111-1111-1111-1111-111111111111");
    assert.equal(w.protocol, 1);
    assert.match(w.playerId, /^p_/);
    c.close();
  });
});

test("obsolete protocol closes with 4001", async () => {
  await withServer(async ({ host, port }) => {
    const c = await openWsClient(host, port);
    c.send({ op: "hello", protocol: 0, uuid: "u-obsolete" });
    const m = await c.recv();
    assert.equal(m.op, "obsolete");
    const code = await c.waitClose();
    assert.equal(code, 4001);
  });
});

test("host.open returns a 5-char alphanumeric code", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-host-1");
    h.send({ op: "host.open" });
    const opened = await h.recv();
    assert.equal(opened.op, "host.opened");
    assert.match(opened.code, /^[A-Z0-9]{5}$/);
    assert.equal(opened.maxGuests, 3);
    h.close();
  });
});

test("guest.join pairs with host and emits peer.joined", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-h2");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-g2");
    g.send({ op: "guest.join", code: opened.code });
    const joined = await g.recv();
    assert.equal(joined.op, "guest.joined");
    assert.equal(joined.sessionId, opened.sessionId);
    assert.equal(joined.slot, 2);
    assert.match(joined.hostPlayerId, /^p_/);

    const peer = await h.recv();
    assert.equal(peer.op, "peer.joined");
    assert.equal(peer.slot, 2);
    assert.match(peer.playerId, /^p_/);

    h.close(); g.close();
  });
});

test("guest.join fails for unknown code", async () => {
  await withServer(async ({ host, port }) => {
    const g = await openWsClient(host, port);
    await hello(g, "u-bad");
    g.send({ op: "guest.join", code: "ZZZZZ" });
    const m = await g.recv();
    assert.equal(m.op, "guest.joinFailed");
    assert.equal(m.reason, "not_found");
    g.close();
  });
});

test("guest.join fills slots 2/3/4, fourth guest is rejected as full", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-full-host");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const guests = [];
    for (let i = 0; i < 3; i++) {
      const g = await openWsClient(host, port);
      await hello(g, `u-g-${i}`);
      g.send({ op: "guest.join", code: opened.code });
      const joined = await g.recv();
      assert.equal(joined.op, "guest.joined");
      assert.equal(joined.slot, 2 + i);
      // Drain any peer.joined / peer.rejoined fan-out frames so the
      // host channel's read pointer isn't sitting on a stale one for
      // the next iteration.
      await h.recv();
      // Plus N-1 peer.joined fan-outs to the earlier guests.
      for (let j = 0; j < i; j++) await guests[j].recv();
      guests.push(g);
    }

    const overflow = await openWsClient(host, port);
    await hello(overflow, "u-g-overflow");
    overflow.send({ op: "guest.join", code: opened.code });
    const m = await overflow.recv();
    assert.equal(m.op, "guest.joinFailed");
    assert.equal(m.reason, "full");

    h.close();
    for (const g of guests) g.close();
    overflow.close();
  });
});

test("guest input is forwarded to host with from=playerId", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-input-host");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-input-guest");
    g.send({ op: "guest.join", code: opened.code });
    const joined = await g.recv();
    await h.recv();

    g.send({ op: "input", seq: 17, intent: "moveDown" });
    const fwd = await h.recv();
    assert.equal(fwd.op, "input");
    assert.equal(fwd.seq, 17);
    assert.equal(fwd.intent, "moveDown");
    assert.equal(fwd.from, joined.selfPlayerId);

    h.close(); g.close();
  });
});

test("host delta fans out to every guest", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-bcast-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g1 = await openWsClient(host, port);
    await hello(g1, "u-bcast-g1");
    g1.send({ op: "guest.join", code: opened.code });
    await g1.recv(); await h.recv();

    h.send({ op: "delta", t: 99, zoneId: 1001, players: [], entities: [], lastSeq: {} });
    const a = await g1.recv();
    assert.equal(a.op, "delta"); assert.equal(a.t, 99);

    h.close(); g1.close();
  });
});

test("guest cannot send snapshot/delta", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-auth-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-auth-g");
    g.send({ op: "guest.join", code: opened.code });
    await g.recv(); await h.recv();

    g.send({ op: "delta", t: 1, zoneId: 1001, players: [], entities: [] });
    await assert.rejects(h.recv(300), /timeout/);

    h.close(); g.close();
  });
});

test("guest disconnect: host gets peer.ghosted, then peer.left after grace", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-disco-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-disco-g");
    g.send({ op: "guest.join", code: opened.code });
    await g.recv(); await h.recv();

    g.close();
    const ghosted = await h.recv();
    assert.equal(ghosted.op, "peer.ghosted");

    const left = await h.recv(GRACE + 500);
    assert.equal(left.op, "peer.left");
    assert.equal(left.reason, "timeout");

    h.close();
  });
});

test("slot reassignment: A drops, B joins slot 3, A reconnects keeps slot 2", async () => {
  // Sanity check the slot-allocation rule documented under "Slot
  // reassignment on guest reconnect" in host-authoritative-server.md:
  // a ghosted guest still owns their slot during the grace window, so
  // the next arrival takes the lowest *free* slot. When the original
  // returns within grace, addOrResumeGuest finds the existing entry by
  // UUID and rebinds without shifting anyone.
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-slot-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const a = await openWsClient(host, port);
    await hello(a, "u-slot-a");
    a.send({ op: "guest.join", code: opened.code });
    const aJoined = await a.recv();
    assert.equal(aJoined.slot, 2);
    await h.recv(); // peer.joined for A

    a.close();
    const ghosted = await h.recv();
    assert.equal(ghosted.op, "peer.ghosted");

    const b = await openWsClient(host, port);
    await hello(b, "u-slot-b");
    b.send({ op: "guest.join", code: opened.code });
    const bJoined = await b.recv();
    // A is still in session.guests during grace, so B takes slot 3
    // (next free) rather than overwriting A's slot 2.
    assert.equal(bJoined.slot, 3);
    await h.recv(); // peer.joined for B

    const a2 = await openWsClient(host, port);
    await hello(a2, "u-slot-a");
    a2.send({ op: "guest.join", code: opened.code });
    const aResume = await a2.recv();
    // Same UUID → addOrResumeGuest returns the existing guest, slot 2
    // is preserved.
    assert.equal(aResume.slot, 2);
    const rej = await h.recv();
    assert.equal(rej.op, "peer.rejoined");
    // B should also be notified that A came back.
    const rejToB = await b.recv();
    assert.equal(rejToB.op, "peer.rejoined");

    h.close(); a2.close(); b.close();
  });
});

test("guest reconnect within grace: host gets peer.rejoined", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-rejoin-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-rejoin-g");
    g.send({ op: "guest.join", code: opened.code });
    await g.recv(); await h.recv();

    g.close();
    const ghosted = await h.recv();
    assert.equal(ghosted.op, "peer.ghosted");

    const g2 = await openWsClient(host, port);
    await hello(g2, "u-rejoin-g");
    g2.send({ op: "guest.join", code: opened.code });
    const joined = await g2.recv();
    assert.equal(joined.op, "guest.joined");
    assert.equal(joined.slot, 2);

    const rej = await h.recv();
    assert.equal(rej.op, "peer.rejoined");

    h.close(); g2.close();
  });
});

test("host disconnect: guests get host.ghosted, then session.closed after grace", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-hgone-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-hgone-g");
    g.send({ op: "guest.join", code: opened.code });
    await g.recv(); await h.recv();

    h.close();
    const ghosted = await g.recv();
    assert.equal(ghosted.op, "host.ghosted");
    const closed = await g.recv(GRACE + 500);
    assert.equal(closed.op, "session.closed");
    assert.equal(closed.reason, "host_timeout");
  });
});

test("host reconnect within grace resumes the same session", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-hres-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-hres-g");
    g.send({ op: "guest.join", code: opened.code });
    await g.recv(); await h.recv();

    h.close();
    const ghosted = await g.recv();
    assert.equal(ghosted.op, "host.ghosted");

    const h2 = await openWsClient(host, port);
    await hello(h2, "u-hres-h");
    h2.send({ op: "host.open" });
    const opened2 = await h2.recv();
    assert.equal(opened2.op, "host.opened");
    assert.equal(opened2.code, opened.code);
    assert.equal(opened2.resumed, true);

    const resumed = await g.recv();
    assert.equal(resumed.op, "host.resumed");

    h2.close(); g.close();
  });
});

test("host.close ends session for all guests immediately", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port);
    await hello(h, "u-close-h");
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port);
    await hello(g, "u-close-g");
    g.send({ op: "guest.join", code: opened.code });
    await g.recv(); await h.recv();

    h.send({ op: "host.close" });
    const closed = await g.recv();
    assert.equal(closed.op, "session.closed");
    assert.equal(closed.reason, "host_quit");

    h.close();
  });
});

test("uuid conflict closes the older connection with 4003", async () => {
  await withServer(async ({ host, port }) => {
    const a = await openWsClient(host, port);
    await hello(a, "u-dup");
    const b = await openWsClient(host, port);
    await hello(b, "u-dup");
    const code = await a.waitClose();
    assert.equal(code, 4003);
    b.close();
  });
});

test("ping -> pong", async () => {
  await withServer(async ({ host, port }) => {
    const c = await openWsClient(host, port);
    await hello(c, "u-ping");
    c.send({ op: "ping" });
    const m = await c.recv();
    assert.equal(m.op, "pong");
    c.close();
  });
});
