// Host-side input plumbing: peer.joined spawns state.player2, guest input
// frames flow into the input pipeline, peer.left tears it back down.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260528i");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260528i");
const { installHostGuests, _uninstallHostGuestsForTesting } =
  await import("../js/hostGuests.js?v=20260528i");
const inputModule = await import("../js/input.js?v=20260528i");

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

test("moveLeft after moveDown (legacy wire, no held field) replaces the held direction", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveDown" });
  fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "moveLeft" });
  const { held } = inputModule.pollInput(2);
  assert.equal(held.size, 1);
  assert.ok(held.has("left"));
  teardown();
});

test("movement intent with held=[up,left] mirrors guest's multi-key state on the host", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveUp", held: ["up"] });
  fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "moveLeft", held: ["up", "left"] });
  const { events, held } = inputModule.pollInput(2);
  // events drains the press queue for the new keypresses; held mirrors
  // the guest's authoritative state, not just the latest press.
  assert.deepEqual(events, ["up", "left"]);
  assert.equal(held.size, 2);
  assert.ok(held.has("up"));
  assert.ok(held.has("left"));
  teardown();
});

test("holdSync updates the slot's held set without queuing a fresh press event", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveUp", held: ["up"] });
  fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "moveLeft", held: ["up", "left"] });
  inputModule.pollInput(2); // drain initial events so we can isolate holdSync's effect
  fakeNet.emit("input", { op: "input", seq: 3, from: "p_g1", intent: "holdSync", held: ["up"] });
  const { events, held } = inputModule.pollInput(2);
  assert.deepEqual(events, [], "holdSync must not queue a press event");
  assert.equal(held.size, 1);
  assert.ok(held.has("up"));
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

// --- Action dispatch (direct call, no DOM bus) -----------------------------
// hostGuests.dispatchActionForSlot used to round-trip through
// window.dispatchEvent(new KeyboardEvent(...)); the test stubbed window
// and counted events. The refactor calls tryShootForSlot/etc directly,
// so we install assertion-friendly stub dispatchers via the test seam.

async function installDispatchSpies() {
  const calls = [];
  const stub = (action) => (slot) => calls.push({ action, slot });
  const { _setActionDispatchForTesting, _resetActionCooldownsForTesting } =
    await import("../js/hostGuests.js?v=20260528i");
  _setActionDispatchForTesting({
    shoot: stub("shoot"),
    melee: stub("melee"),
    interact: stub("interact"),
  });
  _resetActionCooldownsForTesting();
  return {
    calls,
    restore: () => _setActionDispatchForTesting({}),
  };
}

test("rapid shoot intents from one guest are throttled by the cooldown", async () => {
  const { calls, restore } = await installDispatchSpies();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    // Fire three back-to-back shoots — the cooldown is 180 ms, so two
    // of them should be silently dropped.
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 3, from: "p_g1", intent: "shoot" });
    const shoots = calls.filter((c) => c.action === "shoot");
    assert.equal(shoots.length, 1, `expected 1 dispatched shoot (rest throttled), got ${shoots.length}`);
    assert.equal(shoots[0].slot, 2, "dispatch must carry the slot, not a synthesised key code");
    teardown();
  } finally { restore(); }
});

test("cooldown is per-guest per-intent (shoot from g1 doesn't gate shoot from g2; shoot doesn't gate melee)", async () => {
  const { calls, restore } = await installDispatchSpies();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g2", slot: 3 });
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 2, from: "p_g2", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 3, from: "p_g1", intent: "melee" });
    // All three should land — different (guest, intent) tuples.
    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((c) => `${c.action}/${c.slot}`),
      ["shoot/2", "shoot/3", "melee/2"],
    );
    teardown();
  } finally { restore(); }
});

test("cooldown clears after the window — slow tapping isn't penalised", async () => {
  const { calls, restore } = await installDispatchSpies();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    // Sleep past the 180 ms cooldown — second shoot should land too.
    await new Promise((r) => setTimeout(r, 200));
    fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "shoot" });
    assert.equal(calls.length, 2);
    teardown();
  } finally { restore(); }
});

