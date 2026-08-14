// Device-correct glyph labels: glyphForAction follows the active input
// device and the player's actual binding; formatters cover the edges.

import { test } from "node:test";
import assert from "node:assert/strict";

// keyBindings persists to localStorage on rebind — stub it.
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

// gamepad.js reads navigator.getGamepads at call time, so the pad kind can
// be swapped between cases. Node 21+ ships a read-only built-in
// `navigator`, so redefine the property rather than assigning to it.
function setPads(...pads) {
  Object.defineProperty(globalThis, "navigator", {
    value: { getGamepads: () => pads },
    configurable: true,
    writable: true,
  });
}
const noPads = () => setPads();
const padWithId = (index, id) => ({ index, id, axes: [0, 0], buttons: [], connected: true });

const PS5_ID = "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)";
const XBOX_ID = "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)";

const { glyphForAction, formatKeyCode, formatPadButton, confirmGlyph, backGlyph, padKindForPlayer } =
  await import("../js/inputGlyphs.js");
const { PAD_PLAYSTATION, PAD_XBOX } = await import("../js/padKind.js");
const { markInputDevice, _resetActiveInputDeviceForTesting } =
  await import("../js/activeInputDevice.js");
const { setBinding, _resetBindingsForTesting } =
  await import("../js/keyBindings.js");
const { setGamepadBinding, _resetGamepadBindingsForTesting } =
  await import("../js/gamepadBindings.js");

test("formatKeyCode trims the common code prefixes", () => {
  assert.equal(formatKeyCode("KeyE"), "E");
  assert.equal(formatKeyCode("Digit1"), "1");
  assert.equal(formatKeyCode("Numpad8"), "Num 8");
  assert.equal(formatKeyCode("Escape"), "Escape");
  assert.equal(formatKeyCode(""), "—");
});

test("formatPadButton maps Standard Mapping indices (0 = A, not unbound)", () => {
  assert.equal(formatPadButton(0), "A");
  assert.equal(formatPadButton(1), "B");
  assert.equal(formatPadButton(9), "Start");
  assert.equal(formatPadButton(17), "Button 17");
  assert.equal(formatPadButton(-1), "—");
});

test("glyphForAction shows the keyboard binding in keyboard mode", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetBindingsForTesting();
  assert.equal(glyphForAction("interact"), "E"); // KeyE default
});

test("glyphForAction shows the pad button in gamepad mode", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetGamepadBindingsForTesting();
  noPads();
  markInputDevice("gamepad");
  assert.equal(glyphForAction("interact"), "A"); // button 0 default
  assert.equal(glyphForAction("shoot"), "B");
});

test("glyphForAction reflects rebinds", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetBindingsForTesting();
  _resetGamepadBindingsForTesting();
  noPads();
  setBinding("interact", 0, "KeyZ", 0);
  assert.equal(glyphForAction("interact"), "Z");
  markInputDevice("gamepad");
  setGamepadBinding("interact", 3, 0); // Y
  assert.equal(glyphForAction("interact"), "Y");
});

test("confirm/back glyphs follow the active device convention", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  noPads();
  assert.equal(confirmGlyph(), "Enter");
  assert.equal(backGlyph(), "Esc");
  markInputDevice("gamepad");
  assert.equal(confirmGlyph(), "A");
  assert.equal(backGlyph(), "B");
});

test("a Sony pad names its own buttons", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetGamepadBindingsForTesting();
  setPads(padWithId(0, PS5_ID));
  markInputDevice("gamepad");
  assert.equal(padKindForPlayer(0), PAD_PLAYSTATION);
  assert.equal(glyphForAction("interact"), "Cross");  // button 0
  assert.equal(glyphForAction("shoot"), "Circle");    // button 1
  assert.equal(glyphForAction("melee"), "Square");    // button 2
  assert.equal(glyphForAction("menu"), "Options");    // button 9
  assert.equal(glyphForAction("rangedNext"), "R1");   // button 5
});

test("confirm/back name the fixed indices per hardware", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  setPads(padWithId(0, PS5_ID));
  markInputDevice("gamepad");
  // menuNav still confirms on index 0 and backs out on index 1 — only the
  // words change.
  assert.equal(confirmGlyph(), "Cross");
  assert.equal(backGlyph(), "Circle");
});

test("the pad kind is per player, not per game", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetGamepadBindingsForTesting();
  // Local co-op desk: P1 on a DualSense, P2 on an Xbox pad. Same default
  // binding (button 0 = interact), two different printed names.
  setPads(padWithId(0, PS5_ID), padWithId(1, XBOX_ID));
  markInputDevice("gamepad");
  assert.equal(padKindForPlayer(0), PAD_PLAYSTATION);
  assert.equal(padKindForPlayer(1), PAD_XBOX);
  assert.equal(glyphForAction("interact", 0), "Cross");
  assert.equal(glyphForAction("interact", 1), "A");
});

test("an unplugged slot falls back to the standard layout", () => {
  _resetActiveInputDeviceForTesting("keyboard");
  _resetGamepadBindingsForTesting();
  setPads(padWithId(0, PS5_ID));
  markInputDevice("gamepad");
  assert.equal(padKindForPlayer(1), PAD_XBOX); // no second pad
  assert.equal(formatPadButton(0, padKindForPlayer(1)), "A");
});
