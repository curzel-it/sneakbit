// Map short test labels (e.g. "u-host-1") to deterministic UUIDv4-shaped
// strings. The relay's onHello now strict-validates UUIDv4 shape per
// docs/server.md §Identity, so tests can't use bare labels as uuids any
// more. Hashing keeps each label stable across runs so reconnect/grace
// scenarios still resolve to the same identity.

import { createHash } from "node:crypto";

export function toTestUuid(label) {
  if (typeof label === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(label)) {
    return label;
  }
  const h = createHash("sha256").update(String(label)).digest("hex");
  // Slot the version (4) and variant (8..b) nibbles per RFC 4122.
  const variant = "89ab"[parseInt(h[16], 16) & 0x3];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
