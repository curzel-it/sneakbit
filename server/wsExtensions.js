// Sec-WebSocket-Extensions negotiation, scoped to permessage-deflate
// (RFC 7692). We accept the client's offer and tighten it to
// no_context_takeover on both sides — that lets the per-message
// inflate/deflate use zlib's *RawSync without juggling a streaming
// context. The compression ratio on short JSON deltas is still ~60 %.

const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);

export function negotiate(headerValue) {
  if (typeof headerValue !== "string") return null;
  // Sec-WebSocket-Extensions may carry multiple comma-separated offers.
  // Each offer has the form `name; key[=val]; key[=val]`.
  const offers = headerValue.split(",").map((o) => o.trim()).filter(Boolean);
  for (const offer of offers) {
    const parts = offer.split(";").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    if (parts[0].toLowerCase() !== "permessage-deflate") continue;

    const params = new Map();
    for (let i = 1; i < parts.length; i++) {
      const [rawKey, rawVal] = parts[i].split("=").map((s) => s && s.trim());
      if (!rawKey) continue;
      params.set(rawKey.toLowerCase(), rawVal == null ? true : rawVal.replace(/"/g, ""));
    }

    // Browsers send `client_max_window_bits` without a value as part of
    // the offer; we don't care, we always use bits=15 (zlib default).
    return {
      name: "permessage-deflate",
      // Force fresh deflate context per message on both sides.
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
    };
  }
  return null;
}

export function formatResponse(ext) {
  if (!ext) return null;
  const parts = [ext.name];
  if (ext.serverNoContextTakeover) parts.push("server_no_context_takeover");
  if (ext.clientNoContextTakeover) parts.push("client_no_context_takeover");
  return parts.join("; ");
}

// Trailing 0x00 0x00 0xff 0xff is the SYNC_FLUSH-with-empty-block marker
// that RFC 7692 §7.2.1 says we must strip on send and append on receive.
export function stripTrailer(buf) {
  const len = buf.length;
  if (len < 4) return buf;
  if (
    buf[len - 4] === 0x00 &&
    buf[len - 3] === 0x00 &&
    buf[len - 2] === 0xff &&
    buf[len - 1] === 0xff
  ) return buf.slice(0, len - 4);
  return buf;
}

export function appendTrailer(buf) {
  return Buffer.concat([buf, TRAILER]);
}
