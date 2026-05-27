// Host-side input plumbing: peer.joined spawns state.player2, guest input
// frames flow into the input pipeline, peer.left tears it back down.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260527b");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260527b");
const { installHostGuests, _uninstallHostGuestsForTesting } =
  await import("../js/hostGuests.js?v=20260527b");
const inputModule = await import("../js/input.js?v=20260527b");

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
  for (const s of [2, 3, 4]) inputModule.clearInputState(s);
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
    players: [],
  };
  const makeCoopP2 = (p1, _zone, opts = {}) => ({
    index: opts.index ?? 1,
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
  for (const s of [2, 3, 4]) inputModule.clearInputState(s);
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

test("slot 3 spawn populates state.players with index=2", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g3", slot: 3 });
  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].slot, 3);
  assert.equal(state.players[0].playerId, "p_g3");
  assert.equal(state.players[0].player.index, 2);
  assert.equal(state.players[0].player.slot, 3);
  teardown();
});

test("slot 4 spawn coexists with slot 3", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g3", slot: 3 });
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g4", slot: 4 });
  assert.equal(state.players.length, 2);
  const slots = state.players.map((s) => s.slot).sort();
  assert.deepEqual(slots, [3, 4]);
  teardown();
});

test("peer.left for slot 3 removes only that entry", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g3", slot: 3 });
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g4", slot: 4 });
  fakeNet.emit("peer.left", { op: "peer.left", playerId: "p_g3", reason: "leave" });
  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].slot, 4);
  teardown();
});

test("input from slot 3 guest routes into slot 3 input state", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g3", slot: 3 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g3", intent: "moveRight" });
  const { events, held } = inputModule.pollInput(3);
  assert.deepEqual(events, ["right"]);
  assert.ok(held.has("right"));
  teardown();
});

// --- Action cooldowns ------------------------------------------------------
// hostGuests's action path calls window.dispatchEvent for shoot/melee/
// interact. In Node tests there's no DOM, so we stub window with a
// counter and observe how many synthesised key events reach the
// "would dispatch" layer. That tells us whether the cooldown swallowed
// the inbound intent.

function stubWindow() {
  const dispatched = [];
  globalThis.window = {
    dispatchEvent(ev) { dispatched.push({ code: ev.code, type: ev.type }); return true; },
  };
  // The host code constructs `new KeyboardEvent("keydown", { code })`,
  // which doesn't exist in Node either. Provide a minimal shim.
  if (typeof globalThis.KeyboardEvent === "undefined") {
    globalThis.KeyboardEvent = class { constructor(type, init) { this.type = type; this.code = init?.code; } };
  }
  return dispatched;
}

function unstubWindow() {
  delete globalThis.window;
  // Leave KeyboardEvent in place — installing it twice is harmless.
}

test("rapid shoot intents from one guest are throttled by the cooldown", async () => {
  const dispatched = stubWindow();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    const { _resetActionCooldownsForTesting } =
      await import("../js/hostGuests.js?v=20260527b");
    _resetActionCooldownsForTesting();
    // Fire three back-to-back shoots — the cooldown is 180 ms, so two
    // of them should be silently dropped.
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 3, from: "p_g1", intent: "shoot" });
    // KeyJ is the slot-2 default for shoot in COOP_KEYMAPS; we only
    // care about the count of synthesised events, not the specific key.
    const shoots = dispatched.filter((d) => d.type === "keydown");
    assert.equal(shoots.length, 1, `expected 1 dispatched shoot (rest throttled), got ${shoots.length}`);
    teardown();
  } finally { unstubWindow(); }
});

test("cooldown is per-guest per-intent (shoot from g1 doesn't gate shoot from g2; shoot doesn't gate melee)", async () => {
  const dispatched = stubWindow();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g2", slot: 3 });
    const { _resetActionCooldownsForTesting } =
      await import("../js/hostGuests.js?v=20260527b");
    _resetActionCooldownsForTesting();
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 2, from: "p_g2", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 3, from: "p_g1", intent: "melee" });
    // All three should land — different (guest, intent) tuples.
    assert.equal(dispatched.length, 3);
    teardown();
  } finally { unstubWindow(); }
});

test("cooldown clears after the window — slow tapping isn't penalised", async () => {
  const dispatched = stubWindow();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    const { _resetActionCooldownsForTesting } =
      await import("../js/hostGuests.js?v=20260527b");
    _resetActionCooldownsForTesting();
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    // Sleep past the 180 ms cooldown — second shoot should land too.
    await new Promise((r) => setTimeout(r, 200));
    fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "shoot" });
    assert.equal(dispatched.length, 2);
    teardown();
  } finally { unstubWindow(); }
});

test("movement intents are never throttled (state-derived, last-wins)", async () => {
  // A spammed flood of moveLeft from a malicious client must NOT trip
  // any cooldown — held key state would otherwise desync from the
  // honest case where a real user is just holding the key down.
  // We can observe by reading the slot's input state after the flood.
  stubWindow();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    const { _resetActionCooldownsForTesting } =
      await import("../js/hostGuests.js?v=20260527b");
    _resetActionCooldownsForTesting();
    for (let i = 0; i < 50; i++) {
      fakeNet.emit("input", { op: "input", seq: i, from: "p_g1", intent: "moveRight" });
    }
    const { held } = inputModule.pollInput(2);
    assert.ok(held.has("right"), "moveRight must still be held after a flood");
    teardown();
  } finally { unstubWindow(); }
});
