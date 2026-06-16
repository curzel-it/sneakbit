import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { openDb, createPasswordReset, getSave, putSave, findUserByEmail } from "../server/db.js";
import { createAuthHandler } from "../server/authRoutes.js";
import { signToken } from "../server/jwt.js";

const env = { JWT_SECRET: "test-secret", APP_BASE_URL: "https://example.test" };

// Spin a real http server routing /auth/* to the handler against a fresh
// :memory: db. Exercises the real request-stream + JSON path end to end.
async function withServer(fn) {
  const db = openDb(":memory:");
  const handler = createAuthHandler({ db, env });
  const server = createServer((req, res) => {
    if (req.url.startsWith("/auth/")) { handler(req, res); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { await fn(base, db); } finally { await new Promise((r) => server.close(r)); }
}

function headers(token) {
  const h = { "content-type": "application/json" };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}
const post = (base, path, body, token) => fetch(base + path, { method: "POST", headers: headers(token), body: JSON.stringify(body) });
// POST with extra request headers (used to exercise the rate-limit IP keying).
const postH = (base, path, body, extra) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
const patch = (base, path, body, token) => fetch(base + path, { method: "PATCH", headers: headers(token), body: JSON.stringify(body) });
const get = (base, path, token) => fetch(base + path, { headers: headers(token) });
const del = (base, path, body, token) => fetch(base + path, { method: "DELETE", headers: headers(token), body: JSON.stringify(body) });

test("register -> login -> me happy path", async () => {
  await withServer(async (base) => {
    const reg = await post(base, "/auth/register", { email: "M@B.com", password: "password1", displayName: "Neo" });
    assert.equal(reg.status, 201);
    const regBody = await reg.json();
    assert.ok(regBody.token);
    assert.equal(regBody.user.email, "m@b.com"); // normalized lowercase
    assert.equal(regBody.user.displayName, "Neo");

    const login = await post(base, "/auth/login", { email: "m@b.com", password: "password1" });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.ok(token);

    const me = await get(base, "/auth/me", token);
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, "m@b.com");

    // No / bad token → 401.
    assert.equal((await get(base, "/auth/me")).status, 401);
    assert.equal((await get(base, "/auth/me", "garbage")).status, 401);
  });
});

test("duplicate email 409, bad login 401, weak password 400", async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, "/auth/register", { email: "d@b.com", password: "password1" })).status, 201);
    assert.equal((await post(base, "/auth/register", { email: "d@b.com", password: "password2" })).status, 409);
    assert.equal((await post(base, "/auth/login", { email: "d@b.com", password: "nope" })).status, 401);
    assert.equal((await post(base, "/auth/login", { email: "ghost@b.com", password: "whatever1" })).status, 401);
    assert.equal((await post(base, "/auth/register", { email: "weak@b.com", password: "short" })).status, 400);
    assert.equal((await post(base, "/auth/register", { email: "notanemail", password: "password1" })).status, 400);
  });
});

test("PATCH /auth/me updates profile and changes password (with current pw)", async () => {
  await withServer(async (base) => {
    const { token } = await (await post(base, "/auth/register", { email: "p@b.com", password: "password1", displayName: "Neo" })).json();

    const named = await patch(base, "/auth/me", { displayName: "Trinity" }, token);
    assert.equal((await named.json()).user.displayName, "Trinity");

    // Wrong current password is rejected.
    assert.equal((await patch(base, "/auth/me", { password: "brandnew1", currentPassword: "wrong" }, token)).status, 403);

    // Correct current password succeeds, and the new password then logs in.
    assert.equal((await patch(base, "/auth/me", { password: "brandnew1", currentPassword: "password1" }, token)).status, 200);
    assert.equal((await post(base, "/auth/login", { email: "p@b.com", password: "brandnew1" })).status, 200);
    assert.equal((await post(base, "/auth/login", { email: "p@b.com", password: "password1" })).status, 401);
  });
});

test("forgot -> reset token lifecycle (single-use); old password stops working", async () => {
  await withServer(async (base) => {
    await post(base, "/auth/register", { email: "r@b.com", password: "password1" });

    // email.js is unconfigured in tests, so it logs the reset link via
    // console.warn. Capture the raw token from that log.
    let token = null;
    const orig = console.warn;
    console.warn = (...a) => { const m = a.map(String).join(" ").match(/reset=([a-f0-9]{64})/); if (m) token = m[1]; };
    try {
      assert.equal((await post(base, "/auth/forgot-password", { email: "r@b.com" })).status, 200);
    } finally {
      console.warn = orig;
    }
    assert.ok(token, "captured a reset token from the logged link");

    assert.equal((await post(base, "/auth/reset-password", { token, password: "newpassword1" })).status, 200);
    assert.equal((await post(base, "/auth/login", { email: "r@b.com", password: "newpassword1" })).status, 200);
    assert.equal((await post(base, "/auth/login", { email: "r@b.com", password: "password1" })).status, 401);

    // Single-use: the same token can't be replayed.
    assert.equal((await post(base, "/auth/reset-password", { token, password: "another1pw" })).status, 400);
  });
});

test("an expired reset token is rejected", async () => {
  await withServer(async (base, db) => {
    const { user } = await (await post(base, "/auth/register", { email: "e@b.com", password: "password1" })).json();
    const raw = "deadbeef".repeat(8); // 64 hex chars
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    createPasswordReset(db, { tokenHash, userId: user.id, expiresAt: Date.now() - 1000 });
    assert.equal((await post(base, "/auth/reset-password", { token: raw, password: "newpassword1" })).status, 400);
  });
});

