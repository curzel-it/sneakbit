// Host-side guest plumbing under guest-authoritative movement: peer.joined
// spawns avatars, op:"move" position updates are validated + applied against
// the host's own zone, actions dispatch with facing, and lastSeq advances on
// every resolved update (accepted or rejected). See docs/multiplayer.md.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js");
const { installHostGuests, _uninstallHostGuestsForTesting, getLastSeqMap } =
  await import("../js/hostGuests.js");
const { createPlayer } = await import("../js/player.js");
const { loadSpeciesData } = await import("../js/species.js");
const inputModule = await import("../js/input.js");

// Hero species so player.js slipperiness/species lookups don't throw.
loadSpeciesData([{ id: 1001, entity_type: "Hero", z_index: 15 }]);

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

function makeFlatZone(cols = 30, rows = 30) {
  return {
    cols, rows,
    collision: Array.from({ length: rows }, () => Array(cols).fill(false)),
    biome: Array.from({ length: rows }, () => Array(cols).fill(0)),
    entities: [],
  };
}

const makeCoopP2 = (p1, _zone, opts = {}) => {
  const p = createPlayer({ index: opts.index ?? 1 });
  p.tileX = p1.tileX + 1; p.tileY = p1.tileY;
  p.x = p.tileX; p.y = p.tileY;
  p.direction = "down";
  return p;
};

function setup() {
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "host", uuid: "uuid-host" });
  for (const s of [2, 3, 4]) inputModule.clearInputState(s);
  _uninstallHostGuestsForTesting();
  const fakeNet = makeFakeNet();
  bootstrapOnline({ netFactory: () => fakeNet });
  fakeNet.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_host", name: "Player-x" });
  const state = {
    player: createPlayer({ index: 0 }),
    zone: makeFlatZone(),
    player2: null,
    lastTile2: null,
    players: [],
  };
  state.player.tileX = 5; state.player.tileY = 5;
  installHostGuests(() => state, { makeCoopP2, net: fakeNet });
  return { fakeNet, state };
}

function teardown() {
  _uninstallHostGuestsForTesting();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
  for (const s of [2, 3, 4]) inputModule.clearInputState(s);
}

let seq = 0;
function posMsg(from, x, y, d = "down", m = 1, extra = {}) {
  return { op: "move", seq: ++seq, from, k: "pos", x, y, d, m, ...extra };
}

// --- spawn / lifecycle ------------------------------------------------------

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
  const { events, held } = inputModule.pollInput(2);
  assert.equal(events.length, 0);
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

test("slot 3 + slot 4 spawn into state.players with the right indices", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g3", slot: 3 });
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g4", slot: 4 });
  assert.equal(state.players.length, 2);
  const bySlot = Object.fromEntries(state.players.map((s) => [s.slot, s]));
  assert.equal(bySlot[3].player.index, 2);
  assert.equal(bySlot[4].player.index, 3);
  teardown();
});

// --- onMove: validate + apply ----------------------------------------------

test("a plausible position update is applied and acked at once", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; // at (6,5)
  seq = 0;
  fakeNet.emit("move", posMsg("p_g1", 6.3, 5.6, "right", 1));
  assert.deepEqual({ x: a.x, y: a.y }, { x: 6.3, y: 5.6 });
  assert.deepEqual({ x: a.tileX, y: a.tileY }, { x: 6, y: 6 });
  assert.equal(a.direction, "right");
  assert.equal(a.moving, true);
  assert.equal(getLastSeqMap()["p_g1"], 1, "acked with the position, a consistent pair");
  fakeNet.emit("move", posMsg("p_g1", 6.3, 5.6, "right", 0));
  assert.equal(a.moving, false, "a stop update clears the walk animation");
  teardown();
});

test("an update through a wall is rejected: lastSeq advances, the avatar stays put", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; a.tileX = 5; a.tileY = 5; a.x = 5; a.y = 5;
  seq = 0;
  state.zone.collision[5][6] = true;
  fakeNet.emit("move", posMsg("p_g1", 7, 5, "right"));
  assert.deepEqual({ x: a.x, y: a.y }, { x: 5, y: 5 }, "position unchanged");
  assert.equal(getLastSeqMap()["p_g1"], 1, "lastSeq still advances so the guest snaps back");
  teardown();
});

test("an implausible jump is rejected", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; a.tileX = 6; a.tileY = 5; a.x = 6; a.y = 5;
  seq = 0;
  fakeNet.emit("move", posMsg("p_g1", 12, 12));
  assert.deepEqual({ x: a.x, y: a.y }, { x: 6, y: 5 });
  assert.equal(getLastSeqMap()["p_g1"], seq);
  teardown();
});

test("non-numeric positions are rejected", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2;
  seq = 0;
  fakeNet.emit("move", posMsg("p_g1", "6", null));
  assert.deepEqual({ x: a.x, y: a.y }, { x: 6, y: 5 });
  assert.equal(getLastSeqMap()["p_g1"], seq);
  teardown();
});

