// Host-side guest plumbing under guest-authoritative movement: peer.joined
// spawns avatars, op:"move" commits are validated + executed against the
// host's own zone, actions dispatch with facing, and lastSeq advances only
// on resolved steps (accept→snap, reject→immediately). See
// guest-authoritative-movement.md.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js");
const { installHostGuests, _uninstallHostGuestsForTesting, getLastSeqMap } =
  await import("../js/hostGuests.js");
const { createPlayer, updateGuestAvatar } = await import("../js/player.js");
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

// Drive all in-flight + chained steps to completion (avatar fully idle).
function finishStep(avatar, zone) {
  for (let i = 0; i < 60 && avatar.step; i++) updateGuestAvatar(avatar, 0.05, zone);
}
// Drive exactly the current step to its snap (a chained next step may start).
function finishOneStep(avatar, zone) {
  const start = avatar.step;
  if (!start) return;
  for (let i = 0; i < 30; i++) {
    updateGuestAvatar(avatar, 0.05, zone);
    if (avatar.step !== start) break;
  }
}
// One animation frame.
function frame(avatar, zone, dt = 0.02) { updateGuestAvatar(avatar, dt, zone); }

let seq = 0;
function stepMsg(from, fx, fy, tx, ty, d) {
  return { op: "move", seq: ++seq, from, k: "step", fx, fy, tx, ty, d };
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

// --- onMove: validate + execute ---------------------------------------------

test("an idle avatar executes a legal committed step and lands on the target tile", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const avatar = state.player2; // at (6,5)
  fakeNet.emit("move", stepMsg("p_g1", 6, 5, 6, 6, "down"));
  assert.ok(avatar.step, "a legal step starts immediately on an idle avatar");
  // lastSeq must NOT advance mid-step (tileX is still the from tile).
  assert.equal(getLastSeqMap()["p_g1"] ?? 0, 0);
  finishStep(avatar, state.zone);
  assert.deepEqual({ x: avatar.tileX, y: avatar.tileY }, { x: 6, y: 6 });
  assert.equal(getLastSeqMap()["p_g1"], seq, "lastSeq advances at the snap");
  teardown();
});

test("junction repro: a left commit at tile 3 lands on 4, regardless of delivery timing", () => {
  // Road: (5,5)→(5,4)→(5,3 = junction); up continues to (5,2) dead end,
  // left goes (5,3)→(4,3). Under the old re-sim model the host over-stepped
  // to (5,2) when the left arrived late. Now the guest ships the committed
  // left step, so the avatar always lands on (4,3).
  for (const lateLeft of [false, true]) {
    const { fakeNet, state } = setup();
    fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
    const a = state.player2;
    a.tileX = 5; a.tileY = 5; a.x = 5; a.y = 5;
    seq = 0;

    fakeNet.emit("move", stepMsg("p_g1", 5, 5, 5, 4, "up"));   // seq 1
    finishStep(a, state.zone);                                  // → (5,4)
    fakeNet.emit("move", stepMsg("p_g1", 5, 4, 5, 3, "up"));   // seq 2

    if (lateLeft) {
      // Deliver the left WHILE the up-to-3 step is mid-flight → it queues.
      frame(a, state.zone); // advance a little; still mid-step
      fakeNet.emit("move", stepMsg("p_g1", 5, 3, 4, 3, "left")); // seq 3, queued
      finishStep(a, state.zone); // snaps to (5,3), consumes queued left
      finishStep(a, state.zone); // completes the left step
    } else {
      finishStep(a, state.zone); // → (5,3) idle
      fakeNet.emit("move", stepMsg("p_g1", 5, 3, 4, 3, "left")); // seq 3, idle
      finishStep(a, state.zone); // → (4,3)
    }

    assert.deepEqual({ x: a.tileX, y: a.tileY }, { x: 4, y: 3 },
      `lateLeft=${lateLeft}: must land on the junction's left exit, never the dead end`);
    teardown();
  }
});

