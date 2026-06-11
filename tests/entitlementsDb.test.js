// Store DB helpers: entitlement grant/revoke (idempotent upsert), the purchase
// audit + payment_intent join refunds need, and the webhook de-dup ledger.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDb, createUser,
  grantEntitlement, revokeEntitlement, listActiveEntitlements, hasActiveEntitlement,
  recordPurchase, findPurchaseByPaymentIntent, markPurchaseRefunded,
  recordStripeEvent, stripeEventSeen,
} from "../server/db.js";

function dbWithUser() {
  const db = openDb(":memory:");
  createUser(db, { id: "usr_1", email: "a@b.com", passwordHash: "h", now: 1000 });
  return db;
}

test("grant is idempotent and re-activates after revoke", () => {
  const db = dbWithUser();
  grantEntitlement(db, { userId: "usr_1", sku: "skin.ninja_black", kind: "skin", refId: "ninja_black", now: 1 });
  grantEntitlement(db, { userId: "usr_1", sku: "skin.ninja_black", kind: "skin", refId: "ninja_black", now: 2 });
  assert.equal(listActiveEntitlements(db, "usr_1").length, 1, "replays grant exactly once");
  assert.ok(hasActiveEntitlement(db, "usr_1", "skin.ninja_black"));

  revokeEntitlement(db, { userId: "usr_1", sku: "skin.ninja_black", now: 3 });
  assert.equal(hasActiveEntitlement(db, "usr_1", "skin.ninja_black"), false);
  assert.equal(listActiveEntitlements(db, "usr_1").length, 0);

  // Re-purchase after refund: the same row flips back to active.
  grantEntitlement(db, { userId: "usr_1", sku: "skin.ninja_black", kind: "skin", refId: "ninja_black", now: 4 });
  assert.ok(hasActiveEntitlement(db, "usr_1", "skin.ninja_black"));
  const rows = listActiveEntitlements(db, "usr_1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ref_id, "ninja_black");
  assert.equal(rows[0].granted_at, 4);
});

test("purchase audit + payment_intent join + refund", () => {
  const db = dbWithUser();
  recordPurchase(db, {
    id: "cs_1", userId: "usr_1", sku: "skin.ninja_black",
    paymentIntent: "pi_1", amount: 299, currency: "usd", now: 10,
  });
  const p = findPurchaseByPaymentIntent(db, "pi_1");
  assert.equal(p.id, "cs_1");
  assert.equal(p.status, "paid");
  assert.equal(p.amount, 299);
  assert.equal(findPurchaseByPaymentIntent(db, "pi_unknown"), null);
  assert.equal(findPurchaseByPaymentIntent(db, null), null);

  markPurchaseRefunded(db, "pi_1", 20);
  assert.equal(findPurchaseByPaymentIntent(db, "pi_1").status, "refunded");
});

test("stripe event dedup: seen-check + record", () => {
  const db = dbWithUser();
  // Unseen before recording; seen after.
  assert.equal(stripeEventSeen(db, "evt_1"), false);
  assert.equal(recordStripeEvent(db, { id: "evt_1", type: "checkout.session.completed", now: 1 }), true);
  assert.equal(stripeEventSeen(db, "evt_1"), true);
  // Recording the same id again is a no-op (returns false).
  assert.equal(recordStripeEvent(db, { id: "evt_1", type: "checkout.session.completed", now: 2 }), false);
  // A different id is independent.
  assert.equal(stripeEventSeen(db, "evt_2"), false);
  assert.equal(recordStripeEvent(db, { id: "evt_2", type: "charge.refunded", now: 3 }), true);
});
