// Smoke tests for the HTTP-side endpoints exposed by the relay
// process: /health (text), /version (JSON), /metrics (JSON). These
// don't speak WS — they're for nginx upstream probes and ops tooling.

import { test } from "node:test";
import assert from "node:assert/strict";

// index.js resolves GIT_SHA once at module-load (so /version is cheap
// on every call). Set the env var BEFORE the dynamic import so the test
// gets a deterministic SHA rather than the working-tree HEAD.
process.env.GIT_SHA = "deadbeefcafebabe";
const { startServer } = await import("../server/index.js");

async function bootServer() {
  const { close, port } = await startServer({
    port: 0, host: "127.0.0.1",
    graceMs: 50, idleTimeoutMs: 5000, idleCheckMs: 5000,
  });
  return { close, base: `http://127.0.0.1:${port}` };
}

test("/health returns 200 ok", async () => {
  const { close, base } = await bootServer();
  try {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    assert.equal((await r.text()).trim(), "ok");
  } finally { await close(); }
});

test("/version returns the baked GIT_SHA and a startedAt", async () => {
  const { close, base } = await bootServer();
  try {
    const r = await fetch(`${base}/version`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    const body = await r.json();
    assert.equal(body.git, "deadbeefcafebabe");
    assert.match(body.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally { await close(); }
});

test("/metrics returns the counter snapshot in JSON", async () => {
  const { close, base } = await bootServer();
  try {
    const r = await fetch(`${base}/metrics`);
    assert.equal(r.status, 200);
    const m = await r.json();
    // Shape only — no traffic yet, so counters are zeros.
    assert.equal(m.connections.current, 0);
    assert.equal(m.sessions.current, 0);
    assert.equal(m.sessions.totalOpened, 0);
    assert.equal(m.bytesRelayed, 0);
    assert.equal(typeof m.uptimeSeconds, "number");
    assert.match(m.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(m.drops.perOp, 0);
  } finally { await close(); }
});

test("unknown HTTP path returns 404 with CORS headers (so the browser console isn't noisy)", async () => {
  const { close, base } = await bootServer();
  try {
    const r = await fetch(`${base}/does-not-exist`);
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
  } finally { await close(); }
});
