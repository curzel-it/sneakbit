// Tests rumble.js: it resolves a slot to its pad via gamepad.js, plays a
// vibration effect when one is present, throttles repeats, and stays a
// silent no-op when there's no pad / no actuator. navigator.getGamepads
// is stubbed (no JSDOM).

import { test } from "node:test";
import assert from "node:assert/strict";

const { rumble, _resetRumbleForTesting } = await import("../js/rumble.js?v=20260530e");

// A pad with a vibrationActuator that records playEffect calls.
function padWithActuator(index, calls) {
  return {
    index,
    axes: [0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
    vibrationActuator: { playEffect: (...a) => { calls.push(a); return Promise.resolve("complete"); } },
  };
}

function padNoActuator(index) {
  return { index, axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
}

function setPads(...pads) {
  Object.defineProperty(globalThis, "navigator", {
    value: { getGamepads: () => pads },
    configurable: true,
    writable: true,
  });
}

test("plays a dual-rumble effect on the slot's pad", () => {
  _resetRumbleForTesting();
  const calls = [];
  setPads(padWithActuator(0, calls));
  rumble(1, "hurt");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "dual-rumble");
  assert.equal(calls[0][1].duration, 200);
});

test("throttles repeat pulses within the effect duration", () => {
  _resetRumbleForTesting();
  const calls = [];
  setPads(padWithActuator(0, calls));
  rumble(1, "hurt");
  rumble(1, "hurt"); // immediate repeat — suppressed
  assert.equal(calls.length, 1);
});

test("no-op when the slot has no assigned pad", () => {
  _resetRumbleForTesting();
  const calls = [];
  setPads(padWithActuator(0, calls)); // only slot 1 has a pad
  rumble(3, "hurt");
  assert.equal(calls.length, 0);
});

test("no-op when the pad has no vibration actuator", () => {
  _resetRumbleForTesting();
  setPads(padNoActuator(0));
  // Just shouldn't throw.
  rumble(1, "hurt");
  assert.ok(true);
});

test("unknown rumble kind is ignored", () => {
  _resetRumbleForTesting();
  const calls = [];
  setPads(padWithActuator(0, calls));
  rumble(1, "nope");
  assert.equal(calls.length, 0);
});
