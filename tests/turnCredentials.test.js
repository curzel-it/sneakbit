// TURN REST API endpoint: HMAC-SHA1 ephemeral credentials a coturn
// configured with `use-auth-secret` will accept.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { startServer } from "../server/index.js";
import {
  buildCredentials,
  isTurnConfigured,
  parseUrls,
  handleTurnRequest,
} from "../server/turnCredentials.js";

test("buildCredentials produces username/credential coturn will accept", () => {
  const secret = "test-secret";
  const now = 1_700_000_000_000;
  const creds = buildCredentials({
    secret, urls: "turn:turn.example.com:3478", now, ttlSeconds: 600,
  });
  assert.ok(creds);
  assert.equal(creds.ttl, 600);
  assert.equal(creds.expiresAt, 1_700_000_000 + 600);
  assert.equal(creds.iceServers.length, 1);
  const server = creds.iceServers[0];
  assert.equal(server.urls, "turn:turn.example.com:3478");
  assert.equal(server.username, String(creds.expiresAt));
  // Reproducible HMAC — what coturn would compute on its side.
  const expected = createHmac("sha1", secret).update(String(creds.expiresAt)).digest("base64");
  assert.equal(server.credential, expected);
});

test("buildCredentials splits a comma-separated TURN_URLS env var", () => {
  const creds = buildCredentials({
    secret: "s", urls: "turn:a.example:3478, turns:a.example:5349",
  });
  assert.equal(creds.iceServers.length, 2);
  assert.equal(creds.iceServers[0].urls, "turn:a.example:3478");
  assert.equal(creds.iceServers[1].urls, "turns:a.example:5349");
});

test("buildCredentials returns null when secret or urls are missing", () => {
  assert.equal(buildCredentials({ secret: "", urls: "turn:x" }), null);
  assert.equal(buildCredentials({ secret: "s", urls: "" }), null);
});

test("isTurnConfigured reflects the env", () => {
  assert.equal(isTurnConfigured({ TURN_SECRET: "s", TURN_URLS: "turn:x" }), true);
  assert.equal(isTurnConfigured({ TURN_SECRET: "s" }), false);
  assert.equal(isTurnConfigured({}), false);
});

test("parseUrls strips whitespace and drops empties", () => {
  assert.deepEqual(parseUrls("a, b ,,c"), ["a", "b", "c"]);
  assert.deepEqual(parseUrls(""), []);
  assert.deepEqual(parseUrls(undefined), []);
});

test("handleTurnRequest: 503 when env is missing", () => {
  const res = makeMockRes();
  handleTurnRequest({ method: "GET" }, res, {});
  assert.equal(res.statusCode, 503);
});

test("handleTurnRequest: 200 + json when configured", () => {
  const res = makeMockRes();
  handleTurnRequest(
    { method: "GET" }, res,
    { TURN_SECRET: "s", TURN_URLS: "turn:x:3478" },
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.iceServers.length, 1);
  assert.equal(body.iceServers[0].urls, "turn:x:3478");
  assert.ok(body.expiresAt > Date.now() / 1000);
});

test("handleTurnRequest: 405 on non-GET", () => {
  const res = makeMockRes();
  handleTurnRequest({ method: "POST" }, res, { TURN_SECRET: "s", TURN_URLS: "turn:x" });
  assert.equal(res.statusCode, 405);
});

test("HTTP route /turn-credentials is wired end-to-end (503 without env)", async () => {
  const s = await startServer({ port: 0, host: "127.0.0.1" });
  try {
    const res = await fetch(`http://${s.host}:${s.port}/turn-credentials`);
    assert.equal(res.status, 503);
  } finally {
    await s.close();
  }
});

function makeMockRes() {
  return {
    statusCode: 0,
    headers: null,
    body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body || ""; },
  };
}
