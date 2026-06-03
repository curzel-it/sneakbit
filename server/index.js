import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { acceptKey } from "./wsFrames.js";
import { WsConnection } from "./wsConnection.js";
import { createRelay } from "./relay.js";
import { negotiate as negotiateExtensions, formatResponse as formatExtResponse } from "./wsExtensions.js";
import { handleTurnRequest } from "./turnCredentials.js";
import { createAuthHandler } from "./authRoutes.js";
import { createSavesHandler } from "./savesRoutes.js";
import { createEditingHandler } from "./editingRoutes.js";
import { assertStrongSecret } from "./jwt.js";
import { openDb } from "./db.js";
import { parseAllowedHosts, isOriginAllowed } from "./originAllowlist.js";
import { log } from "./logger.js";
import { execSync } from "node:child_process";
import { fileURLToPath as toPath } from "node:url";
import { dirname as dirOf } from "node:path";

const PORT = Number(process.env.PORT) || 8090;
const HOST = process.env.HOST || "127.0.0.1";

// Cap concurrent WS upgrades per source IP. The relay's global
// maxConnections (500) is the only other gate, so without this a single
// non-browser client (no Origin → allowed) opens all 500 slots and
// denies everyone. 32 is far above any legit co-op fan-out (a handful of
// guests per host) yet small enough that one IP can't monopolise the
// pool. Trusts socket.remoteAddress directly — nginx is the only
// upstream and lives on 127.0.0.1, so there's no X-Forwarded-For hop to
// spoof here.
const DEFAULT_MAX_CONNECTIONS_PER_IP = 32;

