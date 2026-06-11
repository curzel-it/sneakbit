// Currency formatting for the store. The key correctness bit is cents-vs-whole:
// JPY is zero-decimal (¥450 means 450, not 4.50); the others divide by 100.

import { test } from "node:test";
import assert from "node:assert/strict";
import { format, getCurrency, SUPPORTED } from "../js/storeCurrency.js";

// Intl output varies by ICU build/locale, so assert on the numeric content
// rather than exact symbol placement: the dollar/euro/pound amount renders as
// "2.99" and the yen amount as a whole "450" with no decimal fraction.
test("non-zero-decimal currencies divide by 100", () => {
  assert.match(format(299, "usd"), /2\.99/);
  assert.match(format(299, "eur"), /2\.99/);
  assert.match(format(299, "gbp"), /2\.99/);
});

test("jpy is whole-yen (no /100, no decimals)", () => {
  const yen = format(450, "jpy");
  assert.match(yen, /450/);
  assert.doesNotMatch(yen, /4\.50/);
});

test("format never throws on a bad currency", () => {
  // Falls back to a plain "CUR value" string instead of throwing.
  const out = format(100, "zzz");
  assert.equal(typeof out, "string");
  assert.ok(out.length > 0);
});

test("getCurrency resolves to a supported currency", () => {
  assert.ok(SUPPORTED.includes(getCurrency()));
});
