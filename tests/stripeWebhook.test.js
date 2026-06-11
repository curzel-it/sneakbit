// Webhook handler — the source of truth for entitlements. Uses the real Stripe
// SDK to build signed test events (stripe.webhooks.generateTestHeaderString)
// against a known secret, so signature verification runs the real path. Asserts
// grant on checkout.session.completed, revoke on charge.refunded, exactly-once
// on a replayed event (dedup), and 400 on a bad signature.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb, createUser, listActiveEntitlements, hasActiveEntitlement, findPurchaseByPaymentIntent } from "../server/db.js";
import { createStripeWebhookHandler } from "../server/stripeWebhook.js";
import { getStripe } from "../server/stripe.js";

const env = { STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_test_secret" };
const stripe = getStripe(env); // local crypto only — no network for sign/verify

function sign(payload) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
}

async function withServer(fn) {
  const db = openDb(":memory:");
  createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", now: 1000 });
  const handler = createStripeWebhookHandler({ db, env, stripe });
  const server = createServer((req, res) => {
    if (req.url.startsWith("/webhooks/stripe")) { handler(req, res); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { await fn(base, db); } finally { await new Promise((r) => server.close(r)); }
}

function post(base, payload, signature) {
  return fetch(base + "/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature ?? sign(payload) },
    body: payload,
  });
}

const completedEvent = (id = "evt_1") => JSON.stringify({
  id, type: "checkout.session.completed",
  data: { object: {
    id: "cs_1", payment_status: "paid", payment_intent: "pi_1",
    amount_total: 299, currency: "usd",
    metadata: { userId: "usr_1", sku: "skin.ninja_black" },
  } },
});

test("checkout.session.completed grants the entitlement + records the purchase", async () => {
  await withServer(async (base, db) => {
    const res = await post(base, completedEvent());
    assert.equal(res.status, 200);
    assert.ok(hasActiveEntitlement(db, "usr_1", "skin.ninja_black"));
    const rows = listActiveEntitlements(db, "usr_1");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ref_id, "ninja_black");
    const purchase = findPurchaseByPaymentIntent(db, "pi_1");
    assert.equal(purchase.id, "cs_1");
    assert.equal(purchase.amount, 299);
  });
});

test("a replayed event grants exactly once (dedup)", async () => {
  await withServer(async (base, db) => {
    await post(base, completedEvent("evt_dup"));
    const replay = await post(base, completedEvent("evt_dup"));
    assert.equal(replay.status, 200);
    assert.match(await replay.text(), /duplicate/);
    assert.equal(listActiveEntitlements(db, "usr_1").length, 1);
  });
});

test("charge.refunded revokes the entitlement", async () => {
  await withServer(async (base, db) => {
    await post(base, completedEvent());
    assert.ok(hasActiveEntitlement(db, "usr_1", "skin.ninja_black"));

    const refund = JSON.stringify({
      id: "evt_refund", type: "charge.refunded",
      data: { object: { payment_intent: "pi_1" } },
    });
    const res = await post(base, refund);
    assert.equal(res.status, 200);
    assert.equal(hasActiveEntitlement(db, "usr_1", "skin.ninja_black"), false);
    assert.equal(findPurchaseByPaymentIntent(db, "pi_1").status, "refunded");
  });
});

test("a bad signature is rejected with 400 and grants nothing", async () => {
  await withServer(async (base, db) => {
    const res = await post(base, completedEvent("evt_bad"), "t=1,v1=deadbeef");
    assert.equal(res.status, 400);
    assert.equal(listActiveEntitlements(db, "usr_1").length, 0);
  });
});

test("unpaid session does not grant", async () => {
  await withServer(async (base, db) => {
    const unpaid = JSON.stringify({
      id: "evt_unpaid", type: "checkout.session.completed",
      data: { object: { id: "cs_2", payment_status: "unpaid", metadata: { userId: "usr_1", sku: "skin.ninja_black" } } },
    });
    const res = await post(base, unpaid);
    assert.equal(res.status, 200); // acked so Stripe stops retrying…
    assert.equal(listActiveEntitlements(db, "usr_1").length, 0); // …but nothing granted
  });
});
