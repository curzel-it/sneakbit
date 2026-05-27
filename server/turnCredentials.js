// Ephemeral TURN credentials via the TURN REST API
// (draft-uberti-rtcweb-turn-rest-00). Configure with two env vars:
//
//   TURN_SECRET=<shared-static-auth-secret-with-coturn>
//   TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
//
// On the coturn side, set:
//   use-auth-secret
//   static-auth-secret=<TURN_SECRET>
//
// The TTL is fixed at 1 hour; the relay never persists credentials. If
// either env var is missing the endpoint returns 503 and the client
// falls back to STUN-only — which is enough for ~90 % of consumer NATs.

import { createHmac } from "node:crypto";

const TTL_SECONDS = 3600;

export function isTurnConfigured(env = process.env) {
  return !!(env.TURN_SECRET && env.TURN_URLS);
}

export function buildCredentials({ secret, urls, ttlSeconds = TTL_SECONDS, now = Date.now() } = {}) {
  if (!secret || !urls) return null;
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  // Per the REST API draft: username is "<expiry>" or "<expiry>:<user>".
  // We don't have user identity at the relay (UUIDs are opaque), so just
  // the expiry — coturn doesn't care, it only validates HMAC.
  const username = String(expiresAt);
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  const iceServers = parseUrls(urls).map((url) => ({ urls: url, username, credential }));
  return {
    iceServers,
    expiresAt,
    ttl: ttlSeconds,
  };
}

export function parseUrls(raw) {
  if (!raw) return [];
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

export function handleTurnRequest(req, res, env = process.env) {
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("method not allowed\n");
    return;
  }
  if (!isTurnConfigured(env)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("turn not configured\n");
    return;
  }
  const creds = buildCredentials({ secret: env.TURN_SECRET, urls: env.TURN_URLS });
  if (!creds) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("turn config error\n");
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    // The credentials carry their own expiry; allow the browser to cache
    // for a fraction of the TTL but always revalidate on a new session.
    "cache-control": "public, max-age=300",
    // GitHub Pages + the relay are on different origins, so the browser
    // needs CORS to fetch this. Same-origin (native wrapper) also works.
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(creds) + "\n");
}
