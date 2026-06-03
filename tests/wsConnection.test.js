// WsConnection re-assembly + fragment hardening (RFC 6455 §5.4). Drives the
// connection through a fake socket and asserts the protocol-violation close
// codes. The connection only ever parses client frames, so every inbound
// frame here is masked the way a browser would send it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { deflateRawSync, constants as zlibConstants } from "node:zlib";

const { WsConnection } = await import("../server/wsConnection.js");
const { OP, MAX_FRAME_PAYLOAD } = await import("../server/wsFrames.js");
const { encodeMaskedFrame } = await import("./helpers/clientFrames.js");
const { stripTrailer } = await import("../server/wsExtensions.js");

// Build the compressed payload a browser would put in an RSV1 frame: raw
// deflate with the SYNC_FLUSH ending, trailer stripped (the server appends
// it back before inflating). Returns the bytes that go on the wire.
function deflateForWire(raw) {
  return stripTrailer(deflateRawSync(raw, { finishFlush: zlibConstants.Z_SYNC_FLUSH }));
}

// A net.Socket stand-in: records bytes written so we can read back the close
// frame the connection sends, and the RFC 6455 close code inside it.
function makeFakeSocket() {
  const sock = new EventEmitter();
  sock.writes = [];
  sock.ended = false;
  sock.write = (buf) => { sock.writes.push(Buffer.from(buf)); return true; };
  sock.end = () => { sock.ended = true; };
  sock.destroy = () => { sock.ended = true; };
  return sock;
}

// The last frame the connection wrote is its close frame: opcode 0x8, then a
// 2-byte big-endian status code.
function lastCloseCode(sock) {
  const f = sock.writes[sock.writes.length - 1];
  if (!f || (f[0] & 0x0f) !== OP.CLOSE) return null;
  return f.readUInt16BE(2);
}

function fragment(opcode, payload, fin) {
  const f = encodeMaskedFrame(opcode, payload);
  if (!fin) f[0] &= ~0x80; // clear FIN; masking never touches byte 0
  return f;
}

test("a fragmented text message reassembles and emits once", () => {
  const sock = makeFakeSocket();
  const conn = new WsConnection(sock);
  const messages = [];
  conn.on("message", (m) => messages.push(m));

  sock.emit("data", fragment(OP.TEXT, Buffer.from("hel"), false));
  sock.emit("data", fragment(OP.CONT, Buffer.from("lo"), true));

  assert.deepEqual(messages, ["hello"]);
  assert.equal(conn.closed, false);
});

test("a new data frame mid-fragment is a protocol error (1002)", () => {
  const sock = makeFakeSocket();
  const conn = new WsConnection(sock);
  sock.emit("data", fragment(OP.TEXT, Buffer.from("part"), false));
  sock.emit("data", fragment(OP.TEXT, Buffer.from("oops"), false));
  assert.equal(conn.closed, true);
  assert.equal(lastCloseCode(sock), 1002);
});

test("a continuation with no message in progress is a protocol error (1002)", () => {
  const sock = makeFakeSocket();
  const conn = new WsConnection(sock);
  sock.emit("data", fragment(OP.CONT, Buffer.from("orphan"), true));
  assert.equal(conn.closed, true);
  assert.equal(lastCloseCode(sock), 1002);
});

test("an assembled message larger than the cap is rejected (1009)", () => {
  const sock = makeFakeSocket();
  const conn = new WsConnection(sock);
  const half = Buffer.alloc(Math.floor(MAX_FRAME_PAYLOAD * 0.6), 0x41);
  sock.emit("data", fragment(OP.TEXT, half, false));
  // Second fragment pushes the running total past MAX_FRAME_PAYLOAD.
  sock.emit("data", fragment(OP.CONT, half, true));
  assert.equal(conn.closed, true);
  assert.equal(lastCloseCode(sock), 1009);
});

test("a compressed (RSV1) text frame inflates and emits", () => {
  const sock = makeFakeSocket();
  const conn = new WsConnection(sock);
  const messages = [];
  conn.on("message", (m) => messages.push(m));

  const payload = deflateForWire(Buffer.from("hello deflate", "utf8"));
  sock.emit("data", encodeMaskedFrame(OP.TEXT, payload, { rsv1: true }));

  assert.deepEqual(messages, ["hello deflate"]);
  assert.equal(conn.closed, false);
});

test("a decompression-bomb RSV1 frame is rejected (1007), not OOM", () => {
  const sock = makeFakeSocket();
  const conn = new WsConnection(sock);
  const messages = [];
  conn.on("message", (m) => messages.push(m));

  // ~4 MiB of repetitive data deflates to a few KB — well under the 1 MiB
  // compressed-input cap, so it sails past the input guard. Inflating it
  // would blow past MAX_FRAME_PAYLOAD; maxOutputLength makes zlib throw
  // ERR_BUFFER_TOO_LARGE, which the connection turns into a clean 1007
  // instead of allocating ~4 MiB (a real bomb: ~1 GB) and OOM-killing the VPS.
  const payload = deflateForWire(Buffer.alloc(4 * MAX_FRAME_PAYLOAD, 0x41));
  assert.ok(payload.length <= MAX_FRAME_PAYLOAD, "bomb must fit under the input cap");
  sock.emit("data", encodeMaskedFrame(OP.TEXT, payload, { rsv1: true }));

  assert.equal(conn.closed, true);
  assert.equal(lastCloseCode(sock), 1007);
  assert.deepEqual(messages, []); // never emitted a multi-MB string
});

test("after a clean fragmented message the connection accepts the next one", () => {
  const sock = makeFakeSocket();
  const conn = new WsConnection(sock);
  const messages = [];
  conn.on("message", (m) => messages.push(m));

  sock.emit("data", fragment(OP.TEXT, Buffer.from("a"), false));
  sock.emit("data", fragment(OP.CONT, Buffer.from("b"), true));
  // A fresh single-frame message must not trip the interleave guard.
  sock.emit("data", encodeMaskedFrame(OP.TEXT, "c"));

  assert.deepEqual(messages, ["ab", "c"]);
  assert.equal(conn.closed, false);
});
