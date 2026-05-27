// Per-message deflate (RFC 7692) negotiation + round-trip through the relay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { connect as netConnect } from "node:net";
import { randomBytes, createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync, constants as zlibConstants } from "node:zlib";
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

// Real browsers send permessage-deflate frames produced with Z_SYNC_FLUSH:
// the stream does NOT end with a BFINAL block, only with the `00 00 ff ff`
// marker which the sender strips before framing. The server must therefore
// pass `finishFlush: Z_SYNC_FLUSH` to inflateRawSync — without it, inflate
// throws "unexpected end of file" and the server closes 1007. This bit us
// in production: the symmetric Node tests above didn't catch it because
// both sides were using `flush:` (which deflateRawSync silently ignores),
// so both ends produced Z_FINISH streams and round-tripped fine. This test
// hand-builds a frame the browser-correct way so a regression bites here.
test("server inflates browser-style Z_SYNC_FLUSH compressed frames", async () => {
  await withServer(async ({ host, port }) => {
    await new Promise((resolve, reject) => {
      const sock = netConnect({ host, port }, () => {
        const key = randomBytes(16).toString("base64");
        const expected = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        sock.write(
          `GET /ws HTTP/1.1\r\n` +
          `Host: ${host}:${port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n` +
          `Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n` +
          `\r\n`
        );
        let buf = Buffer.alloc(0);
        let upgraded = false;
        const fail = setTimeout(() => reject(new Error("timeout")), 2000);
        sock.on("data", (chunk) => {
          if (!upgraded) {
            buf = Buffer.concat([buf, chunk]);
            const idx = buf.indexOf("\r\n\r\n");
            if (idx < 0) return;
            const head = buf.slice(0, idx).toString();
            if (!head.includes(expected)) { clearTimeout(fail); reject(new Error("bad accept")); return; }
            if (!/permessage-deflate/i.test(head)) { clearTimeout(fail); reject(new Error("deflate not negotiated")); return; }
            upgraded = true;
            // Build a hello frame the browser-correct way.
            const json = JSON.stringify({ op: "hello", protocol: 1, uuid: "browser-style-frame-test", client: "browser-emulator" });
            const compressed = deflateRawSync(Buffer.from(json, "utf8"), { finishFlush: zlibConstants.Z_SYNC_FLUSH });
            assert.equal(compressed.slice(-4).toString("hex"), "0000ffff", "deflate should end with SYNC_FLUSH marker");
            const payload = compressed.slice(0, -4);
            const maskKey = randomBytes(4);
            const masked = Buffer.alloc(payload.length);
            for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ maskKey[i % 4];
            const b0 = 0x80 | 0x40 | 0x01; // FIN + RSV1 + TEXT
            const header = payload.length < 126
              ? Buffer.from([b0, 0x80 | payload.length])
              : (() => { const h = Buffer.alloc(4); h[0] = b0; h[1] = 0x80 | 126; h.writeUInt16BE(payload.length, 2); return h; })();
            sock.write(Buffer.concat([header, maskKey, masked]));
            buf = buf.slice(idx + 4);
          } else {
            buf = Buffer.concat([buf, chunk]);
          }
          if (upgraded && buf.length >= 2) {
            const b0 = buf[0];
            const op = b0 & 0x0f;
            const rsv1 = (b0 & 0x40) !== 0;
            if (op === 0x08) { // close
              clearTimeout(fail);
              const code = buf.readUInt16BE(2);
              reject(new Error("server closed " + code + " " + buf.slice(4).toString()));
              return;
            }
            if (op === 0x01) { // text
              const len = buf[1] & 0x7f;
              const payloadStart = 2;
              const payload = buf.slice(payloadStart, payloadStart + len);
              const decoded = rsv1
                ? inflateRawSync(Buffer.concat([payload, Buffer.from([0, 0, 0xff, 0xff])]), { finishFlush: zlibConstants.Z_SYNC_FLUSH })
                : payload;
              const msg = JSON.parse(decoded.toString("utf8"));
              clearTimeout(fail);
              try {
                assert.equal(msg.op, "welcome");
                resolve();
              } catch (e) { reject(e); }
              sock.destroy();
            }
          }
        });
        sock.on("error", (e) => { clearTimeout(fail); reject(e); });
      });
    });
  });
});
