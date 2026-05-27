import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { acceptKey } from "./wsFrames.js";
import { WsConnection } from "./wsConnection.js";
import { createRelay } from "./relay.js";

const PORT = Number(process.env.PORT) || 8090;
const HOST = process.env.HOST || "127.0.0.1";

export function startServer({ port = PORT, host = HOST, graceMs, idleTimeoutMs, idleCheckMs } = {}) {
  const relay = createRelay({ graceMs, idleTimeoutMs, idleCheckMs });
  const upgradedSockets = new Set();
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok\n");
      return;
    }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("hello from sneakbit server\n");
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
    const accept = acceptKey(wsKey);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n"
    );
    socket.setNoDelay(true);
    upgradedSockets.add(socket);
    socket.on("close", () => upgradedSockets.delete(socket));
    const ws = new WsConnection(socket);
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
    console.log(`sneakbit server listening on http://${host}:${port}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });

  const shutdown = (signal) => {
    console.log(`received ${signal}, shutting down`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
