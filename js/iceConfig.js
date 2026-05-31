// Picks the iceServers list for RTCPeerConnection. STUN-only by default
// (free public servers); fetches ephemeral TURN credentials from the
// relay at boot if the server advertises them. TURN is best-effort: when
// the endpoint 404/503s we still have STUN, which works for the vast
// majority of consumer connections.

import { DEFAULT_STUN_SERVERS } from "./webrtcChannel.js?v=20260531b";

const TURN_ENDPOINT_PATH = "/turn-credentials";
let cachedServers = DEFAULT_STUN_SERVERS.slice();
let cachedExpiresAt = 0;

export function getIceServers() {
  return cachedServers.slice();
}

// Translate a ws[s] URL into the matching http[s] origin so we can hit
// the credentials endpoint on the same host. localhost dev: ws://host:port
// → http://host:port; prod: wss://host/ws → https://host/turn-credentials.
function originFromWsUrl(wsUrl) {
  if (!wsUrl) return null;
  try {
    const u = new URL(wsUrl);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return null;
  }
}

export async function primeIceServers(wsUrl, fetchImpl) {
  const origin = originFromWsUrl(wsUrl);
  if (!origin) return cachedServers;
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return cachedServers;
  let res;
  try { res = await f(origin + TURN_ENDPOINT_PATH, { method: "GET" }); }
  catch { return cachedServers; }
  if (!res || !res.ok) return cachedServers;
  let body;
  try { body = await res.json(); }
  catch { return cachedServers; }
  if (!body || !Array.isArray(body.iceServers)) return cachedServers;
  cachedServers = [...DEFAULT_STUN_SERVERS, ...body.iceServers];
  cachedExpiresAt = typeof body.expiresAt === "number" ? body.expiresAt : 0;
  return cachedServers;
}

export function _resetIceConfigForTesting() {
  cachedServers = DEFAULT_STUN_SERVERS.slice();
  cachedExpiresAt = 0;
}

export function _getCachedExpiresAtForTesting() { return cachedExpiresAt; }
