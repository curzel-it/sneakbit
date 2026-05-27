// Tests the guest's key→intent forwarding: edge emissions only, stopMove
// when the held set empties, dir-replacement when another arrow is still
// held. Drives the module via its synthetic _injectKey* seams to avoid
// pulling in JSDOM.

import { test } from "node:test";
import assert from "node:assert/strict";

const fwd = await import("../js/guestInputForwarder.js");

function makeFakeNet() {
  const sent = [];
  return {
    sent,
    send(frame) { sent.push(frame); return true; },
    isConnected: () => true,
  };
}

function setup() {
  fwd._resetForwarderForTesting();
  const net = makeFakeNet();
  fwd.installGuestInputForwarder(net);
  return net;
}

test("pressing the bound move-down key emits moveDown once", () => {
  const net = setup();
  // KeyS is the default keyBindings.js bind for moveDown in single-player.
  fwd._injectKeyDownForTesting("KeyS");
  assert.equal(net.sent.length, 1);
  assert.equal(net.sent[0].op, "input");
  assert.equal(net.sent[0].intent, "moveDown");
  assert.equal(net.sent[0].seq, 1);
  fwd._resetForwarderForTesting();
});

test("releasing the only-held direction sends stopMove", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("KeyS");
  fwd._injectKeyUpForTesting("KeyS");
  const stop = net.sent.filter((m) => m.intent === "stopMove");
  assert.equal(stop.length, 1);
  fwd._resetForwarderForTesting();
});

test("a second direction press replaces the held direction on the wire", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("KeyS"); // down
  fwd._injectKeyDownForTesting("KeyA"); // left
  const intents = net.sent.map((m) => m.intent);
  assert.deepEqual(intents, ["moveDown", "moveLeft"]);
  fwd._resetForwarderForTesting();
});

test("releasing one direction with another still held sends the remaining direction", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("KeyS"); // down
  fwd._injectKeyDownForTesting("KeyA"); // left
  fwd._injectKeyUpForTesting("KeyA");   // release left, down still held
  const intents = net.sent.map((m) => m.intent);
  // moveDown, moveLeft, moveDown
  assert.equal(intents[intents.length - 1], "moveDown");
  fwd._resetForwarderForTesting();
});

test("seq increments monotonically across emissions", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("KeyS");
  fwd._injectKeyUpForTesting("KeyS");
  const seqs = net.sent.map((m) => m.seq);
  for (let i = 1; i < seqs.length; i++) {
    assert.ok(seqs[i] > seqs[i - 1], `seq must be increasing: ${seqs}`);
  }
  fwd._resetForwarderForTesting();
});

test("unbound keys do not emit", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("F12");
  assert.equal(net.sent.length, 0);
  fwd._resetForwarderForTesting();
});

test("interact key emits intent: interact", () => {
  const net = setup();
  // KeyE is the default for interact in keyBindings.js.
  fwd._injectKeyDownForTesting("KeyE");
  assert.equal(net.sent.length, 1);
  assert.equal(net.sent[0].intent, "interact");
  fwd._resetForwarderForTesting();
});