test("two guests may stand on the same spot; the host never pushes them", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g2", slot: 2 });
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g3", slot: 3 });
  const a2 = state.player2;
  const a3 = state.players.find((s) => s.slot === 3).player;
  a2.x = 6; a2.y = 5; a3.x = 5; a3.y = 5;
  seq = 0;
  fakeNet.emit("move", posMsg("p_g2", 5.5, 5, "left"));
  fakeNet.emit("move", posMsg("p_g3", 5.5, 5, "right"));
  assert.equal(a2.x, 5.5);
  assert.equal(a3.x, 5.5);
  teardown();
});

test("a guest push claim next to its avatar shoves the rock on the host", () => {
  loadSpeciesData([
    { id: 1001, entity_type: "Hero", z_index: 15 },
    { id: 7000, entity_type: "PushableObject", is_rigid: true, sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  ]);
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; a.x = 6.2; a.y = 5;
  const rock = { id: 9, species_id: 7000, frame: { x: 7, y: 5, w: 1, h: 1 } };
  const far = { id: 10, species_id: 7000, frame: { x: 15, y: 5, w: 1, h: 1 } };
  state.zone.entities.push(rock, far);
  seq = 0;
  fakeNet.emit("move", posMsg("p_g1", 6.2, 5, "right", 1, { push: { x: 7, y: 5, d: "right" } }));
  assert.equal(rock.frame.x, 8, "the adjacent rock moved");
  fakeNet.emit("move", posMsg("p_g1", 6.2, 5, "right", 1, { push: { x: 15, y: 5, d: "right" } }));
  assert.equal(far.frame.x, 15, "a rock out of reach does not");
  loadSpeciesData([{ id: 1001, entity_type: "Hero", z_index: 15 }]);
  teardown();
});

test("dead guard: moves for a dead avatar are rejected", async () => {
  const { applyPlayerDamage, resetPlayerHealth } = await import("../js/playerHealth.js");
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2;
  seq = 0;
  applyPlayerDamage(9999, 1); // slot-2 avatar has index 1
  try {
    fakeNet.emit("move", posMsg("p_g1", 6, 5.5));
    assert.deepEqual({ x: a.x, y: a.y }, { x: 6, y: 5 }, "a dead avatar does not move");
    assert.equal(getLastSeqMap()["p_g1"], seq, "rejected update still advances lastSeq");
  } finally {
    resetPlayerHealth(1);
    teardown();
  }
});

// --- action dispatch + cheat resistance -------------------------------------

async function installDispatchSpies() {
  const calls = [];
  const stub = (action) => (slot) => calls.push({ action, slot });
  const { _setActionDispatchForTesting, _resetActionCooldownsForTesting } =
    await import("../js/hostGuests.js");
  _setActionDispatchForTesting({ shoot: stub("shoot"), melee: stub("melee"), interact: stub("interact") });
  _resetActionCooldownsForTesting();
  return { calls, restore: () => _setActionDispatchForTesting({}) };
}

test("action intent faces the avatar (d) before dispatching", async () => {
  const { calls, restore } = await installDispatchSpies();
  try {
    const { fakeNet, state } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot", d: "up" });
    assert.equal(state.player2.direction, "up", "avatar must face the way the shot fires");
    assert.deepEqual(calls, [{ action: "shoot", slot: 2 }]);
    teardown();
  } finally { restore(); }
});

test("rapid shoot intents from one guest are throttled by the cooldown", async () => {
  const { calls, restore } = await installDispatchSpies();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 2, from: "p_g1", intent: "shoot" });
    fakeNet.emit("input", { op: "input", seq: 3, from: "p_g1", intent: "shoot" });
    assert.equal(calls.filter((c) => c.action === "shoot").length, 1);
    teardown();
  } finally { restore(); }
});

test("action from an unknown sender is ignored", async () => {
  const { calls, restore } = await installDispatchSpies();
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_stranger", intent: "shoot" });
    assert.equal(calls.length, 0);
    teardown();
  } finally { restore(); }
});

test("action intent is dropped when the slot's avatar is dead (range gate)", async () => {
  const { calls, restore } = await installDispatchSpies();
  const { applyPlayerDamage, resetPlayerHealth } = await import("../js/playerHealth.js");
  try {
    const { fakeNet } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    applyPlayerDamage(9999, 1);
    fakeNet.emit("input", { op: "input", seq: 1, from: "p_g1", intent: "shoot" });
    assert.equal(calls.length, 0);
    resetPlayerHealth(1);
    teardown();
  } finally { restore(); }
});

// --- ghost isolation --------------------------------------------------------

test("peer.ghosted clears held keys only for the ghosting slot", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g2", slot: 3 });
  inputModule.pushInputPress(2, "down");
  inputModule.pushInputPress(3, "right");
  fakeNet.emit("peer.ghosted", { op: "peer.ghosted", playerId: "p_g1" });
  assert.equal(inputModule.pollInput(2).held.size, 0, "ghosting slot's held keys clear");
  assert.ok(inputModule.pollInput(3).held.has("right"), "other slot untouched");
  teardown();
});

test("peer.ghosted without a known playerId is a no-op (defensive)", () => {
  const { fakeNet } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  inputModule.pushInputPress(2, "down");
  fakeNet.emit("peer.ghosted", { op: "peer.ghosted", playerId: "p_stranger" });
  assert.ok(inputModule.pollInput(2).held.has("down"));
  teardown();
});
