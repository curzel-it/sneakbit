// String table lookup: active-language hit, English fallback, and the
// raw-key last resort. Mirrors the data/strings.<lang>.json + tr() contract
// that the localized UI depends on.

import { test } from "node:test";
import assert from "node:assert/strict";

const { loadStringsData, tr, trVariant } = await import("../js/strings.js");

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

test("trVariant: desktop ignores the .mobile variant", () => {
  loadStringsData({
    "hint.throw": "Press F to throw",
    "hint.throw.mobile": "Tap the knife button",
  });
  assert.equal(trVariant("hint.throw", false), "Press F to throw");
});

test("trVariant: touch prefers the .mobile variant", () => {
  loadStringsData({
    "hint.throw": "Press F to throw",
    "hint.throw.mobile": "Tap the knife button",
  });
  assert.equal(trVariant("hint.throw", true), "Tap the knife button");
});

test("trVariant: touch falls back to base when no .mobile variant exists", () => {
  loadStringsData({ "hint.pickup": "Walk over objects to grab them" });
  assert.equal(trVariant("hint.pickup", true), "Walk over objects to grab them");
});

test("trVariant: a present-but-empty .mobile variant hides the hint on touch", () => {
  // "Swing the sword with R or Q" is keyboard-only; its .mobile variant is
  // intentionally blank so nothing shows on touch. Presence, not truthiness,
  // must drive the choice — otherwise it falls through to the desktop text.
  loadStringsData({
    "hint.sword": "Swing the sword with R or Q",
    "hint.sword.mobile": "",
  });
  assert.equal(trVariant("hint.sword", true), "");
  assert.equal(trVariant("hint.sword", false), "Swing the sword with R or Q");
});

test("trVariant: a blank base with a touch-only variant shows only on touch", () => {
  loadStringsData({
    "hint.move_button": "",
    "hint.move_button.mobile": "Hold the button to reposition it",
  });
  assert.equal(trVariant("hint.move_button", false), "");
  assert.equal(trVariant("hint.move_button", true), "Hold the button to reposition it");
});

test("trVariant: .mobile resolves through the English fallback table too", () => {
  loadStringsData({ "hint.x": "IT base" }, { "hint.x": "EN base", "hint.x.mobile": "EN mobile" });
  assert.equal(trVariant("hint.x", true), "EN mobile");
});

test("trVariant: empty key returns empty string", () => {
  loadStringsData({});
  assert.equal(trVariant("", true), "");
  assert.equal(trVariant(null, false), "");
});