test("forgot-password is enumeration-safe (200 for an unknown email)", async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, "/auth/forgot-password", { email: "nobody@nowhere.com" })).status, 200);
  });
});

test("DELETE /auth/me removes the account (and its cloud save) after a password check", async () => {
  await withServer(async (base, db) => {
    const reg = await (await post(base, "/auth/register", { email: "del@b.com", password: "password1" })).json();
    const token = reg.token;
    // Give the user a cloud save so we can confirm the cascade.
    putSave(db, { userId: reg.user.id, blob: JSON.stringify({ v: 1 }), rev: 1, updatedAt: 1 });
    assert.ok(getSave(db, reg.user.id));

    // Unauthorized + wrong-password are rejected.
    assert.equal((await del(base, "/auth/me", { password: "password1" })).status, 401);
    assert.equal((await del(base, "/auth/me", { password: "wrong" }, token)).status, 403);
    assert.ok(findUserByEmail(db, "del@b.com"), "still present after a failed delete");

    // Correct password deletes the user and cascades to the save.
    assert.equal((await del(base, "/auth/me", { password: "password1" }, token)).status, 200);
    assert.equal(findUserByEmail(db, "del@b.com"), null);
    assert.equal(getSave(db, reg.user.id), null);

    // The email is free to register again, and the old token no longer resolves.
    assert.equal((await post(base, "/auth/register", { email: "del@b.com", password: "password2" })).status, 201);
    // (old token now points at a deleted user → me is 401)
    assert.equal((await get(base, "/auth/me", token)).status, 401);
  });
});

test("password change retires old tokens and returns a fresh one", async () => {
  await withServer(async (base) => {
    const reg = await (await post(base, "/auth/register", { email: "pw@b.com", password: "password1" })).json();
    // Simulate a session token minted before the change (5s earlier) — the
    // realistic case for a token that's been sitting in another device.
    const oldToken = signToken({ sub: reg.user.id }, { secret: env.JWT_SECRET, now: Date.now() - 5000 });

    const res = await patch(base, "/auth/me", { password: "brandnew1", currentPassword: "password1" }, reg.token);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token, "a fresh token is handed back");

    // The pre-change token is now rejected; the fresh one works.
    assert.equal((await get(base, "/auth/me", oldToken)).status, 401);
    assert.equal((await get(base, "/auth/me", body.token)).status, 200);
    assert.equal((await post(base, "/auth/login", { email: "pw@b.com", password: "brandnew1" })).status, 200);
  });
});

test("a successful reset burns every other outstanding reset link", async () => {
  await withServer(async (base) => {
    await post(base, "/auth/register", { email: "multi@b.com", password: "password1" });
    const grabToken = async () => {
      let token = null;
      const orig = console.warn;
      console.warn = (...a) => { const m = a.map(String).join(" ").match(/reset=([a-f0-9]{64})/); if (m) token = m[1]; };
      try { await post(base, "/auth/forgot-password", { email: "multi@b.com" }); }
      finally { console.warn = orig; }
      return token;
    };
    const tokenA = await grabToken();
    const tokenB = await grabToken();
    assert.ok(tokenA && tokenB && tokenA !== tokenB);

    assert.equal((await post(base, "/auth/reset-password", { token: tokenA, password: "newpassword1" })).status, 200);
    // tokenB was still pending but is invalidated by A's successful reset.
    assert.equal((await post(base, "/auth/reset-password", { token: tokenB, password: "another1pw" })).status, 400);
  });
});

test("reset-password rate-limits with 429 once the per-IP budget is spent", async () => {
  await withServer(async (base) => {
    // resetLimiter max is 30/window; an invalid token short-circuits before
    // any hashing, so this is cheap. The 31st request trips the limiter.
    for (let i = 0; i < 30; i++) {
      assert.equal((await post(base, "/auth/reset-password", { token: "deadbeef", password: "password1" })).status, 400);
    }
    assert.equal((await post(base, "/auth/reset-password", { token: "deadbeef", password: "password1" })).status, 429);
  });
});

test("register rate-limits with 429 once the per-IP budget is spent", async () => {
  await withServer(async (base) => {
    // registerLimiter max is 20; an invalid email fails after the limiter
    // check but before hashing, keeping this fast.
    for (let i = 0; i < 20; i++) {
      assert.equal((await post(base, "/auth/register", { email: "notanemail", password: "password1" })).status, 400);
    }
    assert.equal((await post(base, "/auth/register", { email: "notanemail", password: "password1" })).status, 429);
  });
});

test("rate limiting keys on X-Real-IP, not a spoofable X-Forwarded-For", async () => {
  await withServer(async (base) => {
    const body = { token: "deadbeef", password: "password1" };
    // 30 requests sharing X-Real-IP but each carrying a *different* spoofed
    // X-Forwarded-For first hop. If the limiter trusted XFF's first hop, each
    // would land in its own bucket and never trip; keyed on X-Real-IP they
    // share one bucket and the 31st is limited.
    for (let i = 0; i < 30; i++) {
      const r = await postH(base, "/auth/reset-password", body, { "x-real-ip": "9.9.9.9", "x-forwarded-for": `1.2.3.${i}` });
      assert.equal(r.status, 400);
    }
    assert.equal((await postH(base, "/auth/reset-password", body, { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.250" })).status, 429);
    // A different real IP still has its own fresh budget.
    assert.equal((await postH(base, "/auth/reset-password", body, { "x-real-ip": "8.8.8.8" })).status, 400);
  });
});

test("auth returns 503 when JWT_SECRET is unset", async () => {
  const db = openDb(":memory:");
  const handler = createAuthHandler({ db, env: {} });
  const server = createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/auth/me`)).status, 503);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
