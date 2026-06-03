// Serves the built _site/ bundle over the custom `app://` scheme.
//
// Why a custom scheme instead of file://: the game fetches ./data/*.json and
// loads ./assets/*.png relative to the document (js/data.js, js/assets.js).
// Under file:// those fetches are blocked. A registered standard+secure scheme
// (see electron/main.js) makes them work and — crucially — gives the page a
// real host. We serve from host `sneakbit.curzel.it` so js/apiBase.js and
// js/net.js resolve `location.hostname` to production instead of localhost,
// with zero changes to game code.

import { readFile } from "node:fs/promises";
import { join, normalize, sep, extname } from "node:path";
import { app } from "electron";

// Extension → MIME. ES modules and JSON must carry the right Content-Type or
// the browser refuses to execute / parse them; the rest keep asset loads sane.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// Content-Security-Policy for the bundled document. There's no CSP on the
// website (nginx), so the desktop wrapper — which runs in a more privileged
// context — sets its own. Tight by default: scripts only from the bundle, no
// inline/`eval` JS (the page loads `./js/main.js` as a module, nothing inline);
// network limited to the relay/API origin plus the local blob/data URLs the
// save-export path uses. `style-src` keeps 'unsafe-inline' for index.html's
// inline <style> block. WebRTC peer/STUN/TURN traffic isn't governed by CSP.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https://sneakbit.curzel.it wss://sneakbit.curzel.it blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

// _site/ ships inside the app (electron-builder bundles it via `files`); in dev
// (`electron .`) app.getAppPath() is the repo root. Resolve lazily so this
// module can be imported before app is ready.
function siteRoot() {
  return join(app.getAppPath(), "_site");
}

export async function handleAppRequest(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";

  const root = siteRoot();
  // Path-traversal guard: the resolved file must stay inside _site/.
  const filePath = normalize(join(root, pathname));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    const headers = { "content-type": type };
    // CSP rides on the top-level document; the directives cover everything it
    // then loads, so it doesn't need repeating on every asset response.
    if (type.startsWith("text/html")) headers["content-security-policy"] = CONTENT_SECURITY_POLICY;
    return new Response(body, { status: 200, headers });
  } catch (err) {
    if (err && err.code === "ENOENT") return new Response("Not found", { status: 404 });
    return new Response("Internal error", { status: 500 });
  }
}
