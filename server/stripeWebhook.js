// Stripe webhook — the SOURCE OF TRUTH for entitlements (never the success
// redirect). Entitlements are granted server-side on the signature-verified
// checkout.session.completed event; refunds/disputes revoke them. Registered
// OUTSIDE the browser CORS/bearer path in index.js — it's server-to-server.
//
//   POST /webhooks/stripe   (no auth, signature-verified)
//
// Correctness rules enforced here (payments-spec.md):
//   * signature verified over the RAW body bytes — reject 400 otherwise;
//   * events de-duplicated via stripe_events (Stripe re-delivers) so a replay
//     grants exactly once;
//   * payment_status === "paid" required before granting;
//   * grants idempotent (db.grantEntitlement upserts).
// Always ack 200 once handled so Stripe stops retrying; 4xx only on
// signature/parse failure.

import { readRawBody } from "./httpBody.js";
import { getStripe } from "./stripe.js";
import { findSku } from "./storeCatalog.js";
import {
  stripeEventSeen, recordStripeEvent, recordPurchase, grantEntitlement,
  findPurchaseByPaymentIntent, markPurchaseRefunded, revokeEntitlement,
} from "./db.js";
import { log } from "./logger.js";

export function createStripeWebhookHandler({ db, env = process.env, stripe } = {}) {
  function stripeClient() {
    return stripe || getStripe(env);
  }

  async function handle(req, res) {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      return text(res, 503, "payments disabled");
    }
    if (req.method !== "POST" || pathOf(req.url) !== "/webhooks/stripe") {
      return text(res, 404, "not found");
    }
    const sc = stripeClient();
    if (!sc) return text(res, 503, "payments disabled");

    let raw;
    try {
      raw = await readRawBody(req, { maxBytes: 1024 * 1024 });
    } catch (err) {
      if (err?.code === "BODY_TOO_LARGE") return text(res, 413, "too large");
      return text(res, 400, "bad body");
    }

    // Verify the signature over the EXACT bytes Stripe sent. Any failure here
    // means we don't trust the payload — reject without processing.
    let event;
    try {
      event = sc.webhooks.constructEvent(
        raw, req.headers["stripe-signature"], env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      log.warn("stripe.badSignature", { err: err?.message || String(err) });
      return text(res, 400, "bad signature");
    }

    const now = Date.now();
    // De-dup: a replay of an already-processed event acks 200 and stops.
    if (stripeEventSeen(db, event.id)) {
      return text(res, 200, "ok (duplicate)");
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          handleCheckoutCompleted(event.data.object, now);
          break;
        case "charge.refunded":
        case "charge.dispute.created":
          handleRefund(event.data.object, now);
          break;
        default:
          // Subscribed-but-unhandled types still ack so Stripe stops retrying.
          break;
      }
    } catch (err) {
      log.error("stripe.handlerError", { type: event.type, err: err?.message || String(err) });
      // Surface a 500 WITHOUT recording the event, so Stripe retries and we
      // re-process. Grants are idempotent (upsert), so a retry can't double-grant.
      return text(res, 500, "processing error");
    }
    // Record only after a clean run — the dedup gate above then short-circuits
    // any redelivery. INSERT OR IGNORE tolerates a racing duplicate.
    recordStripeEvent(db, { id: event.id, type: event.type, now });
    return text(res, 200, "ok");
  }

  // checkout.session.completed: require paid, then record the purchase + grant
  // the entitlement. metadata.userId/sku were pinned from the token at checkout.
  function handleCheckoutCompleted(session, now) {
    if (!session || session.payment_status !== "paid") return;
    const userId = session.metadata?.userId;
    const sku = session.metadata?.sku;
    if (!userId || !sku) return;
    const item = findSku(sku);
    if (!item) { log.warn("stripe.unknownSku", { sku }); return; }
    recordPurchase(db, {
      id: session.id,
      userId,
      sku,
      paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      amount: session.amount_total ?? 0,
      currency: session.currency ?? "",
      now,
    });
    grantEntitlement(db, { userId, sku, kind: item.kind, refId: item.refId, now });
  }

  // charge.refunded / charge.dispute.created carry a payment_intent, not a sku —
  // join back to the purchase to find (user, sku), then revoke.
  function handleRefund(obj, now) {
    const pi = typeof obj?.payment_intent === "string" ? obj.payment_intent : null;
    const purchase = findPurchaseByPaymentIntent(db, pi);
    if (!purchase) return;
    markPurchaseRefunded(db, pi, now);
    revokeEntitlement(db, { userId: purchase.user_id, sku: purchase.sku, now });
  }

  return handle;
}

function text(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body + "\n");
}

function pathOf(url) {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}
