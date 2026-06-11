// Authoritative real-money catalog — the ONLY place store prices and product
// identity live (a non-negotiable correctness rule: the client only displays a
// price; the server builds the Checkout Session from this catalog). Each entry
// maps a `sku` to its in-game effect (kind/refId) and its Stripe Price.
//
// Prices are the smallest currency unit, tax-INCLUSIVE: each amount is the
// final gross total the player pays AND the number the shop displays — the same
// number by construction (the Stripe Prices carry tax_behavior:"inclusive").
// Zero-decimal currencies (JPY) are whole units, not 1/100.
//
// Per the user's call this launches with DUAL pricing: every non-default hero
// skin keeps its coin price in the shop (data/12900001.json) AND gains a
// real-money SKU here at the same flat price (≈2.99). The four amounts below
// are simultaneously the displayed and charged price.

// Stripe's zero-decimal currency list; we use JPY.
export const ZERO_DECIMAL = new Set(["jpy"]);

// The four currencies we author prices in (locked decision).
export const CURRENCIES = ["usd", "eur", "gbp", "jpy"];

// One entry per non-default skin in js/skins.js SKINS. `stripePrice` is a
// placeholder until the one-time Stripe setup (tools/stripeSetup.mjs) mints the
// real price_… ids; with no STRIPE_SECRET_KEY the routes are 503 anyway.
export const CATALOG = [
  skin("outfit_red"),
  skin("outfit_yellow"),
  skin("outfit_blue"),
  skin("tracksuit_black"),
  skin("ninja_black"),
];

// All five launch SKUs share the same flat real-money price (2.99 USD/EUR/GBP;
// JPY ≈ ¥450, a round whole-yen equivalent). Adjust per-skin if that changes.
function skin(refId) {
  return {
    sku: `skin.${refId}`,
    kind: "skin",
    refId,
    nameKey: `skins.name.${refId}`,
    stripePrice: "price_XXXX",
    prices: { usd: 299, eur: 299, gbp: 299, jpy: 450 },
  };
}

const bySku = new Map(CATALOG.map((e) => [e.sku, e]));

export function findSku(sku) {
  return bySku.get(sku) || null;
}

// The browser-facing view: drops the server-only stripePrice id.
export function displayCatalog() {
  return CATALOG.map(({ stripePrice, ...rest }) => rest);
}
