// Stripe SDK client, lazily constructed from STRIPE_SECRET_KEY. Mirrors the
// offline-first posture of jwt.js / email.js: when the secret is unset the
// feature is gracefully DISABLED — getStripe() returns null and the payments
// routes answer 503, while the rest of the server runs unchanged.
//
// This is the server's first runtime npm dependency (a locked decision in
// docs/payments-spec.md); the browser stays library-free (hosted Checkout is
// just a redirect, no Stripe.js).

import Stripe from "stripe";

let cached = null;
let cachedKey = null;

export function isPaymentsEnabled(env = process.env) {
  return !!env.STRIPE_SECRET_KEY;
}

// Build (and memoize) the Stripe client for the configured secret key. Returns
// null when payments are disabled. Re-builds if the key changes (tests pass a
// custom env), so the cache never serves a stale client.
export function getStripe(env = process.env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (cached && cachedKey === key) return cached;
  cached = new Stripe(key);
  cachedKey = key;
  return cached;
}
