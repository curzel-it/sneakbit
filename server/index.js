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

// Always-on CORS: the client lives on curzel.it (GitHub Pages) and the
// relay is at sneakbit.curzel.it — cross-origin by definition. Every HTTP
// response gets the same permissive headers so error/empty responses
// (503 when TURN is unset, 404 fallbacks, etc.) don't spam the browser
// console with CORS errors. The WS upgrade has no CORS — the
// `Sec-WebSocket-Origin` check is a separate mechanism we don't use.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function applyCors(res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
}

export function startServer({ port = PORT, host = HOST, graceMs, idleTimeoutMs, idleCheckMs, allowedOrigins } = {}) {
  const relay = createRelay({ graceMs, idleTimeoutMs, idleCheckMs });
  const allowedHosts = parseAllowedHosts(allowedOrigins ?? process.env.ALLOWED_ORIGINS);
  const upgradedSockets = new Set();
  const server = createServer((req, res) => {
    applyCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok\n");
      return;
    }
    if (req.method === "GET" && req.url === "/version") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ git: GIT_SHA, startedAt: STARTED_AT }) + "\n");
      return;
    }
    if (req.method === "GET" && req.url === "/metrics") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(relay.metrics.snapshot()) + "\n");
      return;
    }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("hello from sneakbit server\n");
      return;
    }
    if (req.url === "/turn-credentials") {
      handleTurnRequest(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
  });

  server.on("upgrade", (req, socket) => {
    const upgrade = (req.headers.upgrade || "").toLowerCase();
    const wsKey = req.headers["sec-websocket-key"];
    if (upgrade !== "websocket" || !wsKey) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    if (req.url !== "/ws" && req.url !== "/") {
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
      });
    });
  });
}

const invokedAsScript =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedAsScript) {
  startServer().then(({ port, host }) => {
    log.info("server.listen", { host, port, git: GIT_SHA });
  }).catch((err) => {
    log.error("server.startFailed", { err: err?.message || String(err) });
    process.exit(1);
  });

  const shutdown = (signal) => {
    log.info("server.shutdown", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
