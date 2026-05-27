// RFC 6455 framing — just the slice we need:
//   - HTTP upgrade accept-key computation
//   - text / close / ping / pong frames (single-frame and continuation)
//   - server-to-client unmasked, client-to-server masked
//
// No npm deps. Keeps the relay portable for the native wrapper bundle.

import { createHash } from "node:crypto";

const MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const OP = {
  CONT: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
};

export function acceptKey(clientKey) {
  return createHash("sha1").update(clientKey + MAGIC).digest("base64");
}

// Server-to-client frames are never masked.
export function encodeFrame(opcode, payload, { mask = false } = {}) {
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
  if (!mask) return Buffer.concat([header, data]);
  header[1] |= 0x80;
  const maskKey = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) maskKey[i] = Math.floor(Math.random() * 256);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ maskKey[i % 4];
  return Buffer.concat([header, maskKey, masked]);
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
      if (big > BigInt(0x7fffffff)) {
        throw new Error("frame too big");
      }
      len = Number(big);
      headerLen = 10;
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
    frames.push({ fin, opcode, payload });
    offset += headerLen + len;
  }
  return { frames, rest: buf.slice(offset) };
}
