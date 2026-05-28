// Tiny static file server. Used as a fallback when python3 isn't on
// the path. Args: <port> <root>. Serves any path under <root>; returns
// 404 for anything that escapes it. Single-content-type table — the
// app uses .html/.js/.json/.png/.wav/.svg/.css, and we map only those.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, normalize, sep } from "node:path";

const port = Number(process.argv[2] || 8000);
const root = resolve(process.argv[3] || process.cwd());

const TYPES = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".mjs":  "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".wav":  "audio/wav",
  ".mp3":  "audio/mpeg",
  ".svg":  "image/svg+xml",
  ".css":  "text/css",
  ".ico":  "image/x-icon",
};

createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  let relative = decodeURIComponent(urlPath);
  if (relative.endsWith("/")) relative += "index.html";
  const abs = resolve(root, "." + relative);
  if (!abs.startsWith(root + sep) && abs !== root) {
    res.statusCode = 403; res.end("forbidden"); return;
  }
  let stat;
  try { stat = statSync(abs); }
  catch { res.statusCode = 404; res.end("not found"); return; }
  if (stat.isDirectory()) {
    res.statusCode = 404; res.end("not found"); return;
  }
  const ext = "." + abs.split(".").pop();
  res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
  res.setHeader("Content-Length", String(stat.size));
  createReadStream(abs).pipe(res);
}).listen(port, "127.0.0.1");
