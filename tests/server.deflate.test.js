// Per-message deflate (RFC 7692) negotiation + round-trip through the relay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server/index.js";
import { openWsClient } from "./helpers/wsTestClient.js";

async function withServer(fn) {
  const s = await startServer({ port: 0, host: "127.0.0.1", graceMs: 80 });
  try { await fn(s); } finally { await s.close(); }
}

test("client offers permessage-deflate, server accepts", async () => {
  await withServer(async ({ host, port }) => {
    const c = await openWsClient(host, port, "/ws", { deflate: true });
    assert.equal(c.negotiatedDeflate, true);
    c.send({ op: "hello", protocol: 1, uuid: "u-deflate-1", client: "test" });
    const w = await c.recv();
    assert.equal(w.op, "welcome");
    c.close();
  });
});

test("server still works when client does NOT offer deflate", async () => {
  await withServer(async ({ host, port }) => {
    const c = await openWsClient(host, port, "/ws");
    assert.equal(c.negotiatedDeflate, false);
    c.send({ op: "hello", protocol: 1, uuid: "u-deflate-2", client: "test" });
    const w = await c.recv();
    assert.equal(w.op, "welcome");
    c.close();
  });
});

test("deflate round-trip: host broadcast survives compression in both directions", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port, "/ws", { deflate: true });
    h.send({ op: "hello", protocol: 1, uuid: "u-dz-h", client: "test" });
    await h.recv();
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port, "/ws", { deflate: true });
    g.send({ op: "hello", protocol: 1, uuid: "u-dz-g", client: "test" });
    await g.recv();
    g.send({ op: "guest.join", code: opened.code });
    await g.recv();
    await h.recv();

    // A delta with lots of repetition — that's where deflate shines, and
    // it exercises the strip/append trailer logic.
    const players = [];
    for (let i = 0; i < 16; i++) {
      players.push({
        playerId: `p_${i}`,
        x: 12, y: 7, tileX: 12, tileY: 7,
        direction: "right", hp: 100,
      });
    }
    h.send({ op: "delta", t: 1, zoneId: 1001, players, entities: [] });
    const got = await g.recv();
    assert.equal(got.op, "delta");
    assert.equal(got.players.length, 16);
    assert.equal(got.players[7].playerId, "p_7");

    h.close(); g.close();
  });
});

test("deflate + plaintext clients can coexist in the same session", async () => {
  await withServer(async ({ host, port }) => {
    const h = await openWsClient(host, port, "/ws", { deflate: true });
    h.send({ op: "hello", protocol: 1, uuid: "u-mix-h", client: "test" });
    await h.recv();
    h.send({ op: "host.open" });
    const opened = await h.recv();

    const g = await openWsClient(host, port, "/ws"); // no deflate
    assert.equal(g.negotiatedDeflate, false);
    g.send({ op: "hello", protocol: 1, uuid: "u-mix-g", client: "test" });
    await g.recv();
    g.send({ op: "guest.join", code: opened.code });
    await g.recv();
    await h.recv();

    h.send({ op: "delta", t: 1, zoneId: 1001, players: [{ playerId: "x", x: 1, y: 2 }], entities: [] });
    const got = await g.recv();
    assert.equal(got.op, "delta");
    assert.equal(got.players[0].playerId, "x");

    h.close(); g.close();
  });
});