// Resolved once at startup so /version is cheap to call. Falls back to
// the GIT_SHA env var (set by the deployer) when this isn't a git
// checkout — the production VPS only has the tarball.
function resolveGitSha() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.trim().slice(0, 40);
  try {
    const here = dirOf(toPath(import.meta.url));
    return execSync("git rev-parse HEAD", { cwd: here, stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8").trim().slice(0, 40);
  } catch { return "unknown"; }
}
const GIT_SHA = resolveGitSha();
const STARTED_AT = new Date().toISOString();

// Cross-origin policy. The client lives on curzel.it (GitHub Pages) and
// the relay is at sneakbit.curzel.it — cross-origin by definition. We
// echo the request's Origin if it's on the allowlist; otherwise no
// Access-Control-Allow-Origin header is emitted and the browser refuses
// the response. Tooling (no Origin) gets through unchanged — same posture
// as the WS upgrade in originAllowlist.js. /health, /version, /, OPTIONS
// stay wildcard because they leak nothing sensitive; /metrics and
// /turn-credentials are origin-gated to protect their respective
// resources (metric leakage, TURN bandwidth).
const CORS_ALLOW_HEADERS = "content-type, authorization";
const CORS_MAX_AGE = "86400";
const CORS_SAFE_METHODS = "GET, HEAD, OPTIONS";
// Auth + cloud-save endpoints take POST/PUT/PATCH/DELETE (not just GET), so
// they advertise a wider methods list. Same origin allowlist — the client
// may be cross-origin (GitHub Pages on curzel.it, local dev on :8000), so
// the browser needs the echoed ACAO. Bearer tokens, not cookies, so no
// allow-credentials is required.
const CORS_AUTH_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

// Core CORS applier shared by the three postures below. Always sets the
// methods list + allowed-headers + max-age. Gating hinges on allowedHosts:
//   - omitted → wildcard posture (ACAO: *) for endpoints that leak nothing
//     (/health, /version, /, 404).
//   - supplied → origin-gated: emit Vary: origin and echo the request
//     Origin only when it's on the allowlist (browsers then accept it;
//     non-browser tooling with no Origin is let through ungated).
function applyCors(res, methods, originHeader, allowedHosts) {
  res.setHeader("access-control-allow-methods", methods);
  res.setHeader("access-control-allow-headers", CORS_ALLOW_HEADERS);
  res.setHeader("access-control-max-age", CORS_MAX_AGE);
  if (allowedHosts === undefined) {
    res.setHeader("access-control-allow-origin", "*");
    return;
  }
  res.setHeader("vary", "origin");
  if (!originHeader) return;
  if (!isOriginAllowed(originHeader, allowedHosts)) return;
  res.setHeader("access-control-allow-origin", originHeader);
}

function applySafeCors(res) {
  applyCors(res, CORS_SAFE_METHODS);
}

function applyGatedCors(res, originHeader, allowedHosts) {
  applyCors(res, CORS_SAFE_METHODS, originHeader, allowedHosts);
}

function applyAuthCors(res, originHeader, allowedHosts) {
  applyCors(res, CORS_AUTH_METHODS, originHeader, allowedHosts);
}

// Endpoints behind bearer auth (account + cloud saves + editor worlds) share the
// wide CORS + lazy-db treatment.
function isAuthScoped(url) {
  if (!url) return false;
  return url.startsWith("/auth/")
    || url === "/saves" || url.startsWith("/saves?")
    || url === "/editing" || url.startsWith("/editing/") || url.startsWith("/editing?");
}

export function startServer({
  port = PORT,
  host = HOST,
  graceMs,
  idleTimeoutMs,
  idleCheckMs,
  allowedOrigins,
  maxConnections,
  maxConnectionsPerIp = DEFAULT_MAX_CONNECTIONS_PER_IP,
  maxSessions,
  metricsToken = process.env.METRICS_TOKEN,
} = {}) {
  // Fail fast on a present-but-weak JWT_SECRET before we bind the port.
  assertStrongSecret();
  const relay = createRelay({ graceMs, idleTimeoutMs, idleCheckMs, maxConnections, maxSessions });
  const allowedHosts = parseAllowedHosts(allowedOrigins ?? process.env.ALLOWED_ORIGINS);
  const upgradedSockets = new Set();
  // /metrics rate limiter: at most METRICS_RPS_PER_IP requests per
  // second per source IP. Cheap dictionary keyed by remoteAddress; the
  // map is reset each second so the worst-case memory footprint is
  // O(unique-IPs-per-second). Defense-in-depth — the endpoint is also
  // gated by an optional bearer token (METRICS_TOKEN).
  const metricsRl = new Map();
  let metricsRlEpoch = 0;
  // Concurrent-upgrade count per source IP, decremented on socket close.
  // Bounds the blast radius of a single client hoarding the global pool.
  const upgradesPerIp = new Map();

  // Auth + cloud saves are optional and lazy: the db is opened (and data.db
  // created) only on the first bearer-scoped request, and only when
  // JWT_SECRET is configured. With no secret the endpoints return 503 and the
  // rest of the server (relay, health, turn) runs unchanged — the
  // offline-first guarantee. Auth and saves share one db connection.
  let db = null;
  let dbInit = false;
  function getDb() {
    if (dbInit) return db;
    dbInit = true;
    if (!process.env.JWT_SECRET) return null;
    try {
      db = openDb();
    } catch (err) {
      log.error("db.initFailed", { err: err?.message || String(err) });
      db = null;
    }
    return db;
  }
  let authHandler = null;
  function getAuthHandler() {
    if (!authHandler) { const d = getDb(); if (d) authHandler = createAuthHandler({ db: d }); }
    return authHandler;
  }
  let savesHandler = null;
  function getSavesHandler() {
    if (!savesHandler) { const d = getDb(); if (d) savesHandler = createSavesHandler({ db: d }); }
    return savesHandler;
  }
  let editingHandler = null;
  function getEditingHandler() {
    if (!editingHandler) { const d = getDb(); if (d) editingHandler = createEditingHandler({ db: d }); }
    return editingHandler;
  }

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      if (isAuthScoped(req.url)) {
        applyAuthCors(res, req.headers.origin, allowedHosts);
      } else {
        applySafeCors(res);
      }
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      applySafeCors(res);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok\n");
      return;
    }
    if (req.method === "GET" && req.url === "/version") {
      applySafeCors(res);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ git: GIT_SHA, startedAt: STARTED_AT }) + "\n");
      return;
    }
    if (req.method === "GET" && req.url === "/metrics") {
      applyGatedCors(res, req.headers.origin, allowedHosts);
      if (!checkMetricsAuth(req)) {
        res.writeHead(401, {
          "content-type": "text/plain; charset=utf-8",
          "www-authenticate": "Bearer realm=\"metrics\"",
        });
        res.end("unauthorized\n");
        return;
      }
      if (!checkMetricsRate(req)) {
        res.writeHead(429, { "content-type": "text/plain; charset=utf-8" });
        res.end("rate limited\n");
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(relay.metrics.snapshot()) + "\n");
      return;
    }
    if (req.method === "GET" && req.url === "/") {
      applySafeCors(res);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("hello from sneakbit server\n");
      return;
    }
    if (req.url === "/turn-credentials") {
      applyGatedCors(res, req.headers.origin, allowedHosts);
      handleTurnRequest(req, res);
      return;
    }
    if (isAuthScoped(req.url)) {
      applyAuthCors(res, req.headers.origin, allowedHosts);
      const handler = req.url.startsWith("/saves") ? getSavesHandler()
        : req.url.startsWith("/editing") ? getEditingHandler()
        : getAuthHandler();
      if (!handler) {
        res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "auth_unavailable" }) + "\n");
        return;
      }
      // The handler is async and owns its own response; surface a 500 if it
      // rejects before writing anything.
      handler(req, res).catch((err) => {
        log.error("auth.unhandled", { err: err?.message || String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "server_error" }) + "\n");
        }
      });
      return;
    }
    applySafeCors(res);
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
  });

  // Bearer-token gate on /metrics. Disabled (open) by default for
  // backward compatibility; once METRICS_TOKEN is set in the systemd
  // env, scrapers must send `Authorization: Bearer <token>`.
  function checkMetricsAuth(req) {
    if (!metricsToken) return true;
    const h = req.headers.authorization;
    if (typeof h !== "string") return false;
    const prefix = "bearer ";
    if (h.length < prefix.length || h.slice(0, prefix.length).toLowerCase() !== prefix) {
      return false;
    }
    return h.slice(prefix.length).trim() === metricsToken;
  }

  // Per-IP rate limit on /metrics: 10 req/s/IP. Snapshot is cheap (a
  // few dozen integers serialised) but unauthenticated scraping at
  // 1000 rps is still wasted CPU + a soft DoS amplifier. Trusts
  // remoteAddress directly — there's no proxy in front advertising
  // X-Forwarded-For at this hop; nginx is the only upstream and lives
  // on 127.0.0.1.
  function checkMetricsRate(req) {
    const METRICS_RPS_PER_IP = 10;
    const now = Date.now();
    const epoch = Math.floor(now / 1000);
    if (epoch !== metricsRlEpoch) {
      metricsRl.clear();
      metricsRlEpoch = epoch;
    }
    const ip = req.socket?.remoteAddress || "unknown";
    const n = (metricsRl.get(ip) || 0) + 1;
    metricsRl.set(ip, n);
    return n <= METRICS_RPS_PER_IP;
  }

  server.on("upgrade", (req, socket) => {
    const upgrade = (req.headers.upgrade || "").toLowerCase();
    const wsKey = req.headers["sec-websocket-key"];
    if (upgrade !== "websocket" || !wsKey) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    if (req.url !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!isOriginAllowed(req.headers.origin, allowedHosts)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const ip = socket.remoteAddress || "unknown";
    if ((upgradesPerIp.get(ip) || 0) >= maxConnectionsPerIp) {
      log.warn("ws.ip_capacity", { ip, cap: maxConnectionsPerIp });
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = acceptKey(wsKey);
    const ext = negotiateExtensions(req.headers["sec-websocket-extensions"]);
    const extHeader = formatExtResponse(ext);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      (extHeader ? `Sec-WebSocket-Extensions: ${extHeader}\r\n` : "") +
      "\r\n"
    );
    socket.setNoDelay(true);
    upgradedSockets.add(socket);
    upgradesPerIp.set(ip, (upgradesPerIp.get(ip) || 0) + 1);
    socket.on("close", () => {
      upgradedSockets.delete(socket);
      const left = (upgradesPerIp.get(ip) || 1) - 1;
      if (left <= 0) upgradesPerIp.delete(ip);
      else upgradesPerIp.set(ip, left);
    });
    const ws = new WsConnection(socket, { deflate: ext ? true : false });
    relay.attach(ws);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const resolvedPort = typeof addr === "object" && addr ? addr.port : port;
      const resolvedHost = typeof addr === "object" && addr ? addr.address : host;
      resolve({
        server,
        relay,
        port: resolvedPort,
        host: resolvedHost,
        close: () => new Promise((r) => {
          for (const s of upgradedSockets) {
            try { s.destroy(); } catch { /* ignore */ }
          }
          upgradedSockets.clear();
          relay.shutdown?.();
          server.close(() => r());
        }),
        // Graceful drain: announce server_restart to every connection
        // BEFORE tearing the sockets down so guests see a clean
        // session.closed close-code path instead of a TCP reset. Called
        // by the SIGTERM/SIGINT handlers.
        drainAndClose: async ({ flushMs = 150 } = {}) => {
          // Stop taking new upgrades first — once the OS sees the
          // server stop listening it'll reject incoming SYNs.
          try { server.close(); } catch { /* ignore */ }
          try { await relay.drain({ flushMs }); } catch { /* ignore */ }
          for (const s of upgradedSockets) {
            try { s.destroy(); } catch { /* ignore */ }
          }
          upgradedSockets.clear();
        },
      });
    });
  });
}

const invokedAsScript =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedAsScript) {
  let started = null;
  startServer().then((s) => {
    started = s;
    log.info("server.listen", { host: s.host, port: s.port, git: GIT_SHA });
  }).catch((err) => {
    log.error("server.startFailed", { err: err?.message || String(err) });
    process.exit(1);
  });

  let draining = false;
  const shutdown = async (signal) => {
    if (draining) return; // Second signal during drain → ignore.
    draining = true;
    log.info("server.shutdown", { signal });
    try { await started?.drainAndClose?.(); } catch (e) {
      log.error("server.drainFailed", { err: e?.message || String(e) });
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
