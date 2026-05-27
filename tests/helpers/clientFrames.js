// Client-side WS framing helper for tests only. The production server
// NEVER masks (RFC 6455 §5.1: server-to-client frames MUST NOT be
// masked), so the encodeFrame in server/wsFrames.js no longer carries
// a `mask` option. This helper exists so test infrastructure that
// poses as a browser client can still produce masked frames the relay
// will accept.
//
// Single responsibility: take an already-built unmasked text frame and
// rewrite it with the mask bit set + a random 4-byte mask key, XOR-ing
// the payload. The header-length math is identical on both sides; we
// only diverge after the length field.

import { encodeFrame } from "../../server/wsFrames.js";

export function encodeMaskedFrame(opcode, payload, { rsv1 = false } = {}) {
  const unmasked = encodeFrame(opcode, payload, { rsv1 });
  // Find the header boundary by re-reading the length byte that
  // encodeFrame just wrote — that's cheaper than re-implementing the
  // header math here and means a future encodeFrame tweak (e.g.
  // wider length fields) doesn't silently desync from this helper.
  const lenByte = unmasked[1] & 0x7f;
  let headerLen = 2;
  if (lenByte === 126) headerLen = 4;
  else if (lenByte === 127) headerLen = 10;

  const dataLen = unmasked.length - headerLen;
  const out = Buffer.alloc(unmasked.length + 4);
  unmasked.copy(out, 0, 0, headerLen);
  out[1] |= 0x80; // set mask bit
  const maskKey = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) maskKey[i] = Math.floor(Math.random() * 256);
  maskKey.copy(out, headerLen);
  for (let i = 0; i < dataLen; i++) {
    out[headerLen + 4 + i] = unmasked[headerLen + i] ^ maskKey[i % 4];
  }
  return out;
}
