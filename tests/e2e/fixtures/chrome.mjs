// Headless-Chrome launcher + CDP session helper used by the e2e tests.
//
// Chrome path: looks at $CHROME_PATH, then well-known macOS / Linux /
// Windows paths (Windows also accepts Edge, which is Chromium + CDP).
// If none resolves the helper returns null — tests use `skipIfNoChrome`
// to gracefully turn themselves into skips on machines without Chrome
// (typically CI without a browser). The real workhorse is the CDP
// `Session` class: an HTTP/WS pair to Chrome's debugger, with send/on/
// evalExpr/waitFor primitives the tests build on.
//
// "localhost" vs "127.0.0.1": Chrome's DevTools rejects HTTP requests
// whose Host header isn't `localhost` (DNS-rebinding mitigation, ~2023+).
// The 127.0.0.1 URL works for the *static* server but not for the CDP
// HTTP endpoint — so we always hit `http://localhost:PORT/json/*` here.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

// Windows installs Chrome/Edge under the Program Files / LocalAppData
// roots. Edge is Chromium-based and speaks the same CDP protocol, so it
// works as a last-resort fallback on machines that only ship Edge.
function windowsCandidates() {
  if (process.platform !== "win32") return [];
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const out = [];
  for (const r of roots) out.push(join(r, "Google", "Chrome", "Application", "chrome.exe"));
  for (const r of roots) out.push(join(r, "Microsoft", "Edge", "Application", "msedge.exe"));
  return out;
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  ...windowsCandidates(),
].filter(Boolean);

export function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function skipIfNoChrome(t) {
  const chrome = findChrome();
  if (!chrome) {
    t.skip("Chrome not found (set CHROME_PATH env var); skipping e2e test");
    return null;
  }
  return chrome;
}

// Launches one Chrome instance bound to `port`. Returns { proc, kill }
// so callers can tear it down explicitly. Awaits a /json/version probe
// so the caller never races a not-yet-listening debugger socket.
export async function launchChrome({ port, dataDir }) {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome binary available");
  // maxRetries handles the race where a previous Chrome on this dir
  // hasn't fully released Cache_Data when we try to rm. Without it
  // sequential tests sharing dataDir flake on ENOTEMPTY ~10% of runs.
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const proc = spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore", detached: false });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/json/version`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    proc,
    port,
    kill: () => { try { proc.kill("SIGTERM"); } catch { /* ignore */ } },
  };
}

export async function getTargets(port) {
  const r = await fetch(`http://localhost:${port}/json/list`);
  return r.json();
}

// One CDP session per page target. Wraps the WS so callers don't have
// to assemble JSON-RPC frames or maintain id→promise maps themselves.
export class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const data = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString();
      const msg = JSON.parse(data);
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const ls = this.listeners.get(msg.method);
        if (ls) for (const fn of ls) try { fn(msg.params); } catch { /* swallow */ }
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

export async function connectSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("ws connect failed")), { once: true });
  });
  const s = new Session(ws);
  await s.send("Page.enable");
  await s.send("Runtime.enable");
  return s;
}

// JS evaluation in the page context. `await` is on by default for
// promise-returning expressions; tests almost always want the resolved
// value. Throws if the expression itself throws — callers catch as
// needed (most don't, because the test should fail loud on JS errors).
export async function evalExpr(s, expr, { awaitPromise = true, returnByValue = true } = {}) {
  const r = await s.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise,
    returnByValue,
  });
  if (r.exceptionDetails) {
    const m = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error("eval threw: " + m);
  }
  return r.result?.value;
}

export async function navigate(s, url) {
  const loaded = new Promise((res) => s.on("Page.loadEventFired", res));
  await s.send("Page.navigate", { url });
  await loaded;
}

// Polls `expr` until it returns a truthy value or `timeoutMs` elapses.
// `expr` may be sync or async. Returns the value, or throws.
export async function waitFor(s, expr, { timeoutMs = 15000, pollMs = 150 } = {}) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    let v;
    try {
      v = await evalExpr(
        s,
        `(async () => { try { return await (${expr}); } catch { return null; } })()`,
      );
    } catch (e) { lastErr = e.message; }
    if (v) return v;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`waitFor timed out: ${String(expr).slice(0, 100)}... last=${lastErr}`);
}
