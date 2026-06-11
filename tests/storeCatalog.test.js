// Catalog integrity for the real-money store. The catalog is the authoritative
// price/identity source, so a bad refId or sub-minimum price is a ship-blocker.
// Dual pricing (the user's call) means coin/real-money OVERLAP is intended, so
// — unlike the spec's original "either/or" rule — we assert COVERAGE instead:
// every non-default skin must have a real-money SKU.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, ZERO_DECIMAL, CURRENCIES, findSku, displayCatalog } from "../server/storeCatalog.js";
import { SKINS, DEFAULT_SKIN_ID } from "../js/skins.js";

const skinIds = new Set(SKINS.map((s) => s.id));
const nonDefaultSkins = SKINS.filter((s) => s.id !== DEFAULT_SKIN_ID).map((s) => s.id);

// Stripe per-currency minimum charge (smallest unit). usd/eur cents ≈ $0.50,
// gbp ≈ £0.30, jpy ≈ ¥50.
const MINIMUMS = { usd: 50, eur: 50, gbp: 30, jpy: 50 };

test("every catalog refId resolves to a skin in js/skins.js", () => {
  for (const item of CATALOG) {
    assert.equal(item.kind, "skin");
    assert.ok(skinIds.has(item.refId), `unknown refId: ${item.refId}`);
    assert.notEqual(item.refId, DEFAULT_SKIN_ID, "default skin is never sold");
    assert.equal(item.sku, `skin.${item.refId}`);
    assert.equal(item.nameKey, `skins.name.${item.refId}`);
  }
});

test("every non-default skin has a real-money SKU (coverage)", () => {
  const covered = new Set(CATALOG.map((i) => i.refId));
  for (const id of nonDefaultSkins) {
    assert.ok(covered.has(id), `skin ${id} has no catalog SKU`);
  }
});

test("prices cover all four currencies and clear Stripe minimums", () => {
  for (const item of CATALOG) {
    for (const c of CURRENCIES) {
      const amount = item.prices[c];
      assert.ok(Number.isInteger(amount), `${item.sku} ${c} must be an integer smallest-unit amount`);
      assert.ok(amount >= MINIMUMS[c], `${item.sku} ${c}=${amount} below Stripe minimum ${MINIMUMS[c]}`);
    }
  }
});

test("zero-decimal currency (jpy) is a whole unit", () => {
  assert.ok(ZERO_DECIMAL.has("jpy"));
  // JPY amounts are whole yen — a value like 450 means ¥450, not ¥4.50.
  for (const item of CATALOG) {
    assert.ok(item.prices.jpy >= 50, `${item.sku} jpy too small`);
  }
});

test("findSku + displayCatalog", () => {
  const first = CATALOG[0];
  assert.equal(findSku(first.sku).refId, first.refId);
  assert.equal(findSku("nope"), null);
  const display = displayCatalog();
  assert.equal(display.length, CATALOG.length);
  for (const d of display) {
    assert.equal(d.stripePrice, undefined, "displayCatalog must not leak the Stripe price id");
    assert.ok(d.sku && d.prices);
  }
});
