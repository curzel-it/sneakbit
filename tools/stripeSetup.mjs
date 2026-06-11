// One-time (idempotent) Stripe setup for the real-money store. Creates one
// Product per catalog skin and one tax-INCLUSIVE Price per product carrying
// currency_options for all four currencies, then prints the price_… ids to
// paste into server/storeCatalog.js (the `stripePrice` field).
//
// Run with the Stripe SECRET key in the environment (start in TEST mode):
//   STRIPE_SECRET_KEY=sk_test_… node tools/stripeSetup.mjs
//
// It reuses server/stripe.js (the installed SDK + env-key logic) and
// server/storeCatalog.js so prices never drift from the catalog. Re-running is
// safe: existing products/prices (matched by metadata.sku) are reused, not
// duplicated. After pasting the ids, a unit test asserts the catalog amounts
// equal the currency_options read back from Stripe.

import { getStripe } from "../server/stripe.js";
import { CATALOG, CURRENCIES } from "../server/storeCatalog.js";

const DEFAULT_CURRENCY = "usd";

function die(msg) { console.error(msg); process.exit(1); }

const stripe = getStripe(process.env);
if (!stripe) die("STRIPE_SECRET_KEY is not set — export it and retry (use a sk_test_… key first).");

// Find an existing product for this sku (so re-runs don't duplicate), else null.
async function findProduct(sku) {
  try {
    const res = await stripe.products.search({ query: `metadata['sku']:'${sku}'`, limit: 1 });
    return res.data[0] || null;
  } catch {
    return null; // search may be unavailable on brand-new accounts — fall through to create
  }
}

// Find an existing active price for this sku on the product, else null.
async function findPrice(productId, sku) {
  const res = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return res.data.find((p) => p.metadata?.sku === sku) || null;
}

function currencyOptionsFor(item) {
  const opts = {};
  for (const c of CURRENCIES) {
    if (c === DEFAULT_CURRENCY) continue;
    opts[c] = { unit_amount: item.prices[c] };
  }
  return opts;
}

const results = [];
for (const item of CATALOG) {
  let product = await findProduct(item.sku);
  if (!product) {
    product = await stripe.products.create({
      name: `SneakBit skin — ${item.refId}`,
      metadata: { sku: item.sku, refId: item.refId, nameKey: item.nameKey },
    });
    console.log(`created product ${product.id} for ${item.sku}`);
  } else {
    console.log(`reusing product ${product.id} for ${item.sku}`);
  }

  let price = await findPrice(product.id, item.sku);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      currency: DEFAULT_CURRENCY,
      unit_amount: item.prices[DEFAULT_CURRENCY],
      tax_behavior: "inclusive",
      currency_options: currencyOptionsFor(item),
      metadata: { sku: item.sku },
    });
    console.log(`created price   ${price.id} for ${item.sku}`);
  } else {
    console.log(`reusing price   ${price.id} for ${item.sku}`);
  }
  results.push({ sku: item.sku, priceId: price.id });
}

console.log("\nPaste these into server/storeCatalog.js (stripePrice):\n");
for (const r of results) console.log(`  ${r.sku}  ->  ${r.priceId}`);
