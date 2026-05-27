// Origin check for WS upgrades. The browser will always send an Origin
// header on a WebSocket handshake (RFC 6455 §10.2); rejecting the ones
// we don't recognise stops drive-by JS on a third-party page from
// connecting to the relay and consuming session slots.
//
// Non-browser tooling (curl, our own test client, native wrappers) does
// NOT send Origin. We allow those through — origin headers can be
// spoofed by any non-browser client anyway, so insisting on one here
// would only block legitimate tooling without adding real security.

const DEFAULT_HOSTS = [
  "curzel.it",
  "sneakbit.curzel.it",
  "localhost",
  "127.0.0.1",
];

export function parseAllowedHosts(envValue) {
  if (typeof envValue !== "string" || !envValue.trim()) {
    return DEFAULT_HOSTS.slice();
  }
  return envValue
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Returns true if the origin header is acceptable. Absent / empty
// origins are accepted (non-browser tooling). Malformed origins are
// rejected — a real browser never sends a non-URL string here.
export function isOriginAllowed(originHeader, allowedHosts) {
  if (!originHeader) return true;
  let host;
  try { host = new URL(originHeader).hostname.toLowerCase(); }
  catch { return false; }
  if (!host) return false;
  return allowedHosts.includes(host);
}
