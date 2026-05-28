import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { acceptKey } from "./wsFrames.js";
import { WsConnection } from "./wsConnection.js";
import { createRelay } from "./relay.js";
import { negotiate as negotiateExtensions, formatResponse as formatExtResponse } from "./wsExtensions.js";
import { handleTurnRequest } from "./turnCredentials.js";
import { parseAllowedHosts, isOriginAllowed } from "./originAllowlist.js";
import { log } from "./logger.js";
import { execSync } from "node:child_process";
import { fileURLToPath as toPath } from "node:url";
import { dirname as dirOf } from "node:path";

const PORT = Number(process.env.PORT) || 8090;
const HOST = process.env.HOST || "127.0.0.1";

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
const SAFE_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

function applySafeCors(res) {
  for (const [k, v] of Object.entries(SAFE_CORS_HEADERS)) res.setHeader(k, v);
}

function applyGatedCors(res, originHeader, allowedHosts) {
  res.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-max-age", "86400");
  res.setHeader("vary", "origin");
  if (!originHeader) return; // non-browser tooling — no ACAO needed.
  if (!isOriginAllowed(originHeader, allowedHosts)) return;
  res.setHeader("access-control-allow-origin", originHeader);
}

export function startServer({
  port = PORT,
  host = HOST,
  graceMs,
  idleTimeoutMs,
  idleCheckMs,
  allowedOrigins,
  maxConnections,
  maxSessions,
  metricsToken = process.env.METRICS_TOKEN,
} = {}) {
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
  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      applySafeCors(res);
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
    socket.on("close", () => upgradedSockets.delete(socket));
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
