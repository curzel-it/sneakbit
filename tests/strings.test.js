// String table lookup: active-language hit, English fallback, and the
// raw-key last resort. Mirrors the data/strings.<lang>.json + tr() contract
// that the localized UI depends on.

import { test } from "node:test";
import assert from "node:assert/strict";

const { loadStringsData, tr } = await import("../js/strings.js");

test("empty key returns empty string", () => {
  loadStringsData({}, {});
  assert.equal(tr(""), "");
  assert.equal(tr(null), "");
});

test("active language wins over fallback", () => {
  loadStringsData({ yes: "Sì" }, { yes: "Yes" });
  assert.equal(tr("yes"), "Sì");
});

test("missing key falls back to English", () => {
  loadStringsData({ yes: "Sì" }, { yes: "Yes", no: "No" });
  assert.equal(tr("no"), "No");
});

test("key absent everywhere returns the key itself", () => {
  loadStringsData({ yes: "Sì" }, { yes: "Yes" });
  assert.equal(tr("nonexistent.key"), "nonexistent.key");
});

test("a present-but-empty translation is honored over fallback", () => {
  // `key in table` must drive the lookup, not truthiness — an intentionally
  // blank string (e.g. quest.thugs_and_assassins.mr_bubblegum.intro = "...")
  // should not silently fall through to English.
  loadStringsData({ blank: "" }, { blank: "fallback" });
  assert.equal(tr("blank"), "");
});

test("single-argument load makes the fallback table identical (English mode)", () => {
  loadStringsData({ ok: "Ok" });
  assert.equal(tr("ok"), "Ok");
  assert.equal(tr("missing"), "missing");
});
