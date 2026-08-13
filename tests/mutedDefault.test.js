// Fresh-install mute default. A browser tab and both mobile shells start
// muted; the desktop app (Steam/Electron) starts with sound on. Either way a
// saved choice wins — the default only applies to a first launch.

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

const SETTINGS_KEY = "sneakbit.settings.v1";

const { loadSettings, defaultMuted } = await import("../js/settings.js");
const { _resetNativeBridgeForTesting } = await import("../js/nativeBridge.js");

function freshLoad(platform, stored) {
  _resetNativeBridgeForTesting(platform ? { platform, mirror: null, legacy: null } : null);
  localStorage.clear();
  if (stored) localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  return loadSettings();
}

test("the web starts muted", () => {
  assert.equal(freshLoad(null, null).muted, true);
});

test("the desktop app starts with sound on", () => {
  assert.equal(freshLoad("electron", null).muted, false);
});

test("the mobile shells still start muted", () => {
  assert.equal(freshLoad("ios", null).muted, true);
  assert.equal(freshLoad("android", null).muted, true);
});

test("a saved choice wins over the platform default", () => {
  assert.equal(freshLoad("electron", { muted: true }).muted, true, "desktop player who muted stays muted");
  assert.equal(freshLoad(null, { muted: false }).muted, false, "web player who unmuted stays unmuted");
});

test("defaultMuted follows the shell, not the saved settings", () => {
  _resetNativeBridgeForTesting({ platform: "electron", mirror: null, legacy: null });
  assert.equal(defaultMuted(), false);
  _resetNativeBridgeForTesting(null);
  assert.equal(defaultMuted(), true);
});
