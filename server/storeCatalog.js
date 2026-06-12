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

// One entry per non-default skin in js/skins.js SKINS. `stripePrice` is the
// live Stripe Price id minted by the one-time setup (tools/stripeSetup.mjs);
// re-run it after any catalog change and paste the new ids here. Each Price
// carries currency_options for all four CURRENCIES (tax_behavior:"inclusive").
export const CATALOG = [
  skin("outfit_red", "price_1ThOqCPhPE2cXR2cMqhYVs4j"),
  skin("outfit_yellow", "price_1ThOqDPhPE2cXR2cy2MErSWw"),
  skin("outfit_blue", "price_1ThOqEPhPE2cXR2cZ60cbmf4"),
  skin("tracksuit_black", "price_1ThOqFPhPE2cXR2cOMhbsaiw"),
  skin("ninja_black", "price_1ThOqGPhPE2cXR2coDKWczYV"),
];

// All five launch SKUs share the same flat real-money price (2.99 USD/EUR/GBP;
// JPY ≈ ¥450, a round whole-yen equivalent). Adjust per-skin if that changes.
function skin(refId, stripePrice) {
  return {
    sku: `skin.${refId}`,
    kind: "skin",
    refId,
    nameKey: `skins.name.${refId}`,
    stripePrice,
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
