// HTTP API base for the account/auth endpoints. Same host-resolution logic
// as net.js pickServerUrl (localhost vs production), but for plain HTTP —
// kept separate so net.js stays focused on the WebSocket relay.
//
// `?api=` is a dev-only override (honored only on localhost) so the e2e
// harness can point at a relay on a non-default port. On a deployed build
// it's ignored, mirroring net.js's anti-phishing posture for `?server=`.

const DEFAULT_DEV_API = "http://localhost:8090";
const DEFAULT_PROD_API = "https://sneakbit.curzel.it";

export function pickApiBase(loc = typeof location !== "undefined" ? location : null) {
  const host = loc?.hostname || "";
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  if (loc?.search) {
    try {
      const override = new URLSearchParams(loc.search).get("api");
      if (override && isLocal) return override.replace(/\/$/, "");
    } catch { /* ignore */ }
  }
  return isLocal ? DEFAULT_DEV_API : DEFAULT_PROD_API;
}
