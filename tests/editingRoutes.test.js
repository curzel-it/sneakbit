import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, createUser } from "../server/db.js";
import { signToken } from "../server/jwt.js";
import { createEditingHandler } from "../server/editingRoutes.js";

// Spin a real http server routing /editing to the handler, with two users
// seeded — an editor (on the hard-coded allowlist) and a plain account — plus a
// throwaway EDITING_DIR so the filesystem store is isolated per run.
async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), "editing-routes-"));
  const env = { JWT_SECRET: "test-secret", EDITING_DIR: dir };
  const db = openDb(":memory:");
  const editor = createUser(db, { id: "usr_ed", email: "federico@curzel.it", passwordHash: "h", now: 1 });
  const plain = createUser(db, { id: "usr_no", email: "nobody@else.com", passwordHash: "h", now: 1 });
  const editorToken = signToken({ sub: editor.id }, { secret: env.JWT_SECRET });
  const plainToken = signToken({ sub: plain.id }, { secret: env.JWT_SECRET });
  const handler = createEditingHandler({ db, env });
  const server = createServer((req, res) => {
    if (req.url.startsWith("/editing")) { handler(req, res); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { await fn({ base, editorToken, plainToken }); }
  finally { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
}

const H = (token) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });
const get = (base, path, token) => fetch(`${base}${path}`, { headers: H(token) });
const put = (base, path, token, body) => fetch(`${base}${path}`, { method: "PUT", headers: H(token), body: JSON.stringify(body) });
const del = (base, path, token) => fetch(`${base}${path}`, { method: "DELETE", headers: H(token) });

test("requires a valid bearer token", async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/editing/1010`)).status, 401);
    assert.equal((await fetch(`${base}/editing/1010`, { headers: { authorization: "Bearer nope" } })).status, 401);
  });
});

test("a signed-in non-editor is forbidden (403)", async () => {
  await withServer(async ({ base, plainToken }) => {
    assert.equal((await get(base, "/editing/1010", plainToken)).status, 403);
    assert.equal((await put(base, "/editing/1010", plainToken, { blob: { id: 1010 } })).status, 403);
    assert.equal((await get(base, "/editing", plainToken)).status, 403);
  });
});

test("GET is 204 when empty, then PUT → GET round-trips the world (editor)", async () => {
  await withServer(async ({ base, editorToken }) => {
    assert.equal((await get(base, "/editing/1010", editorToken)).status, 204);

    const raw = { id: 1010, biome: "grass", entities: [{ id: -1, species_id: 1019 }] };
    const putRes = await put(base, "/editing/1010", editorToken, { blob: raw });
    assert.equal(putRes.status, 200);
    assert.equal((await putRes.json()).ok, true);

    const got = await (await get(base, "/editing/1010", editorToken)).json();
    assert.deepEqual(got.blob, raw);
  });
});

test("GET /editing lists stored world ids", async () => {
  await withServer(async ({ base, editorToken }) => {
    await put(base, "/editing/1010", editorToken, { blob: { id: 1010 } });
    await put(base, "/editing/-3", editorToken, { blob: { id: -3 } });
    const { ids } = await (await get(base, "/editing", editorToken)).json();
    assert.deepEqual(new Set(ids), new Set(["1010", "-3"]));
  });
});

test("DELETE reverts a world to shipped", async () => {
  await withServer(async ({ base, editorToken }) => {
    await put(base, "/editing/1010", editorToken, { blob: { id: 1010 } });
    assert.equal((await del(base, "/editing/1010", editorToken)).status, 200);
    assert.equal((await get(base, "/editing/1010", editorToken)).status, 204);
  });
});

test("an invalid (non-numeric) id is rejected with 400", async () => {
  await withServer(async ({ base, editorToken }) => {
    assert.equal((await put(base, "/editing/..%2Fpasswd", editorToken, { blob: { x: 1 } })).status, 400);
    assert.equal((await get(base, "/editing/abc", editorToken)).status, 400);
  });
});

test("a non-object blob is rejected with 400", async () => {
  await withServer(async ({ base, editorToken }) => {
    assert.equal((await put(base, "/editing/1010", editorToken, { blob: "nope" })).status, 400);
    assert.equal((await put(base, "/editing/1010", editorToken, {})).status, 400);
  });
});

test("an oversized world is rejected with 413", async () => {
  await withServer(async ({ base, editorToken }) => {
    const huge = "x".repeat(3 * 1024 * 1024);
    assert.equal((await put(base, "/editing/1010", editorToken, { blob: { huge } })).status, 413);
  });
});

test("503 when JWT_SECRET is unset", async () => {
  const db = openDb(":memory:");
  const handler = createEditingHandler({ db, env: {} });
  const server = createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/editing/1010`)).status, 503);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
