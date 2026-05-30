// Last-input-wins device tracking: transitions, change-event firing, and
// the no-op-when-unchanged guard.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  getActiveInputDevice, onActiveInputDeviceChange, markInputDevice,
  _resetActiveInputDeviceForTesting,
} = await import("../js/activeInputDevice.js?v=20260530d");

test("defaults to keyboard", () => {
  _resetActiveInputDeviceForTesting();
  assert.equal(getActiveInputDevice(), "keyboard");
});

test("markInputDevice switches the active device", () => {
  _resetActiveInputDeviceForTesting();
  markInputDevice("gamepad");
  assert.equal(getActiveInputDevice(), "gamepad");
  markInputDevice("touch");
  assert.equal(getActiveInputDevice(), "touch");
});

test("change listeners fire on transition with the new device", () => {
  _resetActiveInputDeviceForTesting();
  const seen = [];
  onActiveInputDeviceChange((d) => seen.push(d));
  markInputDevice("gamepad");
  markInputDevice("keyboard");
  assert.deepEqual(seen, ["gamepad", "keyboard"]);
});

test("no event when the device is unchanged (cheap per-frame reports)", () => {
  _resetActiveInputDeviceForTesting("gamepad");
  let count = 0;
  onActiveInputDeviceChange(() => count++);
  markInputDevice("gamepad");
  markInputDevice("gamepad");
  assert.equal(count, 0);
});

test("unknown device values are ignored", () => {
  _resetActiveInputDeviceForTesting();
  markInputDevice("mouse");
  assert.equal(getActiveInputDevice(), "keyboard");
});

test("unsubscribe stops further callbacks", () => {
  _resetActiveInputDeviceForTesting();
  let count = 0;
  const off = onActiveInputDeviceChange(() => count++);
  markInputDevice("gamepad");
  off();
  markInputDevice("keyboard");
  assert.equal(count, 1);
});
