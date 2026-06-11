// Browser-facing store endpoints (bearer-authenticated except the public
// catalog). Mirrors authRoutes.js / savesRoutes.js: createPaymentsHandler()
// wires the db + stripe client into one async dispatcher that index.js calls
// for every /store/* request (CORS applied by the caller).
//
//   GET  /store/catalog        (no auth)  -> {items:[…]}            | 503 if disabled
//   POST /store/checkout       (Bearer) {sku, currency} -> {url}   | 401/400/409
//   GET  /store/entitlements   (Bearer)  -> {entitlements:[…]}     | 401
//
// Non-negotiable correctness rules enforced here (see payments-spec.md):
//   * prices/identity come from storeCatalog.js, never the request body;
//   * the buyer is pinned from the auth token (client_reference_id +
//     metadata.userId), not the body — only sku/currency come from the body and
//     both are validated against the catalog.

import { authenticateUser } from "./bearerAuth.js";
import { readJsonBody } from "./httpBody.js";
import { createRateLimiter } from "./rateLimitHttp.js";
import { getStripe } from "./stripe.js";
import { findSku, displayCatalog, CURRENCIES } from "./storeCatalog.js";
import { hasActiveEntitlement, listActiveEntitlements } from "./db.js";
import { log } from "./logger.js";

const ALLOWED_CURRENCIES = new Set(CURRENCIES);

export function createPaymentsHandler({ db, env = process.env, stripe } = {}) {
  // Per-IP checkout cap: a Checkout Session is a Stripe API round-trip, so this
  // is both abuse defense and politeness to Stripe. Generous for real use.
  const checkoutLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

  function stripeClient() {
    return stripe || getStripe(env);
  }

  async function handle(req, res) {
    if (!env.STRIPE_SECRET_KEY) return json(res, 503, { error: "payments_disabled" });
    const path = pathOf(req.url);
    const method = req.method;
    try {
      if (method === "GET" && path === "/store/catalog") return catalog(res);
      if (method === "POST" && path === "/store/checkout") return await checkout(req, res);
      if (method === "GET" && path === "/store/entitlements") return entitlements(req, res);
      return json(res, 404, { error: "not_found" });
    } catch (err) {
      if (err?.code === "BODY_TOO_LARGE") return json(res, 413, { error: "too_large" });
      if (err?.code === "BAD_JSON") return json(res, 400, { error: "bad_json" });
      log.error("store.handlerError", { path, err: err?.message || String(err) });
      return json(res, 500, { error: "server_error" });
    }
  }

  // — Handlers ———————————————————————————————————————————————————————————

  function catalog(res) {
    return json(res, 200, { items: displayCatalog() });
  }

  async function checkout(req, res) {
    if (!checkoutLimiter.check(clientIp(req))) return json(res, 429, { error: "rate_limited" });
    const user = authenticateUser(req, { db, secret: env.JWT_SECRET });
    if (!user) return json(res, 401, { error: "unauthorized" });
    const body = await readJsonBody(req);
    const sku = String(body.sku ?? "");
    const currency = String(body.currency ?? "").toLowerCase();
    const item = findSku(sku);
    if (!item) return json(res, 400, { error: "unknown_sku" });
    if (!ALLOWED_CURRENCIES.has(currency)) return json(res, 400, { error: "unknown_currency" });
    if (hasActiveEntitlement(db, user.id, sku)) return json(res, 409, { error: "already_owned" });

    const stripe = stripeClient();
    if (!stripe) return json(res, 503, { error: "payments_disabled" });

    const base = baseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency,
      line_items: [{ price: item.stripePrice, quantity: 1 }],
      client_reference_id: user.id,        // pinned from the token, not the body
      metadata: { userId: user.id, sku: item.sku },
      customer_email: user.email,
      success_url: `${base}/?purchase=success&sku=${encodeURIComponent(sku)}`,
      cancel_url: `${base}/?purchase=cancel`,
      automatic_tax: { enabled: true },    // remits the tax embedded in the inclusive price
    });
    return json(res, 200, { url: session.url });
  }

  function entitlements(req, res) {
    const user = authenticateUser(req, { db, secret: env.JWT_SECRET });
    if (!user) return json(res, 401, { error: "unauthorized" });
    const rows = listActiveEntitlements(db, user.id).map((r) => ({
      sku: r.sku, kind: r.kind, refId: r.ref_id, grantedAt: r.granted_at,
    }));
    return json(res, 200, { entitlements: rows });
  }

  function baseUrl() {
    return (env.APP_BASE_URL || "https://sneakbit.curzel.it").replace(/\/$/, "");
  }

  return handle;
}

// — Pure helpers ————————————————————————————————————————————————————————

function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj) + "\n");
}

function pathOf(url) {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

// Same trust model as authRoutes.clientIp: nginx overwrites X-Real-IP, and the
// LAST X-Forwarded-For hop is the real one. Socket address is the dev fallback.
function clientIp(req) {
  const real = req.headers?.["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    const hops = xff.split(",");
    return hops[hops.length - 1].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}
