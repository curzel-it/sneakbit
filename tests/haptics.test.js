// Tests haptics.js: it fires navigator.vibrate with the preset duration,
// throttles rapid repeats (drag-to-switch across the d-pad), respects the
// Vibration setting, and stays a silent no-op where the API is missing
// (iOS). navigator is stubbed — no JSDOM.

import { test } from "node:test";
import assert from "node:assert/strict";

const { hapticTap, isTouchHapticsAvailable, _resetHapticsForTesting } = await import("../js/haptics.js");
const { saveSettings } = await import("../js/settings.js");

// Installs a navigator whose vibrate records its calls, and returns the log.
function stubVibrate() {
  const calls = [];
  Object.defineProperty(globalThis, "navigator", {
    value: { vibrate: (ms) => { calls.push(ms); return true; } },
    configurable: true,
    writable: true,
  });
  return calls;
}

function stubNoVibrate() {
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
    writable: true,
  });
}

// Stands in for the iOS shell's window.webkit.messageHandlers.haptics.
function stubNativeBridge(posted) {
  globalThis.window = { webkit: { messageHandlers: { haptics: { postMessage: (k) => posted.push(k) } } } };
}

// Each case starts from a cleared throttle, vibration on, and no iOS bridge
// (Node has no window, so most cases take the navigator.vibrate path).
function reset() {
  _resetHapticsForTesting();
  saveSettings({ haptics: true });
  delete globalThis.window;
}

test("a tap vibrates for the preset duration", () => {
  reset();
  const calls = stubVibrate();
  hapticTap("tap");
  assert.deepEqual(calls, [10]);
});

test("an action press reads heavier than a step", () => {
  reset();
  const calls = stubVibrate();
  hapticTap("action");
  assert.deepEqual(calls, [18]);
});

test("defaults to the tap preset", () => {
  reset();
  const calls = stubVibrate();
  hapticTap();
  assert.deepEqual(calls, [10]);
});

test("throttles rapid repeats so a d-pad drag doesn't buzz continuously", () => {
  reset();
  const calls = stubVibrate();
  hapticTap("tap");
  hapticTap("tap"); // immediate repeat — suppressed
  hapticTap("tap");
  assert.equal(calls.length, 1);
});

test("no-op when the player turned Vibration off", () => {
  reset();
  const calls = stubVibrate();
  saveSettings({ haptics: false });
  hapticTap("tap");
  assert.equal(calls.length, 0);
  saveSettings({ haptics: true });
});

test("no-op where the Vibration API is missing", () => {
  reset();
  stubNoVibrate();
  hapticTap("tap"); // just shouldn't throw
  assert.ok(true);
});

test("unknown kind is ignored", () => {
  reset();
  const calls = stubVibrate();
  hapticTap("nope");
  assert.equal(calls.length, 0);
});

// — iOS native bridge ————————————————————————————————————————————————

test("prefers the iOS bridge over navigator.vibrate, and sends the kind", () => {
  reset();
  const calls = stubVibrate();
  const posted = [];
  stubNativeBridge(posted);
  hapticTap("action");
  assert.deepEqual(posted, ["action"]);
  assert.equal(calls.length, 0, "must not also buzz through the Vibration API");
});

test("the bridge respects the Vibration setting", () => {
  reset();
  const posted = [];
  stubNativeBridge(posted);
  saveSettings({ haptics: false });
  hapticTap("tap");
  assert.equal(posted.length, 0);
  saveSettings({ haptics: true });
});

test("the bridge is throttled like the Vibration API path", () => {
  reset();
  const posted = [];
  stubNativeBridge(posted);
  hapticTap("tap");
  hapticTap("tap");
  assert.equal(posted.length, 1);
});

// — availability ————————————————————————————————————————————————————

test("haptics count as available when the iOS bridge is present", () => {
  reset();
  stubNoVibrate();
  stubNativeBridge([]);
  assert.equal(isTouchHapticsAvailable(), true);
});

test("a touch device with the Vibration API counts as available", () => {
  reset();
  Object.defineProperty(globalThis, "navigator", {
    value: { vibrate: () => true, maxTouchPoints: 5 },
    configurable: true, writable: true,
  });
  assert.equal(isTouchHapticsAvailable(), true);
});

test("a desktop exposing navigator.vibrate with no motor does not count", () => {
  reset();
  // Chromium on a desktop ships the API but there's nothing behind it — the
  // whole reason availability isn't just a typeof check.
  Object.defineProperty(globalThis, "navigator", {
    value: { vibrate: () => true, maxTouchPoints: 0 },
    configurable: true, writable: true,
  });
  assert.equal(isTouchHapticsAvailable(), false);
});

test("no Vibration API and no bridge is not available", () => {
  reset();
  stubNoVibrate();
  assert.equal(isTouchHapticsAvailable(), false);
});
