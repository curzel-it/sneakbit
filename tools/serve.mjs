// Dev static-file server. Replaces `python3 -m http.server` so the dev loop
// only depends on Node (already required by engines.node). Vanilla node:http,
// no deps — serves the repo root straight from disk so the raw ES modules in
// js/ load without a build step.
//
// The bundle `npm run build` leaves in _site/ is never what a plain run serves,
// not even through its own path: pass --build to serve it, so a stale bundle
// can only ever be looked at on purpose.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "127.0.0.1";
const REPO = resolve(process.cwd());
const SITE = join(REPO, "_site");
const BUILD = process.argv.slice(2).includes("--build");
if (BUILD && !existsSync(join(SITE, "index.html"))) {
  console.error("--build was asked for but _site/index.html is missing; run npm run build");
  process.exit(1);
}
const ROOT = BUILD ? SITE : REPO;

function shadowed(path) {
  if (BUILD) return false;
  const inner = relative(SITE, path);
  return inner !== "" && !inner.startsWith("..") && !inner.startsWith(sep);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-cache", ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    // Resolve against ROOT and reject anything that escapes it (path traversal).
    const filePath = normalize(join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      return send(res, 403, "Forbidden");
    }
    if (shadowed(filePath)) {
      return send(res, 403, "Forbidden — the build is only served with --build");
    }

    let info;
    try {
      info = await stat(filePath);
    } catch {
      return send(res, 404, "Not Found");
    }
    const target = info.isDirectory() ? join(filePath, "index.html") : filePath;

    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] || "application/octet-stream";
    send(res, 200, data, { "content-type": type });
  } catch (err) {
    send(res, 500, `Internal Server Error\n${err?.message ?? ""}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${BUILD ? "the _site/ build" : "source"} from ${ROOT}\n  http://${HOST}:${PORT}/`);
});
