// Naming a button after what's printed on the hardware, not after the
// Standard Mapping index it happens to sit on.

import { test } from "node:test";
import assert from "node:assert/strict";

const { padKind, padLabel, PAD_XBOX, PAD_PLAYSTATION, PAD_NINTENDO } =
  await import("../js/padKind.js");

test("padKind reads Chrome's vendor id", () => {
  assert.equal(padKind("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"), PAD_PLAYSTATION);
  assert.equal(padKind("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)"), PAD_XBOX);
  assert.equal(padKind("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"), PAD_NINTENDO);
});

test("padKind reads Firefox's vendor-product-name form", () => {
  assert.equal(padKind("054c-09cc-Wireless Controller"), PAD_PLAYSTATION);
  assert.equal(padKind("057e-2009-Pro Controller"), PAD_NINTENDO);
});

test("Steam Input's virtual pad is an Xbox layout", () => {
  // Valve's vendor id — the pad Steam synthesises presents in Xbox layout,
  // so naming it after Valve or guessing Sony would both be wrong.
  assert.equal(padKind("Steam Virtual Gamepad (Vendor: 28de Product: 11ff)"), PAD_XBOX);
});

test("padKind falls back to keywords when there's no vendor id", () => {
  assert.equal(padKind("Sony DualShock 4"), PAD_PLAYSTATION);
  assert.equal(padKind("Nintendo Switch Pro Controller"), PAD_NINTENDO);
  assert.equal(padKind("XInput Gamepad"), PAD_XBOX);
});

test("an unknown or absent pad is the standard layout", () => {
  assert.equal(padKind("Some Generic Pad"), PAD_XBOX);
  assert.equal(padKind(""), PAD_XBOX);
  assert.equal(padKind(null), PAD_XBOX);
  assert.equal(padKind(undefined), PAD_XBOX);
});

test("Sony's face buttons are shapes, spelled out", () => {
  assert.equal(padLabel(0, PAD_PLAYSTATION), "Cross");
  assert.equal(padLabel(1, PAD_PLAYSTATION), "Circle");
  assert.equal(padLabel(2, PAD_PLAYSTATION), "Square");
  assert.equal(padLabel(3, PAD_PLAYSTATION), "Triangle");
  assert.equal(padLabel(4, PAD_PLAYSTATION), "L1");
  assert.equal(padLabel(9, PAD_PLAYSTATION), "Options");
});

test("Nintendo's A and B are mirrored — the whole point of the table", () => {
  // Index 0 is the bottom face button everywhere; on this hardware the
  // bottom one says B. Printing "A" here points at the wrong button.
  assert.equal(padLabel(0, PAD_NINTENDO), "B");
  assert.equal(padLabel(1, PAD_NINTENDO), "A");
  assert.equal(padLabel(2, PAD_NINTENDO), "Y");
  assert.equal(padLabel(3, PAD_NINTENDO), "X");
  assert.equal(padLabel(9, PAD_NINTENDO), "Plus");
});

test("padLabel edges: unbound, out of range, unknown kind", () => {
  assert.equal(padLabel(-1, PAD_PLAYSTATION), "—");
  assert.equal(padLabel(null, PAD_PLAYSTATION), "—");
  assert.equal(padLabel(17, PAD_PLAYSTATION), "Button 17");
  assert.equal(padLabel(0, "mystery-brand"), "A"); // unknown kind → standard layout
  assert.equal(padLabel(0), "A"); // kind omitted → standard layout
});
