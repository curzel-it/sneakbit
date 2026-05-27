// parseFrames is the hot path for every incoming byte on the relay; its
// only guard against a memory-exhaustion attack is the per-frame size
// cap. These tests pin the cap and exercise both the 16-bit and 64-bit
// length-field paths.

import { test } from "node:test";
import assert from "node:assert/strict";

const { parseFrames, OP, MAX_FRAME_PAYLOAD } =
  await import("../server/wsFrames.js");
const { encodeMaskedFrame } = await import("./helpers/clientFrames.js");

test("MAX_FRAME_PAYLOAD is the 1 MB the spec calls out", () => {
  assert.equal(MAX_FRAME_PAYLOAD, 1 << 20);
});

test("a frame at exactly MAX_FRAME_PAYLOAD parses fine", () => {
  // Use a single text frame, masked client-side as a browser would.
  const payload = Buffer.alloc(MAX_FRAME_PAYLOAD, 0x41);
  const frame = encodeMaskedFrame(OP.TEXT, payload);
  const { frames, rest } = parseFrames(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.length, MAX_FRAME_PAYLOAD);
  assert.equal(rest.length, 0);
});

test("a 64-bit-length frame declaring > 1 MB is rejected before allocation", () => {
  // Hand-craft a header that claims 1 MB + 1 bytes (uses the 64-bit
  // extended-length path: len byte = 127, then 8-byte BE length).
  const claimed = MAX_FRAME_PAYLOAD + 1;
  const header = Buffer.alloc(10);
  header[0] = 0x81; // FIN + TEXT
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(claimed), 2);
  // We deliberately do NOT include the bogus payload — the size check
  // must trip on the header alone, without us first sending 1 MB+ of
  // bytes the relay would otherwise buffer.
  assert.throws(() => parseFrames(header), /frame too big/);
});

test("a 16-bit-length frame at the max 65535 still fits under the cap", () => {
  // Smoke test the 16-bit path: 65535 < 1 MB, so this must succeed even
  // though it uses the second header layout.
  const payload = Buffer.alloc(65535, 0x42);
  const frame = encodeMaskedFrame(OP.TEXT, payload);
  const { frames } = parseFrames(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.length, 65535);
});

test("an incomplete frame keeps its bytes in the tail for the next call", () => {
  // Regression guard — the cap check must not consume a partial header.
  const payload = Buffer.from("hi", "utf8");
  const full = encodeMaskedFrame(OP.TEXT, payload);
  const half = full.slice(0, full.length - 1);
  const { frames, rest } = parseFrames(half);
  assert.equal(frames.length, 0);
  assert.equal(rest.length, half.length);
});
