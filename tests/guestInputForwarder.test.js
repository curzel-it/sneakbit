// Tests the guest's key→intent forwarding: edge emissions only, stopMove
// when the held set empties, dir-replacement when another arrow is still
// held. Drives the module via its synthetic _injectKey* seams to avoid
// pulling in JSDOM.

import { test } from "node:test";
import assert from "node:assert/strict";

const fwd = await import("../js/guestInputForwarder.js?v=20260528");

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

function makeDisconnectableNet() {
  const sent = [];
  let connected = true;
  return {
    sent,
    setConnected(v) { connected = v; },
    send(frame) { if (!connected) return false; sent.push(frame); return true; },
    isConnected: () => connected,
  };
}

test("action intents fired while disconnected are buffered, not sent", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  fwd._injectKeyDownForTesting("KeyF"); // shoot
  fwd._injectKeyDownForTesting("KeyG"); // melee
  fwd._injectKeyDownForTesting("KeyE"); // interact
  assert.equal(net.sent.length, 0, "nothing should hit the wire while disconnected");
  const pending = fwd._getPendingActionsForTesting();
  assert.deepEqual(pending.map((p) => p.intent), ["shoot", "melee", "interact"]);
  fwd._resetForwarderForTesting();
});

test("movement intents fired while disconnected are NOT buffered (state re-derives on resume)", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  fwd._injectKeyDownForTesting("KeyD"); // moveRight
  assert.equal(net.sent.length, 0);
  assert.equal(fwd._getPendingActionsForTesting().length, 0,
    "movement intents must not pile up in the action buffer — buffering would phantom-step the avatar on reconnect");
  fwd._resetForwarderForTesting();
});

test("flushOnReconnect drains buffered actions in order", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  fwd._injectKeyDownForTesting("KeyF");
  fwd._injectKeyDownForTesting("KeyG");
  net.setConnected(true);
  fwd.flushOnReconnect();
  assert.equal(fwd._getPendingActionsForTesting().length, 0);
  const intents = net.sent.map((m) => m.intent);
  assert.deepEqual(intents, ["shoot", "melee"]);
  fwd._resetForwarderForTesting();
});

test("flushOnReconnect drops entries older than ACTION_TTL_MS (5 s)", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  fwd._injectKeyDownForTesting("KeyF");
  fwd._injectKeyDownForTesting("KeyG");
  net.setConnected(true);
  // Pretend a long time passed before the welcome arrived.
  fwd.flushOnReconnect(Date.now() + 6000);
  assert.equal(net.sent.length, 0, "stale intents should be dropped — a 6 s-old shoot would surprise the player");
  fwd._resetForwarderForTesting();
});

test("pending action buffer is bounded (oldest entries evicted past cap)", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  // Press shoot 10 times — cap is 8, so the first 2 should evict.
  for (let i = 0; i < 10; i++) {
    fwd._injectKeyDownForTesting("KeyF");
    fwd._injectKeyUpForTesting("KeyF"); // shoot is an action, but keyup makes the next keydown fire
  }
  // The forwarder only emits shoot on keydown if !e.repeat, and our
  // synthetic events have no repeat flag, so each KeyF down fires
  // shoot. With keyup between each, the cap should be 8.
  const pending = fwd._getPendingActionsForTesting();
  assert.equal(pending.length, 8);
  fwd._resetForwarderForTesting();
});

test("flushOnReconnect re-emits a still-held movement direction", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  // User starts walking right while connected.
  fwd._injectKeyDownForTesting("KeyD"); // moveRight
  assert.equal(net.sent[0].intent, "moveRight");
  net.sent.length = 0;
  // Connection drops mid-walk. User is still holding KeyD.
  net.setConnected(false);
  // … blip …
  net.setConnected(true);
  fwd.flushOnReconnect();
  // The forwarder should emit moveRight again so the host's avatar
  // resumes walking without the user lifting + repressing the key.
  assert.equal(net.sent.length, 1);
  assert.equal(net.sent[0].intent, "moveRight");
  fwd._resetForwarderForTesting();
});
