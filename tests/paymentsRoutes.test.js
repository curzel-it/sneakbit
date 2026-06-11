// Browser-facing store routes. Uses a stub Stripe client (no network) so the
// checkout path is exercised without real Stripe. Asserts the disabled-503
// gate, sku/currency validation, auth gating, already-owned, and the
// entitlements list. Mirrors authRoutes.test.js's real-http-server shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb, createUser, grantEntitlement } from "../server/db.js";
import { createPaymentsHandler } from "../server/paymentsRoutes.js";
import { signToken } from "../server/jwt.js";

const JWT_SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// A stub Stripe client recording the args it was called with.
function stubStripe() {
  const calls = [];
  return {
    calls,
    checkout: { sessions: { create: async (args) => { calls.push(args); return { url: "https://stripe.test/cs_123" }; } } },
  };
}

async function withServer({ enabled = true, stripe } = {}, fn) {
  const db = openDb(":memory:");
  createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", now: 1000 });
  const env = { JWT_SECRET, APP_BASE_URL: "https://example.test" };
  if (enabled) env.STRIPE_SECRET_KEY = "sk_test_dummy";
  const handler = createPaymentsHandler({ db, env, stripe });
  const server = createServer((req, res) => {
    if (req.url.startsWith("/store")) { handler(req, res); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { await fn(base, db); } finally { await new Promise((r) => server.close(r)); }
}

const token = () => signToken({ sub: "usr_1" }, { secret: JWT_SECRET });
const auth = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });

test("catalog is 503 when payments are disabled", async () => {
  await withServer({ enabled: false }, async (base) => {
    const res = await fetch(base + "/store/catalog");
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "payments_disabled");
  });
});

test("catalog lists items when enabled (no auth)", async () => {
  await withServer({ stripe: stubStripe() }, async (base) => {
    const res = await fetch(base + "/store/catalog");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.items) && body.items.length > 0);
    assert.equal(body.items[0].stripePrice, undefined);
  });
});

test("checkout requires auth", async () => {
  await withServer({ stripe: stubStripe() }, async (base) => {
    const res = await fetch(base + "/store/checkout", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "skin.ninja_black", currency: "eur" }),
    });
    assert.equal(res.status, 401);
  });
});

test("checkout validates sku and currency, pins userId from token", async () => {
  const stripe = stubStripe();
  await withServer({ stripe }, async (base) => {
    const bad1 = await fetch(base + "/store/checkout", {
      method: "POST", headers: auth(token()), body: JSON.stringify({ sku: "nope", currency: "eur" }),
    });
    assert.equal(bad1.status, 400);
    assert.equal((await bad1.json()).error, "unknown_sku");

    const bad2 = await fetch(base + "/store/checkout", {
      method: "POST", headers: auth(token()), body: JSON.stringify({ sku: "skin.ninja_black", currency: "chf" }),
    });
    assert.equal(bad2.status, 400);
    assert.equal((await bad2.json()).error, "unknown_currency");

    const ok = await fetch(base + "/store/checkout", {
      method: "POST", headers: auth(token()), body: JSON.stringify({ sku: "skin.ninja_black", currency: "eur" }),
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).url, "https://stripe.test/cs_123");
    // The session was built from the token's user + the catalog, not the body.
    const call = stripe.calls[0];
    assert.equal(call.client_reference_id, "usr_1");
    assert.equal(call.metadata.userId, "usr_1");
    assert.equal(call.metadata.sku, "skin.ninja_black");
    assert.equal(call.currency, "eur");
    assert.equal(call.customer_email, "a@b.com");
  });
});

test("checkout 409 when already owned", async () => {
  await withServer({ stripe: stubStripe() }, async (base, db) => {
    grantEntitlement(db, { userId: "usr_1", sku: "skin.ninja_black", kind: "skin", refId: "ninja_black", now: 1 });
    const res = await fetch(base + "/store/checkout", {
      method: "POST", headers: auth(token()), body: JSON.stringify({ sku: "skin.ninja_black", currency: "eur" }),
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "already_owned");
  });
});

test("entitlements lists the user's active grants", async () => {
  await withServer({ stripe: stubStripe() }, async (base, db) => {
    grantEntitlement(db, { userId: "usr_1", sku: "skin.ninja_black", kind: "skin", refId: "ninja_black", now: 5 });
    const res = await fetch(base + "/store/entitlements", { headers: auth(token()) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entitlements.length, 1);
    assert.deepEqual(body.entitlements[0], { sku: "skin.ninja_black", kind: "skin", refId: "ninja_black", grantedAt: 5 });
  });
});
