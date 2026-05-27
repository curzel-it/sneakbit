// Host-side input plumbing: peer.joined spawns state.player2, guest input
// frames flow into the input pipeline, peer.left tears it back down.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js");
const { installHostGuests, _uninstallHostGuestsForTesting } =
  await import("../js/hostGuests.js");
const inputModule = await import("../js/input.js");

function makeFakeNet() {
  const handlers = new Map();
  return {
    on(op, h) {
      let list = handlers.get(op);
      if (!list) { list = []; handlers.set(op, list); }
      list.push(h);
      return () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); };
    },
    emit(op, msg) {
      const list = handlers.get(op) || [];
      for (const h of list.slice()) h(msg);
    },
    send: () => true,
    connect: () => {},
    close: () => {},
    isConnected: () => true,
    getUuid: () => "uuid-host",
    getUrl: () => "ws://test",
    handlers,
  };
}

function setup({ guestSlot = 2 } = {}) {
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "host", uuid: "uuid-host" });
  inputModule.clearInputState(2);
  inputModule.clearInputState(3);
  _uninstallHostGuestsForTesting();
  const fakeNet = makeFakeNet();
  bootstrapOnline({ netFactory: () => fakeNet });
  // welcome to seed selfPlayerId for the broadcaster, not strictly needed here
  fakeNet.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_host", name: "Player-x" });
  const state = {
    player: { tileX: 5, tileY: 5, direction: "down" },
    zone: { cols: 30, rows: 30, entities: [] },
    player2: null,
    lastTile2: null,
  };
  const makeCoopP2 = (p1, _zone) => ({
    index: 1,
    tileX: p1.tileX + 1, tileY: p1.tileY,
    x: p1.tileX + 1, y: p1.tileY,
    direction: "down",
  });
  installHostGuests(() => state, { makeCoopP2, net: fakeNet });
  return { fakeNet, state };
}

function teardown() {
  _uninstallHostGuestsForTesting();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
  inputModule.clearInputState(2);
  inputModule.clearInputState(3);
}

test("peer.joined slot=2 spawns state.player2 carrying the guest's playerId", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  assert.ok(state.player2);
  assert.equal(state.player2.playerId, "p_g1");
  assert.equal(state.player2.slot, 2);
  assert.deepEqual(state.lastTile2, { x: 6, y: 5 });
  teardown();
});

test("peer.left removes state.player2 and clears slot input", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  inputModule.pushInputPress(2, "up");
  fakeNet.emit("peer.left", { op: "peer.left", playerId: "p_g1", reason: "leave" });
  assert.equal(state.player2, null);
  assert.equal(state.lastTile2, null);
  const { events, held } = inputModule.pollInput(2);
  assert.equal(events.length, 0);
  assert.equal(held.size, 0);
  teardown();
});

test("input intent forwards into the slot's input state", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveDown" });
  const { events, held } = inputModule.pollInput(2);
  assert.deepEqual(events, ["down"]);
  assert.ok(held.has("down"));
  teardown();
});

test("stopMove clears the slot's held set", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveDown" });
  fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "stopMove" });
  const { events, held } = inputModule.pollInput(2);
  // events were drained by the previous test mid-implicitly? actually we
  // never polled before stopMove — so events should still contain "down"
  // and held should be empty.
  assert.deepEqual(events, ["down"]);
  assert.equal(held.size, 0);
  teardown();
});

test("moveLeft after moveDown replaces the held direction", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveDown" });
  fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "moveLeft" });
  const { held } = inputModule.pollInput(2);
  assert.equal(held.size, 1);
  assert.ok(held.has("left"));
  teardown();
});

test("input from an unknown sender is ignored", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_stranger", intent: "moveUp" });
  const { events, held } = inputModule.pollInput(2);
  assert.equal(events.length, 0);
  assert.equal(held.size, 0);
  teardown();
});

test("peer.ghosted releases held keys without despawning the avatar", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveDown" });
  fakeNet.emit("peer.ghosted", { op: "peer.ghosted", playerId: "p_g1" });
  assert.ok(state.player2, "avatar must stay in place during ghost grace");
  const { held } = inputModule.pollInput(2);
  assert.equal(held.size, 0);
  teardown();
});

test("peer.rejoined rebinds the playerId without respawning", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const beforeRef = state.player2;
  fakeNet.emit("peer.rejoined", { op: "peer.rejoined", playerId: "p_g1", slot: 2 });
  assert.equal(state.player2, beforeRef);
  teardown();
});
