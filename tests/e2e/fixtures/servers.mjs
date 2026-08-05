// Spins up the relay (node:http on 8090) and a static server (python or
// the Node fallback, on 8000) for the duration of an e2e test, then
// tears them down.
//
// Static server: the app is no-build vanilla ES modules, so any static
// http server can host it. We prefer Python (it's on every Mac and every
// CI image we care about) — trying `python3` then `python` (Windows
// usually only has the unversioned name) — and fall back to a tiny
// built-in Node static server if neither binds. The fallback lives in
// `nodeStaticServer.mjs`. Set STATIC_SERVER=node to force it directly.
//
// Ports default to whatever the OS has free; callers can still pin them
// explicitly, but nothing in the suite does. That's what lets tests run
// back-to-back (or in parallel) without tripping over each other.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

// Ask the OS for an unused port by binding :0 and reading it back. There
// is a small window between closing here and the child binding, but it
// beats a fixed number that is guaranteed to clash with the next test.
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function isPortListening(port, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) });
      if (r) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// Resolves true as soon as `port` is listening, or false the moment the
// process errors (ENOENT — binary missing) / exits / the timeout lapses.
// The early-out on 'error' is what makes a missing `python3` fall through
// to the next candidate quickly instead of blocking the full timeout.
function settleSpawn(proc, port) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    proc.once("error", () => finish(false));
    proc.once("exit", () => finish(false));
    isPortListening(port).then(finish);
  });
}

async function startStaticServer(staticPort) {
  const nodeStaticPath = join(HERE, "nodeStaticServer.mjs");
  const spawnNode = () => spawn(process.execPath, [nodeStaticPath, String(staticPort), REPO_ROOT], { stdio: "ignore" });

  if (process.env.STATIC_SERVER === "node") {
    if (!existsSync(nodeStaticPath)) throw new Error("STATIC_SERVER=node but nodeStaticServer.mjs is missing");
    return spawnNode();
  }

  // Prefer python; fall through to the Node static server if no
  // interpreter binds. Each candidate is killed before trying the next
  // so we don't leak a half-started process.
  for (const cmd of ["python3", "python"]) {
    const proc = spawn(cmd, ["-m", "http.server", String(staticPort)], { cwd: REPO_ROOT, stdio: "ignore" });
    proc.on("error", () => { /* swallow ENOENT; settleSpawn already saw it */ });
    if (await settleSpawn(proc, staticPort)) return proc;
    try { proc.kill("SIGTERM"); } catch { /* ignore */ }
  }

  if (!existsSync(nodeStaticPath)) throw new Error("no static server available (python not found, Node fallback missing)");
  return spawnNode();
}

export async function startServers({ staticPort, relayPort } = {}) {
  // Default to ports the OS says are free rather than numbers picked by
  // hand. Hand-picked ports collided between test files (and with a dev
  // server on the same machine), and the failure was silent: startServers
  // probes "is this port listening?", which a stranger's server answers
  // just as happily as ours, so the test proceeded against the wrong
  // backend and failed much later for reasons that looked unrelated.
  staticPort = staticPort ?? await freePort();
  relayPort = relayPort ?? await freePort();
  const procs = [];

  const staticProc = await startStaticServer(staticPort);
  procs.push(staticProc);

  // Relay.
  const relayProc = spawn(process.execPath, [join(REPO_ROOT, "server", "index.js")], {
    cwd: REPO_ROOT, stdio: "ignore",
    env: { ...process.env, PORT: String(relayPort) },
  });
  procs.push(relayProc);

  // Wait until both are listening.
  const okStatic = await isPortListening(staticPort);
  const okRelay = await isPortListening(relayPort);
  if (!okStatic || !okRelay) {
    for (const p of procs) try { p.kill("SIGTERM"); } catch { /* ignore */ }
    throw new Error(`servers failed to start (static=${okStatic}, relay=${okRelay})`);
  }

  return {
    staticPort,
    relayPort,
    relayWs: `ws://127.0.0.1:${relayPort}/ws`,
    appUrl: `http://127.0.0.1:${staticPort}`,
    stop: () => { for (const p of procs) try { p.kill("SIGTERM"); } catch { /* ignore */ } },
  };
}
