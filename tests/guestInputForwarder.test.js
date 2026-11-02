// Guest sender. Two channels:
//   * action intents (shoot/melee/interact) — keyboard + gamepad rising
//     edges sent as op:"input" carrying the facing `d`.
//   * position updates — forwardMove() → op:"move" k:"pos" + a log for
//     reconciliation.
// Movement is no longer watched here (it reaches predictedSelf via input.js
// slot 1), so there is no moveX/stopMove/holdSync path to test.

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

// --- action intents ---------------------------------------------------------

test("interact key emits intent:interact carrying the current facing", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("KeyE"); // KeyE = interact default
  assert.equal(net.sent.length, 1);
  assert.equal(net.sent[0].op, "input");
  assert.equal(net.sent[0].intent, "interact");
  assert.equal(net.sent[0].seq, 1);
  // No predicted self installed in this unit → facing defaults to "down".
  assert.equal(net.sent[0].d, "down");
  fwd._resetForwarderForTesting();
});

test("movement keys do NOT emit (movement is owned by predictedSelf now)", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("KeyW"); // up
  fwd._injectKeyDownForTesting("KeyA"); // left
  fwd._injectKeyDownForTesting("KeyS"); // down
  assert.equal(net.sent.length, 0, "no movement intents should hit the wire");
  fwd._resetForwarderForTesting();
});

test("unbound keys do not emit", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("F12");
  assert.equal(net.sent.length, 0);
  fwd._resetForwarderForTesting();
});

test("seq increments monotonically across action emissions", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("KeyF"); // shoot
  fwd._injectKeyDownForTesting("KeyG"); // melee
  fwd._injectKeyDownForTesting("KeyE"); // interact
  const seqs = net.sent.map((m) => m.seq);
  assert.deepEqual(seqs, [1, 2, 3]);
  fwd._resetForwarderForTesting();
});

// --- forwardMove + step-log -------------------------------------------------

test("forwardMove(pos) ships op:move and logs the position", () => {
  const net = setup();
  const seq = fwd.forwardMove({ k: "pos", x: 5.25, y: 6.5, d: "down", m: 1 });
  assert.equal(seq, 1);
  assert.deepEqual(net.sent[0], { op: "move", seq: 1, k: "pos", x: 5.25, y: 6.5, d: "down", m: 1 });
  assert.deepEqual(fwd.getStepLog(), [{ seq: 1, x: 5.25, y: 6.5 }]);
  fwd._resetForwarderForTesting();
});

test("positionMove rounds to 3dp and hands over a pending push once", () => {
  const p = { x: 1.23456, y: 2.00049, direction: "left", moving: true, _pushed: { x: 0, y: 2, d: "left" } };
  assert.deepEqual(fwd.positionMove(p), { k: "pos", x: 1.235, y: 2, d: "left", m: 1, push: { x: 0, y: 2, d: "left" } });
  assert.equal(p._pushed, null);
  assert.equal(fwd.positionMove(p).push, undefined);
});

test("dropAckedSteps drops every log entry with seq <= acked", () => {
  setup();
  fwd.forwardMove({ k: "pos", x: 5, y: 5.1, d: "down", m: 1 }); // seq 1
  fwd.forwardMove({ k: "pos", x: 5, y: 5.2, d: "down", m: 1 }); // seq 2
  fwd.forwardMove({ k: "pos", x: 5, y: 5.3, d: "down", m: 1 }); // seq 3
  fwd.dropAckedSteps(2);
  assert.deepEqual(fwd.getStepLog(), [{ seq: 3, x: 5, y: 5.3 }]);
  fwd._resetForwarderForTesting();
});

test("action and step seqs share one counter", () => {
  const net = setup();
  fwd._injectKeyDownForTesting("KeyF");                                    // seq 1 (shoot)
  fwd.forwardMove({ k: "pos", x: 5.1, y: 5, d: "right", m: 1 });         // seq 2 (move)
  fwd._injectKeyDownForTesting("KeyG");                                    // seq 3 (melee)
  assert.deepEqual(net.sent.map((m) => m.seq), [1, 2, 3]);
  assert.equal(fwd.getSeq(), 3);
  // Only the move landed in the log.
  assert.deepEqual(fwd.getStepLog().map((e) => e.seq), [2]);
  fwd._resetForwarderForTesting();
});

// --- disconnect behaviour ---------------------------------------------------

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
  assert.equal(net.sent.length, 0);
  assert.deepEqual(fwd._getPendingActionsForTesting().map((p) => p.intent), ["shoot", "melee", "interact"]);
  fwd._resetForwarderForTesting();
});

test("forwardMove while disconnected is dropped (movement is state-derived)", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  const seq = fwd.forwardMove({ k: "pos", x: 5.1, y: 5, d: "right", m: 1 });
  assert.equal(seq, null, "a move made while disconnected must not be queued");
  assert.equal(net.sent.length, 0);
  assert.deepEqual(fwd.getStepLog(), []);
  fwd._resetForwarderForTesting();
});

test("flushOnReconnect drains buffered actions in order (carrying facing)", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  fwd._injectKeyDownForTesting("KeyF");
  fwd._injectKeyDownForTesting("KeyG");
  net.setConnected(true);
  fwd.flushOnReconnect();
  assert.equal(fwd._getPendingActionsForTesting().length, 0);
  const actions = net.sent.filter((m) => m.op === "input");
  assert.deepEqual(actions.map((m) => m.intent), ["shoot", "melee"]);
  for (const a of actions) assert.equal(a.d, "down");
  fwd._resetForwarderForTesting();
});

test("flushOnReconnect drops actions older than ACTION_TTL_MS (5 s)", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  fwd._injectKeyDownForTesting("KeyF");
  net.setConnected(true);
  fwd.flushOnReconnect(Date.now() + 6000);
  assert.equal(net.sent.filter((m) => m.op === "input").length, 0,
    "a 6 s-old shoot would surprise the player — drop it");
  fwd._resetForwarderForTesting();
});

test("pending action buffer is bounded (oldest evicted past cap)", () => {
  fwd._resetForwarderForTesting();
  const net = makeDisconnectableNet();
  fwd.installGuestInputForwarder(net);
  net.setConnected(false);
  for (let i = 0; i < 10; i++) fwd._injectKeyDownForTesting("KeyF");
  assert.equal(fwd._getPendingActionsForTesting().length, 8);
  fwd._resetForwarderForTesting();
});

// --- gamepad action buttons -------------------------------------------------

test("gamepad action buttons emit one intent on the rising edge", () => {
  const net = setup();
  fwd._injectGamepadFrameForTesting([], { shoot: true });
  fwd._injectGamepadFrameForTesting([], { shoot: true });  // held — no repeat
  fwd._injectGamepadFrameForTesting([], { shoot: false, melee: true });
  assert.deepEqual(net.sent.map((m) => m.intent), ["shoot", "melee"]);
  fwd._resetForwarderForTesting();
});

test("gamepad directions are NOT forwarded (they drive predictedSelf via pollInput)", () => {
  const net = setup();
  fwd._injectGamepadFrameForTesting(["down", "left"]);
  assert.equal(net.sent.length, 0);
  fwd._resetForwarderForTesting();
});
