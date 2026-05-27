// Integration check: the upgrade handler rejects browser-origin WS
// connections that aren't on the allowlist. Origin-less (non-browser)
// connections still succeed — see originAllowlist.js for why.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server/index.js";
import { openWsClient } from "./helpers/wsTestClient.js";
import { toTestUuid } from "./helpers/testUuids.js";

async function withServer(opts, fn) {
  const s = await startServer({ port: 0, host: "127.0.0.1", graceMs: 80, ...opts });
  try { await fn(s); } finally { await s.close(); }
}

test("a WS upgrade from an allowed Origin succeeds", async () => {
  await withServer({ allowedOrigins: "curzel.it,localhost" }, async ({ host, port }) => {
    const c = await openWsClient(host, port, "/ws", { origin: "https://curzel.it" });
    c.send({ op: "hello", protocol: 1, uuid: toTestUuid("u-allowed"), client: "test" });
    const w = await c.recv();
    assert.equal(w.op, "welcome");
    c.close();
  });
});

test("a WS upgrade from an unknown Origin is rejected with 403", async () => {
  await withServer({ allowedOrigins: "curzel.it" }, async ({ host, port }) => {
    await assert.rejects(
      openWsClient(host, port, "/ws", { origin: "https://evil.example.com" }),
      /handshake failed.*403/,
    );
  });
});

test("a WS upgrade with no Origin (non-browser tooling) still succeeds", async () => {
  // Default test client doesn't send Origin — the entire existing
  // session-test suite relies on this. Re-pin the contract.
  await withServer({ allowedOrigins: "curzel.it" }, async ({ host, port }) => {
    const c = await openWsClient(host, port);
    c.send({ op: "hello", protocol: 1, uuid: toTestUuid("u-no-origin"), client: "test" });
    const w = await c.recv();
    assert.equal(w.op, "welcome");
    c.close();
  });
});
