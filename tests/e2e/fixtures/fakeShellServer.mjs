// Stands in for a native shell (Steam/iOS/Android) in e2e tests.
//
// Serves the repo like the ordinary static server, plus the two reserved
// routes the real shells implement (js/nativeBridge.js):
//
//   GET  /__native/state.json  the envelope the caller supplied
//   POST /__native/mirror      recorded, so a test can assert what the game
//                              wrote back
//
// In-process rather than spawned: the test needs to change the envelope
// between page loads and read the mirror writes back out.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".css": "text/css",
  ".ico": "image/x-icon",
};

export async function startFakeShell({ envelope = null } = {}) {
  const mirrorWrites = [];
  let current = envelope;

  const server = createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];

    if (path === "/__native/state.json") {
      if (!current) { res.statusCode = 404; res.end("not found"); return; }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(current));
      return;
    }
    if (path === "/__native/mirror" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { mirrorWrites.push(body); res.statusCode = 204; res.end(); });
      return;
    }

    let relative = decodeURIComponent(path);
    if (relative.endsWith("/")) relative += "index.html";
    const abs = resolve(REPO_ROOT, "." + relative);
    if (!abs.startsWith(REPO_ROOT + sep) && abs !== REPO_ROOT) {
      res.statusCode = 403; res.end("forbidden"); return;
    }
    let stat;
    try { stat = statSync(abs); } catch { res.statusCode = 404; res.end("not found"); return; }
    if (stat.isDirectory()) { res.statusCode = 404; res.end("not found"); return; }
    res.setHeader("Content-Type", TYPES["." + abs.split(".").pop()] || "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size));
    createReadStream(abs).pipe(res);
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  return {
    appUrl: `http://127.0.0.1:${port}`,
    mirrorWrites,
    setEnvelope(next) { current = next; },
    stop() { server.close(); },
  };
}
