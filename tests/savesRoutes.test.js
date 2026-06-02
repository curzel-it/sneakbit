import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb, createUser, updateUser } from "../server/db.js";
import { signToken } from "../server/jwt.js";
import { createSavesHandler } from "../server/savesRoutes.js";

const env = { JWT_SECRET: "test-secret" };

// Spin a real http server routing /saves to the handler, with one user seeded
// and a valid bearer token minted for them.
async function withServer(fn) {
  const db = openDb(":memory:");
  const user = createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", now: 1 });
  const token = signToken({ sub: user.id }, { secret: env.JWT_SECRET });
  const handler = createSavesHandler({ db, env });
  const server = createServer((req, res) => {
    if (req.url.startsWith("/saves")) { handler(req, res); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { await fn({ base, token, db }); } finally { await new Promise((r) => server.close(r)); }
}

const H = (token) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });
const get = (base, token) => fetch(`${base}/saves`, { headers: H(token) });
const put = (base, token, body) => fetch(`${base}/saves`, { method: "PUT", headers: H(token), body: JSON.stringify(body) });
const del = (base, token) => fetch(`${base}/saves`, { method: "DELETE", headers: H(token) });

test("requires a valid bearer token", async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/saves`)).status, 401);
    assert.equal((await fetch(`${base}/saves`, { headers: { authorization: "Bearer nope" } })).status, 401);
  });
});

test("GET is 204 when empty, then PUT → GET round-trips the blob", async () => {
  await withServer(async ({ base, token }) => {
    assert.equal((await get(base, token)).status, 204);

    const putRes = await put(base, token, { blob: { v: 1, kv: { latest_zone: "1010" } }, updatedAt: 1000, baseRev: 0 });
    assert.equal(putRes.status, 200);
    assert.equal((await putRes.json()).rev, 1);

    const got = await (await get(base, token)).json();
    assert.equal(got.rev, 1);
    assert.equal(got.updatedAt, 1000);
    assert.equal(got.blob.kv.latest_zone, "1010");
  });
});

test("a stale baseRev is rejected with 409 + the current cloud copy", async () => {
  await withServer(async ({ base, token }) => {
    await put(base, token, { blob: { v: 1, kv: { latest_zone: "1" } }, updatedAt: 1000, baseRev: 0 }); // rev 1
    // Another writer would have advanced to rev 1; a client still on baseRev 0
    // is stale.
    const conflict = await put(base, token, { blob: { v: 1, kv: { latest_zone: "2" } }, updatedAt: 2000, baseRev: 0 });
    assert.equal(conflict.status, 409);
    const body = await conflict.json();
    assert.equal(body.rev, 1);
    assert.equal(body.blob.kv.latest_zone, "1"); // unchanged — not clobbered

    // Pushing on top of the current rev succeeds.
    const ok = await put(base, token, { blob: { v: 1, kv: { latest_zone: "2" } }, updatedAt: 2000, baseRev: 1 });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).rev, 2);
  });
});

test("DELETE removes the save", async () => {
  await withServer(async ({ base, token }) => {
    await put(base, token, { blob: { v: 1, kv: {} }, updatedAt: 1, baseRev: 0 });
    assert.equal((await del(base, token)).status, 200);
    assert.equal((await get(base, token)).status, 204);
  });
});

test("an oversized blob is rejected with 413", async () => {
  await withServer(async ({ base, token }) => {
    const huge = "x".repeat(300 * 1024);
    const res = await put(base, token, { blob: { v: 1, kv: { huge } }, updatedAt: 1, baseRev: 0 });
    assert.equal(res.status, 413);
  });
});

test("a far-future updatedAt is clamped to server time so it can't win forever", async () => {
  await withServer(async ({ base, token }) => {
    const future = Date.now() + 1_000_000_000; // ~11 days ahead, well past the skew cap
    const res = await put(base, token, { blob: { v: 1, kv: {} }, updatedAt: future, baseRev: 0 });
    assert.equal(res.status, 200);
    const stored = (await res.json()).updatedAt;
    assert.ok(stored < future, "the runaway future value was not stored verbatim");
    assert.ok(stored <= Date.now() + 1000, "clamped to roughly server-now");

    // A near-now timestamp (inside the skew window) is preserved as-is.
    const ok = await put(base, token, { blob: { v: 1, kv: { a: "1" } }, updatedAt: 2000, baseRev: 1 });
    assert.equal((await ok.json()).updatedAt, 2000);
  });
});

test("a token minted before a password change is rejected on /saves", async () => {
  await withServer(async ({ base, db }) => {
    // A token valid now is retired once the password changes to a later
    // second — proving cloud saves honor the same session-invalidation cutoff
    // as the auth routes. (now is anchored to wall-clock so the JWT's exp,
    // checked against Date.now(), stays in the future.)
    const now = Date.now();
    const stale = signToken({ sub: "usr_1" }, { secret: env.JWT_SECRET, now });
    assert.equal((await get(base, stale)).status, 204);
    updateUser(db, "usr_1", { passwordHash: "h2", now: now + 10_000 });
    assert.equal((await get(base, stale)).status, 401);
  });
});

test("503 when JWT_SECRET is unset", async () => {
  const db = openDb(":memory:");
  const handler = createSavesHandler({ db, env: {} });
  const server = createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/saves`)).status, 503);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
