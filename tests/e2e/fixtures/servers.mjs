// Spins up the relay (node:http on 8090) and a static server (python3
// on 8000) for the duration of an e2e test, then tears them down.
//
// Static server: the app is no-build vanilla ES modules, so any static
// http server can host it. We default to Python (it's on every Mac and
// every CI image we care about) — but if `python3` isn't found we fall
// back to a tiny built-in Node static server. The fallback is in
// `nodeStaticServer.mjs`.
//
// Ports are configurable per call so multiple tests could in theory run
// in parallel — though as of writing the test runner is serial.

import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

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

export async function startServers({ staticPort = 8000, relayPort = 8090 } = {}) {
  const procs = [];

  // Static server. Prefer python3 (one-liner, no Node-script dance);
  // fall back to a small Node static server if python is unavailable.
  let staticProc;
  if (process.env.STATIC_SERVER !== "node") {
    try {
      staticProc = spawn("python3", ["-m", "http.server", String(staticPort)], {
        cwd: REPO_ROOT, stdio: "ignore",
      });
    } catch { /* will fall through */ }
  }
  if (!staticProc || staticProc.killed) {
    const nodeStaticPath = join(HERE, "nodeStaticServer.mjs");
    if (!existsSync(nodeStaticPath)) throw new Error("no static server available (python3 not found, fallback missing)");
    staticProc = spawn(process.execPath, [nodeStaticPath, String(staticPort), REPO_ROOT], { stdio: "ignore" });
  }
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