test("movement intents are never throttled (state-derived, last-wins)", async () => {
  // A spammed flood of moveLeft from a malicious client must NOT trip
  // any cooldown — held key state would otherwise desync from the
  // honest case where a real user is just holding the key down.
  // We can observe by reading the slot's input state after the flood.
  const { restore } = await installDispatchSpies();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    for (let i = 0; i < 50; i++) {
      fakeNet.emit("input", { op: "input", seq: i, from: "p_g1", intent: "moveRight" });
    }
    const { held } = inputModule.pollInput(2);
    assert.ok(held.has("right"), "moveRight must still be held after a flood");
    teardown();
  } finally { restore(); }
});

test("dispatchActionForSlot routes shoot/melee/interact to the right per-slot entry points", async () => {
  // Pin the direct-call shape — three intents from one guest fire
  // three distinct dispatchers with the slot as the payload, in order.
  const { calls, restore } = await installDispatchSpies();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 4 });
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    await new Promise((r) => setTimeout(r, 200));
    fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "melee" });
    await new Promise((r) => setTimeout(r, 300));
    fakeNet.emit("input", { op: "input", seq: 3, from: "p_g1", intent: "interact" });
    assert.deepEqual(
      calls.map((c) => `${c.action}/${c.slot}`),
      ["shoot/4", "melee/4", "interact/4"],
    );
    teardown();
  } finally { restore(); }
});

// --- onPeerGhosted slot isolation ------------------------------------------

test("peer.ghosted clears held keys only for the ghosting slot (other guests keep moving)", () => {
  // Regression: this used to iterate every guest and wipe their held
  // set. A single ghosted peer would freeze every other guest's
  // movement until they re-pressed their keys — felt like the whole
  // co-op had hitched even though only one peer was actually gone.
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g2", slot: 3 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveDown" });
  fakeNet.emit("input", { op: "input", seq: 2, from: "p_g2", intent: "moveRight" });
  fakeNet.emit("peer.ghosted", { op: "peer.ghosted", playerId: "p_g1" });
  const slot2 = inputModule.pollInput(2);
  const slot3 = inputModule.pollInput(3);
  assert.equal(slot2.held.size, 0, "ghosting guest's held keys must clear");
  assert.ok(slot3.held.has("right"),
    "non-ghosting guest's held keys must NOT be touched");
  teardown();
});

test("action intent is dropped when the slot's avatar has been despawned (range gate)", async () => {
  // Race: an `input` frame arrives for a slot whose state.players entry
  // has just been wiped by peer.left. The cooldown bucket would still
  // grant the action, so the range gate must short-circuit before the
  // dispatcher is called. Pure routing assertion — no DOM, no real
  // shoot/melee modules.
  const { calls, restore } = await installDispatchSpies();
  try {
    const { fakeNet, state } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    // Simulate a despawn that hasn't yet led to a peer.left arriving.
    state.player2 = null;
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    assert.equal(calls.length, 0, "shoot must be dropped when avatar is gone");
    teardown();
  } finally { restore(); }
});

test("action intent is dropped when the slot's avatar is dead (range gate)", async () => {
  const { calls, restore } = await installDispatchSpies();
  const { applyPlayerDamage, resetPlayerHealth } =
    await import("../js/playerHealth.js?v=20260528i");
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    // The spawned slot-2 avatar has index=1 (see makeCoopP2). Kill it.
    applyPlayerDamage(9999, 1);
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    assert.equal(calls.length, 0, "shoot must be dropped while dead");
    resetPlayerHealth(1);
    teardown();
  } finally { restore(); }
});

test("peer.ghosted without a known playerId is a no-op (defensive)", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "moveDown" });
  fakeNet.emit("peer.ghosted", { op: "peer.ghosted", playerId: "p_stranger" });
  const { held } = inputModule.pollInput(2);
  assert.ok(held.has("down"), "unknown playerId must not affect other slots");
  teardown();
});