test("queued step: a commit arriving mid-step is consumed at the snap, acked then not at receipt", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; a.tileX = 5; a.tileY = 5; a.x = 5; a.y = 5;
  seq = 0;

  fakeNet.emit("move", stepMsg("p_g1", 5, 5, 5, 6, "down")); // seq 1, idle → executes
  frame(a, state.zone); // mid-step
  fakeNet.emit("move", stepMsg("p_g1", 5, 6, 5, 7, "down")); // seq 2, queued
  assert.equal(getLastSeqMap()["p_g1"] ?? 0, 0, "neither step acked while the first is mid-flight");
  assert.equal(a.netQueuedSteps.length, 1, "second commit is queued");

  finishOneStep(a, state.zone); // first step snaps → (5,6), acks seq1, consumes queued
  assert.deepEqual({ x: a.tileX, y: a.tileY }, { x: 5, y: 6 });
  assert.equal(getLastSeqMap()["p_g1"], 1, "lastSeq advances at the snap, not at receipt");
  assert.ok(a.step, "queued step is now in flight");

  finishStep(a, state.zone); // second step snaps → (5,7)
  assert.deepEqual({ x: a.tileX, y: a.tileY }, { x: 5, y: 7 });
  assert.equal(getLastSeqMap()["p_g1"], 2);
  teardown();
});

test("no-displacement rejection: an illegal step advances lastSeq but leaves the tile put", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; a.tileX = 5; a.tileY = 5; a.x = 5; a.y = 5;
  seq = 0;
  state.zone.collision[5][6] = true; // wall to the east — host rejects the step

  fakeNet.emit("move", stepMsg("p_g1", 5, 5, 6, 5, "right")); // seq 1
  assert.equal(a.step, null, "rejected step produces no movement");
  assert.deepEqual({ x: a.tileX, y: a.tileY }, { x: 5, y: 5 }, "tile unchanged");
  assert.equal(getLastSeqMap()["p_g1"], 1,
    "lastSeq still advances so the guest reconciles (snap) instead of walking a phantom corridor");
  teardown();
});

test("stale from-tile is rejected (post-displacement commits bounce until a delta snaps)", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; a.tileX = 6; a.tileY = 5;
  seq = 0;
  // Guest commits from (8,8) but the host's avatar is at (6,5).
  fakeNet.emit("move", stepMsg("p_g1", 8, 8, 8, 9, "down"));
  assert.equal(a.step, null);
  assert.deepEqual({ x: a.tileX, y: a.tileY }, { x: 6, y: 5 });
  assert.equal(getLastSeqMap()["p_g1"], seq);
  teardown();
});

test("tile sharing: two avatars commit onto the same tile and both are accepted", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g2", slot: 2 });
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g3", slot: 3 });
  const a2 = state.player2;
  const a3 = state.players.find((s) => s.slot === 3).player;
  a2.tileX = 6; a2.tileY = 5; a2.x = 6; a2.y = 5;
  a3.tileX = 4; a3.tileY = 5; a3.x = 4; a3.y = 5;
  seq = 0;

  fakeNet.emit("move", stepMsg("p_g2", 6, 5, 5, 5, "left"));
  fakeNet.emit("move", stepMsg("p_g3", 4, 5, 5, 5, "right"));
  assert.ok(a2.step && a3.step, "both steps accepted — no player-vs-player collision");
  finishStep(a2, state.zone);
  finishStep(a3, state.zone);
  assert.deepEqual({ x: a2.tileX, y: a2.tileY }, { x: 5, y: 5 });
  assert.deepEqual({ x: a3.tileX, y: a3.tileY }, { x: 5, y: 5 });
  teardown();
});

test("face commit turns an idle avatar without touching lastSeq", () => {
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; a.tileX = 6; a.tileY = 5;
  seq = 0;
  fakeNet.emit("move", { op: "move", seq: 1, from: "p_g1", k: "face", x: 6, y: 5, d: "left" });
  assert.equal(a.direction, "left");
  assert.equal(getLastSeqMap()["p_g1"] ?? 0, 0, "faces are not reconciled — they never advance lastSeq");
  teardown();
});

test("dead guard: moves for a dead avatar are rejected", async () => {
  const { applyPlayerDamage, resetPlayerHealth } = await import("../js/playerHealth.js");
  const { fakeNet, state } = setup();
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const a = state.player2; a.tileX = 6; a.tileY = 5;
  seq = 0;
  applyPlayerDamage(9999, 1); // slot-2 avatar has index 1
  fakeNet.emit("move", stepMsg("p_g1", 6, 5, 6, 6, "down"));
  assert.equal(a.step, null, "a dead avatar does not move");
  assert.deepEqual({ x: a.tileX, y: a.tileY }, { x: 6, y: 5 });
  assert.equal(getLastSeqMap()["p_g1"], seq, "rejected step still advances lastSeq");
  resetPlayerHealth(1);
  teardown();
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
