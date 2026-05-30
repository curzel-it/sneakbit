// resolveLanguage: an explicit, supported preference is returned verbatim;
// an unsupported one falls through to English. (The "auto" → navigator.language
// path is browser-only — Node ships a read-only `navigator` we can't stub —
// so it's covered manually rather than here.)

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = (() => {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
})();

const { saveSettings, resolveLanguage, SUPPORTED_LANGUAGES } =
  await import("../js/settings.js?v=20260530b");

test("ships English and Italian tables", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["en", "it"]);
});

test("explicit supported language is returned verbatim", () => {
  saveSettings({ language: "it" });
  assert.equal(resolveLanguage(), "it");
  saveSettings({ language: "en" });
  assert.equal(resolveLanguage(), "en");
});

test("unsupported explicit language falls back to English", () => {
  saveSettings({ language: "fr" });
  assert.equal(resolveLanguage(), "en");
});
