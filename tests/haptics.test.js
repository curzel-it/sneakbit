// Tests haptics.js: it fires navigator.vibrate with the preset duration,
// throttles rapid repeats (drag-to-switch across the d-pad), respects the
// Vibration setting, and stays a silent no-op where the API is missing
// (iOS). navigator is stubbed — no JSDOM.

import { test } from "node:test";
import assert from "node:assert/strict";

const { hapticTap, _resetHapticsForTesting } = await import("../js/haptics.js");
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

// Each case starts from a cleared throttle and vibration on.
function reset() {
  _resetHapticsForTesting();
  saveSettings({ haptics: true });
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
