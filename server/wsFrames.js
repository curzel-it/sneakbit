// RFC 6455 framing — just the slice we need:
//   - HTTP upgrade accept-key computation
//   - text / close / ping / pong frames (single-frame and continuation)
//   - server-to-client unmasked encode (the relay only ever sends
//     server-bound, which RFC 6455 §5.1 says MUST NOT be masked)
//   - parseFrames handles incoming masked + unmasked alike (clients
//     MUST mask their outbound frames per the same section)
//   - RSV1 bit for permessage-deflate (RFC 7692)
//
// Client-side masking lives in tests/helpers/clientFrames.js — only
// test infrastructure that impersonates a browser needs to produce
// masked frames, and shipping a randomised XOR + mask-key allocator
// for every outbound server frame was dead weight in prod.
//
// No npm deps. Keeps the relay portable for the native wrapper bundle.

import { createHash } from "node:crypto";

const MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Reject any single frame whose declared payload is larger than 1 MB.
// The relay's real traffic (host snapshots ~50 Hz, guest input intents)
// never approaches this — anything bigger is either a buggy client or a
// memory-exhaustion attempt. The old guard at 2 GB would happily
// allocate ~2 GB before throwing.
export const MAX_FRAME_PAYLOAD = 1 << 20;

export const OP = {
  CONT: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
};

// RSV1 flag in byte 0. Set on the first frame of a permessage-deflate-
// compressed message; continuation frames inherit it via the assembler.
export const RSV1 = 0x40;

export function acceptKey(clientKey) {
  return createHash("sha1").update(clientKey + MAGIC).digest("base64");
}

// Server-to-client frames are never masked (RFC 6455 §5.1). `rsv1`
// opt-in lets the deflate path mark a compressed payload — RFC 7692 §6.
export function encodeFrame(opcode, payload, { rsv1 = false } = {}) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload || "", "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  if (rsv1) header[0] |= RSV1;
  return Buffer.concat([header, data]);
}

export function encodeCloseFrame(code = 1000, reason = "", opts) {
  const reasonBuf = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  return encodeFrame(OP.CLOSE, payload, opts);
}

// Walks `buf` consuming as many complete frames as possible. Returns the
// frames and the unconsumed tail to feed back next time.
export function parseFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    if (buf.length - offset < 2) break;
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const rsv1 = (b0 & RSV1) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      if (buf.length - offset < 4) break;
      len = buf.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (len === 127) {
      if (buf.length - offset < 10) break;
      const big = buf.readBigUInt64BE(offset + 2);
      if (big > BigInt(MAX_FRAME_PAYLOAD)) {
        throw new Error("frame too big");
      }
      len = Number(big);
      headerLen = 10;
    }
    if (len > MAX_FRAME_PAYLOAD) {
      throw new Error("frame too big");
    }
    let maskKey;
    if (masked) {
      if (buf.length - offset < headerLen + 4) break;
      maskKey = buf.slice(offset + headerLen, offset + headerLen + 4);
      headerLen += 4;
    }
    if (buf.length - offset < headerLen + len) break;
    const payload = Buffer.alloc(len);
    buf.copy(payload, 0, offset + headerLen, offset + headerLen + len);
    if (masked) {
      for (let i = 0; i < len; i++) payload[i] ^= maskKey[i % 4];
    }
    frames.push({ fin, rsv1, opcode, payload });
    offset += headerLen + len;
  }
  return { frames, rest: buf.slice(offset) };
}
